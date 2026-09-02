-- ============================================================
-- Klondike Solitaire - Supabase migration 023
-- Keep games_played and games_won consistent when a reset races
-- with an active game's result submission.
-- ============================================================

create table if not exists public.game_starts (
  user_id uuid not null references auth.users (id) on delete cascade,
  game_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

alter table public.game_starts enable row level security;

drop policy if exists "game_starts_select_own" on public.game_starts;
create policy "game_starts_select_own"
  on public.game_starts for select
  using (auth.uid() = user_id);

create or replace function public.reset_statistics()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  update public.profiles
  set games_played = 0, games_won = 0, current_streak = 0, best_streak = 0,
      highest_score = 0, lowest_time_ms = null, lowest_moves = null,
      lowest_undos = null, total_time_ms_won = 0, total_moves_won = 0,
      last_result_won = null, loss_recovery_streak = 0,
      loss_recovery_baseline_best_streak = 0, updated_at = now()
  where id = v_user_id;
  delete from public.game_starts where user_id = v_user_id;
end;
$$;

grant execute on function public.reset_statistics() to authenticated;

create or replace function public.ensure_won_game_is_played()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.won and not exists (
    select 1 from public.game_starts
    where user_id = new.user_id and game_id = new.game_id
  ) then
    update public.profiles
    set games_played = games_played + 1, updated_at = now()
    where id = new.user_id;
  end if;
  delete from public.game_starts
  where user_id = new.user_id and game_id = new.game_id;
  return new;
end;
$$;

drop trigger if exists game_results_ensure_won_played on public.game_results;
create trigger game_results_ensure_won_played
  after insert on public.game_results
  for each row execute function public.ensure_won_game_is_played();

drop function if exists public.record_game_started();
create or replace function public.record_game_started(p_game_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_game_id uuid := coalesce(p_game_id, gen_random_uuid());
  v_inserted boolean := false;
  v_context jsonb;
  v_newly text[];
  v_profile record;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  insert into public.game_starts (user_id, game_id)
  select v_user_id, v_game_id
  where not exists (
    select 1 from public.game_results
    where user_id = v_user_id and game_id = v_game_id and won
  )
  on conflict (user_id, game_id) do nothing;
  v_inserted := found;
  if v_inserted then
    update public.profiles
    set games_played = games_played + 1, updated_at = now()
    where id = v_user_id;
  end if;
  select games_won, games_played, best_streak, current_streak,
         highest_score, lowest_moves, lowest_time_ms, lowest_undos,
         coins_earned_total, coins_spent_total
    into v_profile from public.profiles where id = v_user_id;
  v_context := jsonb_build_object(
    'total_games_won', v_profile.games_won,
    'total_games_played', v_profile.games_played,
    'best_streak', v_profile.best_streak,
    'current_streak', v_profile.current_streak,
    'highest_score', v_profile.highest_score,
    'lowest_moves', v_profile.lowest_moves,
    'lowest_time_ms', v_profile.lowest_time_ms,
    'lowest_undos', v_profile.lowest_undos,
    'total_coins_earned', v_profile.coins_earned_total,
    'total_coins_spent', v_profile.coins_spent_total
  );
  v_newly := check_achievements(v_user_id, v_context);
  return jsonb_build_object('newly_unlocked_achievement_ids', v_newly);
end;
$$;

grant execute on function public.record_game_started(uuid) to authenticated;
