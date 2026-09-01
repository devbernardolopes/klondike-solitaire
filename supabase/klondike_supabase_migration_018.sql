-- ============================================================
-- Klondike Solitaire - Supabase migration 018 (achievement telemetry)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Per-game telemetry and idempotency keys.
-- ------------------------------------------------------------
alter table public.game_sessions
  add column if not exists game_id uuid default gen_random_uuid(),
  add column if not exists hint_used boolean not null default false,
  add column if not exists undo_used boolean not null default false,
  add column if not exists tableau_to_tableau_moves integer not null default 0,
  add column if not exists foundation_moves integer not null default 0,
  add column if not exists foundation_to_tableau_moves integer not null default 0,
  add column if not exists recycle_count integer not null default 0,
  add column if not exists foundation_first_eligible boolean not null default true,
  add column if not exists ace_collector_eligible boolean not null default true,
  add column if not exists aces_to_foundation integer not null default 0,
  add column if not exists ace_ids_to_foundation jsonb not null default '[]'::jsonb;

update public.game_sessions
set game_id = gen_random_uuid()
where game_id is null;

alter table public.game_sessions
  alter column game_id set not null;

alter table public.game_results
  add column if not exists game_id uuid default gen_random_uuid(),
  add column if not exists hint_used boolean not null default false,
  add column if not exists undo_used boolean not null default false,
  add column if not exists tableau_to_tableau_moves integer not null default 0,
  add column if not exists foundation_moves integer not null default 0,
  add column if not exists foundation_to_tableau_moves integer not null default 0,
  add column if not exists recycle_count integer not null default 0,
  add column if not exists foundation_first_eligible boolean not null default true,
  add column if not exists ace_collector_eligible boolean not null default true,
  add column if not exists aces_to_foundation integer not null default 0,
  add column if not exists ace_ids_to_foundation jsonb not null default '[]'::jsonb;

update public.game_results
set game_id = gen_random_uuid()
where game_id is null;

alter table public.game_results
  alter column game_id set not null;

create unique index if not exists game_results_user_game_id_idx
  on public.game_results (user_id, game_id);

-- ------------------------------------------------------------
-- 2. Cross-game sequence state. Existing streak columns remain the
--    general-purpose streak aggregates.
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists lowest_time_ms integer,
  add column if not exists lowest_moves integer,
  add column if not exists last_result_won boolean,
  add column if not exists loss_recovery_streak integer not null default 0,
  add column if not exists loss_recovery_baseline_best_streak integer not null default 0;

-- ------------------------------------------------------------
-- 3. Reset sequence state along with the Statistics-modal streak fields.
-- ------------------------------------------------------------
create or replace function public.reset_statistics()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  update public.profiles
  set games_played = 0,
      games_won = 0,
      current_streak = 0,
      best_streak = 0,
      highest_score = 0,
      lowest_time_ms = null,
      lowest_moves = null,
      lowest_undos = null,
      total_time_ms_won = 0,
      total_moves_won = 0,
      last_result_won = null,
      loss_recovery_streak = 0,
      loss_recovery_baseline_best_streak = 0,
      updated_at = now()
  where id = v_user_id;
end;
$$;

grant execute on function public.reset_statistics() to authenticated;

-- ------------------------------------------------------------
-- 4. Finalize both wins and losses atomically. Losses are now recorded in
--    game_results so result-order achievements work across devices.
-- ------------------------------------------------------------
drop function if exists public.submit_game_result(boolean, integer, integer, integer, integer, bigint, text, date);

create or replace function public.submit_game_result(
  p_won boolean,
  p_moves integer,
  p_duration_ms integer,
  p_score integer default 0,
  p_undos integer default 0,
  p_seed bigint default null,
  p_game_kind text default null,
  p_daily_date date default null,
  p_game_id uuid default gen_random_uuid(),
  p_hint_used boolean default false,
  p_undo_used boolean default false,
  p_tableau_to_tableau_moves integer default 0,
  p_foundation_moves integer default 0,
  p_foundation_to_tableau_moves integer default 0,
  p_recycle_count integer default 0,
  p_foundation_first_eligible boolean default true,
  p_ace_collector_eligible boolean default true,
  p_aces_to_foundation integer default 0,
  p_ace_ids_to_foundation jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile record;
  v_game_id uuid := coalesce(p_game_id, gen_random_uuid());
  v_new_streak integer := 0;
  v_recovery_streak integer := 0;
  v_broken_chain boolean := false;
  v_back_on_track boolean := false;
  v_comeback boolean := false;
  v_coins_awarded integer := 0;
  v_context jsonb;
  v_newly text[] := '{}';
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Serialize result transitions per profile and make retries harmless.
  select * into v_profile
    from public.profiles
    where id = v_user_id
    for update;

  if exists (
    select 1 from public.game_results
    where user_id = v_user_id and game_id = v_game_id
  ) then
    return jsonb_build_object('newly_unlocked_achievement_ids', '{}'::text[]);
  end if;

  insert into public.game_results (
    user_id, game_id, won, moves, duration_ms, score, undos, seed, game_kind,
    hint_used, undo_used, tableau_to_tableau_moves, foundation_moves,
    foundation_to_tableau_moves, recycle_count, foundation_first_eligible,
    ace_collector_eligible, aces_to_foundation, ace_ids_to_foundation
  ) values (
    v_user_id, v_game_id, p_won, p_moves, p_duration_ms, p_score, p_undos,
    p_seed, p_game_kind, p_hint_used, (p_undo_used or p_undos > 0),
    p_tableau_to_tableau_moves, p_foundation_moves, p_foundation_to_tableau_moves,
    p_recycle_count, p_foundation_first_eligible, p_ace_collector_eligible,
    p_aces_to_foundation, p_ace_ids_to_foundation
  );

  if p_won then
    v_new_streak := v_profile.current_streak + 1;
    v_broken_chain := v_profile.last_result_won = false;
    v_recovery_streak := case
      when v_broken_chain then 1
      when v_profile.loss_recovery_streak > 0 then v_profile.loss_recovery_streak + 1
      else 0
    end;
    v_back_on_track := v_recovery_streak >= 3;
    v_comeback := v_recovery_streak > 0
      and v_new_streak > v_profile.loss_recovery_baseline_best_streak;
    v_coins_awarded := 10;

    update public.profiles
    set games_won = games_won + 1,
        current_streak = v_new_streak,
        best_streak = greatest(best_streak, v_new_streak),
        coins = coins + v_coins_awarded,
        coins_earned_total = coins_earned_total + v_coins_awarded,
        highest_score = greatest(highest_score, p_score),
        lowest_time_ms = case when lowest_time_ms is null then p_duration_ms else least(lowest_time_ms, p_duration_ms) end,
        lowest_moves = case when lowest_moves is null then p_moves else least(lowest_moves, p_moves) end,
        lowest_undos = case when lowest_undos is null then p_undos else least(lowest_undos, p_undos) end,
        total_time_ms_won = total_time_ms_won + p_duration_ms,
        total_moves_won = total_moves_won + p_moves,
        last_result_won = true,
        loss_recovery_streak = v_recovery_streak,
        updated_at = now()
    where id = v_user_id;

    v_context := jsonb_build_object(
      'won', true,
      'moves', p_moves,
      'duration_ms', p_duration_ms,
      'score', p_score,
      'undos', p_undos,
      'hint_used', p_hint_used,
      'undo_used', (p_undo_used or p_undos > 0),
      'tableau_to_tableau_moves', p_tableau_to_tableau_moves,
      'foundation_moves', p_foundation_moves,
      'foundation_to_tableau_moves', p_foundation_to_tableau_moves,
      'recycle_count', p_recycle_count,
      'foundation_first_eligible', p_foundation_first_eligible,
      'ace_collector_eligible', p_ace_collector_eligible,
      'aces_to_foundation', p_aces_to_foundation,
      'broken_chain', v_broken_chain,
      'back_on_track', v_back_on_track,
      'comeback', v_comeback,
      'game_kind', p_game_kind,
      'daily_date', p_daily_date::text,
      'current_streak', v_new_streak,
      'best_streak', greatest(v_profile.best_streak, v_new_streak),
      'total_games_won', v_profile.games_won + 1,
      'total_games_played', v_profile.games_played,
      'highest_score', greatest(v_profile.highest_score, p_score),
      'lowest_moves', least(coalesce(v_profile.lowest_moves, p_moves), p_moves),
      'lowest_time_ms', least(coalesce(v_profile.lowest_time_ms, p_duration_ms), p_duration_ms),
      'lowest_undos', least(coalesce(v_profile.lowest_undos, p_undos), p_undos),
      'total_coins_earned', v_profile.coins_earned_total + v_coins_awarded,
      'total_coins_spent', v_profile.coins_spent_total
    );

    v_newly := public.check_achievements(v_user_id, v_context);

    if p_game_kind = 'winning' and p_seed is not null then
      insert into public.played_seeds (user_id, seed)
      values (v_user_id, p_seed)
      on conflict do nothing;
    end if;

    if p_game_kind = 'daily' and p_daily_date is not null then
      insert into public.daily_results (user_id, date, seed, best_score, best_time_ms, best_moves, wins)
      values (v_user_id, p_daily_date, p_seed, p_score, p_duration_ms, p_moves, 1)
      on conflict (user_id, date) do update
      set seed = coalesce(public.daily_results.seed, excluded.seed),
          best_score = greatest(public.daily_results.best_score, excluded.best_score),
          best_time_ms = least(public.daily_results.best_time_ms, excluded.best_time_ms),
          best_moves = least(public.daily_results.best_moves, excluded.best_moves),
          wins = public.daily_results.wins + 1;
    end if;
  else
    update public.profiles
    set current_streak = 0,
        last_result_won = false,
        loss_recovery_streak = 0,
        loss_recovery_baseline_best_streak = best_streak,
        updated_at = now()
    where id = v_user_id;
  end if;

  return jsonb_build_object('newly_unlocked_achievement_ids', v_newly);
end;
$$;

grant execute on function public.submit_game_result(
  boolean, integer, integer, integer, integer, bigint, text, date, uuid,
  boolean, boolean, integer, integer, integer, integer, boolean, boolean,
  integer, jsonb
) to authenticated;
