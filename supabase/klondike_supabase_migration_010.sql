-- ============================================================
-- Klondike Solitaire — Supabase migration 010
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
--
-- Two independent additions:
--
-- 1. Fixes the "Reset statistics" bug: profiles is select-only for
--    clients (mutated only via SECURITY DEFINER RPCs, per the schema's
--    own convention), so the Statistics modal's local-only Dexie reset
--    was always going to be overwritten by the next pullRemoteProfile()
--    pull (boot, tab refocus, Daily Challenge / New Game modal open) or
--    by the next submit_game_result win, since neither ever touched the
--    server row. This adds a reset_statistics() RPC that zeroes exactly
--    the fields the Statistics modal displays, and nothing else:
--      - games_played, games_won, current_streak, best_streak
--      - highest_score, lowest_time_ms, lowest_moves, lowest_undos
--      - total_time_ms_won, total_moves_won (see #2 below)
--    It deliberately does NOT touch: coins / coins_earned_total /
--    coins_spent_total / owned_items (currency + purchases survive a
--    stats reset by design, same as the Phase 4 decision), achievements
--    (already permanent once unlocked — check_achievements only ever
--    inserts an achievement_id once per user, so this needs no change),
--    played_seeds (dedup bookkeeping, not a displayed stat), or
--    daily_results (Daily Challenge history, conceptually separate from
--    lifetime Statistics).
--
-- 2. Adds "Average Time (Won)" / "Average Moves (Won)" to the
--    Statistics modal. These are computed client-side as
--    total_time_ms_won / games_won and total_moves_won / games_won, so
--    two new lifetime-sum columns are added and folded into on every
--    win alongside the existing aggregates. Being part of the
--    resettable stat set, they're zeroed by reset_statistics() too.
-- ============================================================

-- ------------------------------------------------------------
-- 1. New accumulator columns on profiles.
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists total_time_ms_won bigint not null default 0,
  add column if not exists total_moves_won bigint not null default 0;

-- ------------------------------------------------------------
-- 2. reset_statistics — zeroes only the Statistics-modal fields for the
--    calling user. Everything else on profiles (coins, coins totals,
--    display name, owned items) is untouched, as are achievements_unlocked,
--    played_seeds, and daily_results.
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
      updated_at = now()
  where id = v_user_id;
end;
$$;

grant execute on function public.reset_statistics() to authenticated;

-- ------------------------------------------------------------
-- 3. submit_game_result — unchanged except for folding p_duration_ms /
--    p_moves into the two new lifetime sums on a win. Full body restated
--    (matches the canonical mirror in submit_game_result.sql).
-- ------------------------------------------------------------
create or replace function public.submit_game_result(
  p_won boolean,
  p_moves integer,
  p_duration_ms integer,
  p_score integer default 0,
  p_undos integer default 0,
  p_seed bigint default null,
  p_game_kind text default null,      -- 'winning' | 'random' | 'daily'
  p_daily_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_new_streak integer;
  v_coins_awarded integer := 0;
  v_context jsonb;
  v_newly text[];
  v_profile record;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.game_results
    (user_id, won, moves, duration_ms, score, undos, seed, game_kind)
  values
    (v_user_id, p_won, p_moves, p_duration_ms, p_score, p_undos, p_seed, p_game_kind);

  if p_won then
    v_coins_awarded := 10; -- flat reward for now; tune later
  end if;

  update public.profiles
  set games_won = games_won + case when p_won then 1 else 0 end,
      current_streak = case when p_won then current_streak + 1 else 0 end,
      best_streak = greatest(best_streak, case when p_won then current_streak + 1 else best_streak end),
      coins = coins + v_coins_awarded,
      coins_earned_total = coins_earned_total + v_coins_awarded,
      highest_score = case when p_won then greatest(highest_score, p_score) else highest_score end,
      lowest_time_ms = case when p_won then
        (case when lowest_time_ms is null then p_duration_ms else least(lowest_time_ms, p_duration_ms) end)
        else lowest_time_ms end,
      lowest_moves = case when p_won then
        (case when lowest_moves is null then p_moves else least(lowest_moves, p_moves) end)
        else lowest_moves end,
      lowest_undos = case when p_won then
        (case when lowest_undos is null then p_undos else least(lowest_undos, p_undos) end)
        else lowest_undos end,
      total_time_ms_won = total_time_ms_won + case when p_won then p_duration_ms else 0 end,
      total_moves_won = total_moves_won + case when p_won then p_moves else 0 end,
      updated_at = now()
  where id = v_user_id
  returning current_streak into v_new_streak;

  -- Build the evaluation context from the post-update aggregates.
  select games_won, games_played, best_streak, highest_score,
         lowest_moves, lowest_time_ms, lowest_undos,
         coins_earned_total, coins_spent_total
    into v_profile
    from public.profiles where id = v_user_id;

  v_context := jsonb_build_object(
    'won', p_won,
    'moves', p_moves,
    'duration_ms', p_duration_ms,
    'score', p_score,
    'undos', p_undos,
    'game_kind', p_game_kind,
    'daily_date', p_daily_date::text,
    'current_streak', v_new_streak,
    'best_streak', v_profile.best_streak,
    'total_games_won', v_profile.games_won,
    'total_games_played', v_profile.games_played,
    'highest_score', v_profile.highest_score,
    'lowest_moves', v_profile.lowest_moves,
    'lowest_time_ms', v_profile.lowest_time_ms,
    'lowest_undos', v_profile.lowest_undos,
    'total_coins_earned', v_profile.coins_earned_total,
    'total_coins_spent', v_profile.coins_spent_total
  );

  v_newly := check_achievements(v_user_id, v_context);

  -- Winning-Deal pool seed tracking.
  if p_won and p_game_kind = 'winning' and p_seed is not null then
    insert into public.played_seeds (user_id, seed)
    values (v_user_id, p_seed)
    on conflict do nothing;
  end if;

  -- Daily Challenge per-day best folding.
  if p_won and p_game_kind = 'daily' and p_daily_date is not null then
    insert into public.daily_results (user_id, date, seed, best_score, best_time_ms, best_moves, wins)
    values (v_user_id, p_daily_date, p_seed, p_score, p_duration_ms, p_moves, 1)
    on conflict (user_id, date) do update
    set seed = coalesce(public.daily_results.seed, excluded.seed),
        best_score = greatest(public.daily_results.best_score, excluded.best_score),
        best_time_ms = least(public.daily_results.best_time_ms, excluded.best_time_ms),
        best_moves = least(public.daily_results.best_moves, excluded.best_moves),
        wins = public.daily_results.wins + 1;
  end if;

  return jsonb_build_object('newly_unlocked_achievement_ids', v_newly);
end;
$$;

grant execute on function public.submit_game_result(
  boolean, integer, integer, integer, integer, bigint, text, date
) to authenticated;