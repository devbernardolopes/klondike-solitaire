-- ============================================================
-- Klondike Solitaire — Supabase migration 032 (configurable coin rewards)
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================
-- Moves the win coin reward out of the hardcoded `v_coins_awarded := 10`
-- literal into two admin-settable tables that the client NEVER writes:
--
--   coin_reward_rules     per-game_kind base reward + speed/move bonuses
--   coin_reward_settings  global knobs (fallback base, daily rate cap,
--                         plausibility floors)
--   coin_reward_flags     append-only anomaly log (rate-capped or
--                         implausible submissions) for review — no client
--                         access, written only by submit_game_result.
--
-- Anti-tamper model (see header of submit_game_result.sql):
--   1. The RPC accepts FACTS only (kind/moves/duration) — never an amount.
--      Coins are derived server-side from the tables above.
--   2. (user_id, game_id) uniqueness already makes every game pay at most
--      once; retries are harmless no-ops.
--   3. Implausible submissions (below the sanity floors) still record the
--      win/stats but pay 0 and are flagged — never raise, so a tampered
--      client cannot poison its own sync queue with a permanent error.
--   4. Daily rate cap bounds farming upside; capped wins still record.
-- Client impact: NONE on the RPC signature (same 20 args). The response
-- JSON gains coins_* breakdown keys the client uses to reconcile its
-- optimistic display. Offline flow unchanged: the outbox submits facts on
-- reconnect; the server computes + credits then.
--
-- To retune rewards, edit the tables directly, e.g.:
--   update coin_reward_rules set base_reward = 20 where game_kind = 'daily';
--   update coin_reward_settings set value_int = 100
--     where key = 'max_rewarded_wins_per_day';
-- ============================================================

-- ------------------------------------------------------------
-- 1. Reward tables (admin-settable; client gets SELECT only)
-- ------------------------------------------------------------

create table if not exists public.coin_reward_rules (
  game_kind text primary key,
  base_reward integer not null default 0 check (base_reward >= 0),
  fast_ms_threshold integer check (fast_ms_threshold is null or fast_ms_threshold > 0),
  fast_bonus integer not null default 0 check (fast_bonus >= 0),
  few_moves_threshold integer check (few_moves_threshold is null or few_moves_threshold > 0),
  few_moves_bonus integer not null default 0 check (few_moves_bonus >= 0)
);

create table if not exists public.coin_reward_settings (
  key text primary key,
  value_int integer not null
);

-- Anomaly log: written by the RPC only. No client policies are created on
-- purpose — with RLS enabled and zero policies, all client roles are denied
-- while SECURITY DEFINER functions still write.
create table if not exists public.coin_reward_flags (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  game_id uuid,
  reason text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.coin_reward_rules enable row level security;
alter table public.coin_reward_settings enable row level security;
alter table public.coin_reward_flags enable row level security;

drop policy if exists "coin_reward_rules_public_read" on public.coin_reward_rules;
create policy "coin_reward_rules_public_read"
  on public.coin_reward_rules for select
  to anon, authenticated
  using (true);

drop policy if exists "coin_reward_settings_public_read" on public.coin_reward_settings;
create policy "coin_reward_settings_public_read"
  on public.coin_reward_settings for select
  to anon, authenticated
  using (true);

-- ------------------------------------------------------------
-- 2. Seed defaults (insert-only — re-running never overwrites admin edits)
-- ------------------------------------------------------------

insert into public.coin_reward_rules
  (game_kind, base_reward, fast_ms_threshold, fast_bonus, few_moves_threshold, few_moves_bonus)
values
  ('winning', 10, 300000, 3, 100, 2),
  ('daily',   15, 300000, 3, 100, 2),
  ('random',   5, 300000, 3, 100, 2),
  ('event',   10, 300000, 3, 100, 2)
on conflict (game_kind) do nothing;

insert into public.coin_reward_settings (key, value_int)
values
  ('fallback_base_reward', 5),
  ('max_rewarded_wins_per_day', 50),
  ('min_win_duration_ms', 5000),
  ('min_win_moves', 1)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 3. Reward computation inside submit_game_result (same 20-arg signature)
-- ------------------------------------------------------------

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
  p_ace_ids_to_foundation jsonb default '[]'::jsonb,
  p_event_deal_id bigint default null
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
  v_coins_base integer := 0;
  v_coins_time_bonus integer := 0;
  v_coins_moves_bonus integer := 0;
  v_coins_rate_limited boolean := false;
  v_coins_implausible boolean := false;
  v_rule record;
  v_fallback_base integer := 5;
  v_max_wins_per_day integer := 50;
  v_min_duration_ms integer := 5000;
  v_min_moves integer := 1;
  v_wins_today integer := 0;
  v_context jsonb;
  v_newly text[] := '{}';
  -- event progress locals
  v_event_page_id bigint;
  v_event_grid_size integer;
  v_event_page_coin_reward integer;
  v_event_id text;
  v_deal_inserted boolean := false;
  v_page_solved_count integer;
  v_page_inserted boolean := false;
  v_event_total_pages integer;
  v_event_completed_pages integer;
  v_event_inserted boolean := false;
  v_event_result jsonb := '{}'::jsonb;
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
    -- Duplicate delivery (offline retry / double submit): success WITHOUT
    -- re-crediting. No coins_* breakdown here by design — the client already
    -- applied its optimistic display on first win and must not adjust twice.
    return jsonb_build_object('newly_unlocked_achievement_ids', '{}'::text[], 'event_progress', '{}'::jsonb);
  end if;

  if p_won and (p_duration_ms is null or p_duration_ms < 0) then
    raise exception 'Winning duration must be a non-negative integer';
  end if;

  if p_won and (p_moves is null or p_moves < 0) then
    raise exception 'Winning moves must be a non-negative integer';
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
    v_comeback := v_profile.games_won >= 1
      and v_profile.best_streak >= 1
      and v_profile.last_result_won = false
      and v_recovery_streak > 0
      and v_profile.loss_recovery_baseline_best_streak >= 1
      and v_new_streak > v_profile.loss_recovery_baseline_best_streak;

    -- Configurable reward: facts in (kind/moves/duration), coins out.
    -- No amount is ever accepted from the client.
    select * into v_rule
      from public.coin_reward_rules
      where game_kind = p_game_kind;

    select coalesce(
      (select value_int from public.coin_reward_settings where key = 'fallback_base_reward'),
      v_fallback_base
    ) into v_fallback_base;

    v_coins_base := coalesce(v_rule.base_reward, v_fallback_base);

    if v_rule.fast_ms_threshold is not null
      and p_duration_ms < v_rule.fast_ms_threshold then
      v_coins_time_bonus := coalesce(v_rule.fast_bonus, 0);
    end if;

    if v_rule.few_moves_threshold is not null
      and p_moves < v_rule.few_moves_threshold then
      v_coins_moves_bonus := coalesce(v_rule.few_moves_bonus, 0);
    end if;

    -- Plausibility floors: impossible submissions still record the win but
    -- pay 0 and are flagged for review. Deliberately NOT an exception: a
    -- raise would fail the sync op forever and wedge the client's outbox.
    select coalesce(
      (select value_int from public.coin_reward_settings where key = 'min_win_duration_ms'),
      v_min_duration_ms
    ) into v_min_duration_ms;
    select coalesce(
      (select value_int from public.coin_reward_settings where key = 'min_win_moves'),
      v_min_moves
    ) into v_min_moves;

    if p_duration_ms < v_min_duration_ms or p_moves < v_min_moves then
      v_coins_implausible := true;
      insert into public.coin_reward_flags (user_id, game_id, reason, detail)
      values (v_user_id, v_game_id, 'implausible',
        jsonb_build_object('game_kind', p_game_kind, 'moves', p_moves,
          'duration_ms', p_duration_ms));
    end if;

    -- Daily rate cap: beyond N rewarded wins/day the win still records
    -- (streaks/stats/achievements unaffected) but pays 0. The count includes
    -- this row (inserted above), so with cap 50 the first 50 wins of the day
    -- are paid and the 51st+ pay 0.
    select coalesce(
      (select value_int from public.coin_reward_settings where key = 'max_rewarded_wins_per_day'),
      v_max_wins_per_day
    ) into v_max_wins_per_day;

    select count(*) into v_wins_today
      from public.game_results
      where user_id = v_user_id
        and won = true
        and created_at >= date_trunc('day', now());

    if v_wins_today > v_max_wins_per_day then
      v_coins_rate_limited := true;
      insert into public.coin_reward_flags (user_id, game_id, reason, detail)
      values (v_user_id, v_game_id, 'rate_capped',
        jsonb_build_object('wins_today_incl_this', v_wins_today,
          'cap', v_max_wins_per_day));
    end if;

    if v_coins_implausible or v_coins_rate_limited then
      v_coins_awarded := 0;
      v_coins_base := 0;
      v_coins_time_bonus := 0;
      v_coins_moves_bonus := 0;
    else
      v_coins_awarded := v_coins_base + v_coins_time_bonus + v_coins_moves_bonus;
    end if;

    update public.profiles as p
    set games_won = p.games_won + 1,
        current_streak = v_new_streak,
        best_streak = greatest(p.best_streak, v_new_streak),
        coins = p.coins + v_coins_awarded,
        coins_earned_total = p.coins_earned_total + v_coins_awarded,
        highest_score = greatest(p.highest_score, p_score),
        lowest_time_ms = least(coalesce(p.lowest_time_ms, p_duration_ms), p_duration_ms),
        lowest_moves = least(coalesce(p.lowest_moves, p_moves), p_moves),
        lowest_undos = least(coalesce(p.lowest_undos, p_undos), p_undos),
        total_time_ms_won = p.total_time_ms_won + p_duration_ms,
        total_moves_won = p.total_moves_won + p_moves,
        last_result_won = true,
        loss_recovery_streak = v_recovery_streak,
        updated_at = now()
    where p.id = v_user_id;

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

    -- Special Events: mark the deal solved, then cascade page/event completion.
    if p_event_deal_id is not null then
      select sep.id, sep.grid_size, sep.coin_reward, sep.event_id
        into v_event_page_id, v_event_grid_size, v_event_page_coin_reward, v_event_id
      from public.special_event_deals sed
      join public.special_event_pages sep on sep.id = sed.page_id
      where sed.id = p_event_deal_id;

      if v_event_page_id is not null then
        insert into public.event_deal_progress (user_id, deal_id, score, time_ms, moves)
        values (v_user_id, p_event_deal_id, p_score, p_duration_ms, p_moves)
        on conflict (user_id, deal_id) do nothing;
        v_deal_inserted := found;

        if v_deal_inserted then
          select count(*) into v_page_solved_count
          from public.event_deal_progress edp
          join public.special_event_deals sed2 on sed2.id = edp.deal_id
          where edp.user_id = v_user_id and sed2.page_id = v_event_page_id;

          if v_page_solved_count >= (v_event_grid_size * v_event_grid_size) then
            insert into public.event_page_progress (user_id, page_id, coins_awarded)
            values (v_user_id, v_event_page_id, v_event_page_coin_reward)
            on conflict (user_id, page_id) do nothing;
            v_page_inserted := found;

            if v_page_inserted and v_event_page_coin_reward > 0 then
              update public.profiles
              set coins = coins + v_event_page_coin_reward,
                  coins_earned_total = coins_earned_total + v_event_page_coin_reward,
                  updated_at = now()
              where id = v_user_id;
            end if;

            if v_page_inserted then
              select count(*) into v_event_total_pages
              from public.special_event_pages
              where event_id = v_event_id;

              select count(*) into v_event_completed_pages
              from public.event_page_progress epp
              join public.special_event_pages sep2 on sep2.id = epp.page_id
              where epp.user_id = v_user_id and sep2.event_id = v_event_id;

              if v_event_completed_pages >= v_event_total_pages then
                insert into public.event_progress (user_id, event_id)
                values (v_user_id, v_event_id)
                on conflict (user_id, event_id) do nothing;
                v_event_inserted := found;
              end if;
            end if;
          end if;
        end if;
      end if;

      v_event_result := jsonb_build_object(
        'deal_solved', coalesce(v_deal_inserted, false),
        'event_id', v_event_id,
        'page_id', v_event_page_id,
        'page_completed', coalesce(v_page_inserted, false),
        'page_coins_awarded', case when v_page_inserted then v_event_page_coin_reward else 0 end,
        'event_completed', coalesce(v_event_inserted, false)
      );
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

  return jsonb_build_object(
    'newly_unlocked_achievement_ids', v_newly,
    'event_progress', v_event_result,
    'coins_awarded', v_coins_awarded,
    'coins_base', v_coins_base,
    'coins_time_bonus', v_coins_time_bonus,
    'coins_moves_bonus', v_coins_moves_bonus,
    'coins_rate_limited', v_coins_rate_limited,
    'coins_implausible', v_coins_implausible
  );
end;
$$;

grant execute on function public.submit_game_result(
  boolean, integer, integer, integer, integer, bigint, text, date, uuid,
  boolean, boolean, integer, integer, integer, integer, boolean, boolean,
  integer, jsonb, bigint
) to authenticated;

-- ============================================================
-- Testing note (run as the table owner / service role):
--   -- breakdown for a normal win:
--   select public.submit_game_result(true, 120, 240000, 0, 0, 1, 'winning');
--   -- expect coins_awarded = 10+3+0 = 13 (fast bonus, moves >= 100).
--   -- unknown kind falls back to base 5, no bonuses:
--   select public.submit_game_result(true, 50, 60000, 0, 0, 2, 'nope');
--   -- duplicate game_id pays once:
--   select public.submit_game_result(true, 50, 60000, 0, 0, 2, 'nope',
--     null, '00000000-0000-0000-0000-000000000001');
--   select public.submit_game_result(true, 50, 60000, 0, 0, 2, 'nope',
--     null, '00000000-0000-0000-0000-000000000001');
--   -- second call returns no coins_* keys (no double adjustment client-side).
-- ============================================================