-- ============================================================
-- Klondike Solitaire — Supabase migration 004 (data-driven achievements)
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

-- ------------------------------------------------------------
-- 1. achievements_definitions — catalog data, managed by Bernardo
--    directly in the table/SQL editor. No client insert/update/delete
--    policies: this is public read-only catalog data.
-- ------------------------------------------------------------
create table if not exists public.achievements_definitions (
  id text primary key,
  name text not null,
  description text not null,
  image_path text,
  condition jsonb not null,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.achievements_definitions enable row level security;

create policy "achievements_definitions_public_read"
  on public.achievements_definitions for select
  to anon, authenticated
  using (true);

-- ------------------------------------------------------------
-- 2. Storage bucket for achievement images (public-read; uploaded
--    manually via the dashboard — no client upload path in scope).
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('achievement-images', 'achievement-images', true)
on conflict (id) do nothing;

create policy "achievement_images_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'achievement-images');

-- ------------------------------------------------------------
-- 3. evaluate_condition — leaf / all / any semantics over a JSON
--    context. Compares by the JSON type of `value` so numeric ops
--    (<, <=, >, >=) work on numbers (not text).
-- ------------------------------------------------------------
create or replace function public.evaluate_condition(condition jsonb, context jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_field text;
  v_op text;
  v_val jsonb;
  v_ctx jsonb;
  v_typ text;
  a numeric;
  b numeric;
begin
  if condition ? 'all' then
    return (select bool_and(public.evaluate_condition(x, context)) from jsonb_array_elements(condition->'all') x);
  end if;
  if condition ? 'any' then
    return (select bool_or(public.evaluate_condition(x, context)) from jsonb_array_elements(condition->'any') x);
  end if;

  -- leaf
  v_field := condition->>'field';
  v_op := condition->>'op';
  v_val := condition->'value';
  v_ctx := context->v_field;

  if v_ctx is null then
    return false;
  end if;

  v_typ := jsonb_typeof(v_val);

  if v_typ = 'number' then
    a := v_ctx::numeric;
    b := v_val::numeric;
    return case v_op
      when '=' then a = b
      when '!=' then a <> b
      when '<' then a < b
      when '<=' then a <= b
      when '>' then a > b
      when '>=' then a >= b
      else false
    end;
  elsif v_typ = 'boolean' then
    return case v_op
      when '=' then (v_ctx::boolean = v_val::boolean)
      when '!=' then (v_ctx::boolean <> v_val::boolean)
      else false
    end;
  elsif v_typ = 'string' then
    return case v_op
      when '=' then (v_ctx::text = v_val::text)
      when '!=' then (v_ctx::text <> v_val::text)
      else false
    end;
  else
    return false;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 4. check_achievements — evaluate every enabled definition the user
--    hasn't unlocked yet, insert the satisfied ones, and return the
--    array of newly-unlocked ids (empty array if none).
-- ------------------------------------------------------------
create or replace function public.check_achievements(p_user_id uuid, p_context jsonb)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  newly text[] := '{}';
begin
  for r in
    select d.id, d.condition
    from public.achievements_definitions d
    where d.enabled
      and not exists (
        select 1 from public.achievements_unlocked u
        where u.user_id = p_user_id and u.achievement_id = d.id
      )
  loop
    if public.evaluate_condition(r.condition, p_context) then
      insert into public.achievements_unlocked (user_id, achievement_id)
      values (p_user_id, r.id)
      on conflict do nothing;
      newly := array_append(newly, r.id);
    end if;
  end loop;
  return newly;
end;
$$;

-- ------------------------------------------------------------
-- 5. Seed the two existing achievements (idempotent — never clobbers
--    rows Bernardo may have edited by hand).
-- ------------------------------------------------------------
insert into public.achievements_definitions (id, name, description, image_path, condition, enabled, sort_order)
values
  ('won_under_100_moves', 'Efficient Win', 'Win a game in under 100 moves.', null,
   '{"all":[{"field":"won","op":"=","value":true},{"field":"moves","op":"<","value":100}]}'::jsonb, true, 0),
  ('10_win_streak', 'On a Roll', 'Reach a 10-game win streak.', null,
   '{"field":"current_streak","op":">=","value":10}'::jsonb, true, 1)
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 6. submit_game_result — return type changes void -> jsonb, and the
--    two hardcoded achievement checks are replaced by check_achievements.
--    Every other side effect (game_results, coins, streak/personal
--    bests, played_seeds, daily_results) is preserved exactly.
-- ------------------------------------------------------------
drop function if exists public.submit_game_result(boolean, integer, integer, integer, integer, bigint, text, date);

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

  -- Build the evaluation context from the post-update aggregates.
  select games_won, games_played, best_streak, highest_score,
         lowest_moves, lowest_time_ms, lowest_undos
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
    'lowest_undos', v_profile.lowest_undos
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
