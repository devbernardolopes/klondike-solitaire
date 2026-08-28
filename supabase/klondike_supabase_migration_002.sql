-- ============================================================
-- Klondike Solitaire — Supabase migration 002 (Phase 2 schema additions)
-- Extends the Phase 1 schema with: personal-best columns on profiles,
-- richer game_results, played_seeds, daily_results, and RPCs that match
-- the app's actual local semantics (games_played counted at game START,
-- not at game end; streak reset on abandonment, not just on a "loss").
--
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run.
-- Additive on top of the Phase 1 schema — safe to run now, no existing
-- game data assumed.
-- ============================================================

-- ------------------------------------------------------------
-- 1. profiles — add personal-best columns
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists highest_score integer not null default 0,
  add column if not exists lowest_time_ms integer,
  add column if not exists lowest_moves integer,
  add column if not exists lowest_undos integer;

-- ------------------------------------------------------------
-- 2. Recreate the public leaderboard view with the new columns
-- ------------------------------------------------------------
drop view if exists public.leaderboard;

create view public.leaderboard as
  select id, display_name, coins, games_played, games_won,
         current_streak, best_streak,
         highest_score, lowest_time_ms, lowest_moves, lowest_undos
  from public.profiles
  where is_anonymous = false;

grant select on public.leaderboard to anon, authenticated;

-- ------------------------------------------------------------
-- 3. game_results — rename duration_seconds -> duration_ms (matches the
--    app's actual millisecond precision) and add score/undos/seed/
--    game_kind so one submit call captures everything Board.jsx already
--    has at win time.
-- ------------------------------------------------------------
alter table public.game_results
  rename column duration_seconds to duration_ms;

alter table public.game_results
  add column if not exists score integer not null default 0,
  add column if not exists undos integer not null default 0,
  add column if not exists seed bigint,
  add column if not exists game_kind text; -- 'winning' | 'random' | 'daily'

-- ------------------------------------------------------------
-- 4. played_seeds — Winning-Deal seeds the user has won
--    (mirrors src/db/playedSeeds.js)
-- ------------------------------------------------------------
create table if not exists public.played_seeds (
  user_id uuid not null references auth.users (id) on delete cascade,
  seed bigint not null,
  won_at timestamptz not null default now(),
  primary key (user_id, seed)
);

alter table public.played_seeds enable row level security;

create policy "played_seeds_select_own"
  on public.played_seeds for select
  using (auth.uid() = user_id);

-- No client insert policy: written only by submit_game_result().

-- ------------------------------------------------------------
-- 5. daily_results — Daily Challenge per-day bests
--    (mirrors src/db/dailyResults.js)
-- ------------------------------------------------------------
create table if not exists public.daily_results (
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  seed bigint,
  best_score integer not null default 0,
  best_time_ms integer,
  best_moves integer,
  wins integer not null default 0,
  primary key (user_id, date)
);

alter table public.daily_results enable row level security;

create policy "daily_results_select_own"
  on public.daily_results for select
  using (auth.uid() = user_id);

-- No client insert policy: written only by submit_game_result().

-- ------------------------------------------------------------
-- 6. record_game_started — increments games_played at the moment a
--    game's timer actually starts (matches useStatsStore.startTimerIfValid
--    -> useStatisticsStore.recordGamePlayed locally). Deliberately separate
--    from submit_game_result, which now fires only on a finished win.
-- ------------------------------------------------------------
create or replace function public.record_game_started()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set games_played = games_played + 1, updated_at = now()
  where id = auth.uid();
end;
$$;

grant execute on function public.record_game_started() to authenticated;

-- ------------------------------------------------------------
-- 7. record_game_abandoned — breaks the current streak when a game is
--    replaced by a new deal without being won (matches
--    useStatisticsStore.finalizeGame's dbRecordLoss branch).
-- ------------------------------------------------------------
create or replace function public.record_game_abandoned()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set current_streak = 0, updated_at = now()
  where id = auth.uid();
end;
$$;

grant execute on function public.record_game_abandoned() to authenticated;

-- ------------------------------------------------------------
-- 8. submit_game_result — replaces the Phase 1 version. No longer
--    touches games_played (record_game_started owns that now). Adds
--    score/undos/seed/game_kind/daily_date so one call captures a full
--    win: game_results row, coins, streak, personal bests, achievement
--    checks, played-seed tracking, and Daily Challenge folding —
--    atomically, in one transaction.
-- ------------------------------------------------------------
drop function if exists public.submit_game_result(boolean, integer, integer);

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
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_new_streak integer;
  v_coins_awarded integer := 0;
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
      updated_at = now()
  where id = v_user_id
  returning current_streak into v_new_streak;

  -- Achievement checks — extend this as the achievement list grows.
  if p_won and p_moves < 100 then
    insert into public.achievements_unlocked (user_id, achievement_id)
    values (v_user_id, 'won_under_100_moves')
    on conflict do nothing;
  end if;

  if v_new_streak >= 10 then
    insert into public.achievements_unlocked (user_id, achievement_id)
    values (v_user_id, '10_win_streak')
    on conflict do nothing;
  end if;

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
end;
$$;

grant execute on function public.submit_game_result(
  boolean, integer, integer, integer, integer, bigint, text, date
) to authenticated;
