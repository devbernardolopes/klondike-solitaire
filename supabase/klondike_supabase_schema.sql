-- ============================================================
-- Klondike Solitaire — Supabase schema (Phase 1)
-- Paste this whole file into: Supabase Dashboard > SQL Editor
-- > New query > Run
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1. profiles
--    One row per auth user (anonymous or linked). Mutated only
--    by the RPC functions below and by the two triggers on
--    auth.users — never by direct client update.
-- ------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  is_anonymous boolean not null default true,
  coins integer not null default 0,
  games_played integer not null default 0,
  games_won integer not null default 0,
  current_streak integer not null default 0,
  best_streak integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

-- ------------------------------------------------------------
-- 2. Public leaderboard view — linked accounts only (v1 decision)
-- ------------------------------------------------------------
create view public.leaderboard as
  select id, display_name, coins, games_played, games_won,
         current_streak, best_streak
  from public.profiles
  where is_anonymous = false;

grant select on public.leaderboard to anon, authenticated;

-- ------------------------------------------------------------
-- 3. game_results — append-only log, written only via RPC
-- ------------------------------------------------------------
create table public.game_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  won boolean not null,
  moves integer not null,
  duration_seconds integer not null,
  created_at timestamptz not null default now()
);

alter table public.game_results enable row level security;

create policy "game_results_select_own"
  on public.game_results for select
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 4. achievements_unlocked
--    Just stores which achievement ids a user has earned.
--    Names/descriptions/icons live in the app, not the DB.
-- ------------------------------------------------------------
create table public.achievements_unlocked (
  user_id uuid not null references auth.users (id) on delete cascade,
  achievement_id text not null,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

alter table public.achievements_unlocked enable row level security;

create policy "achievements_unlocked_select_own"
  on public.achievements_unlocked for select
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 5. game_state — in-progress board, synced live.
--    Not tamper-sensitive the way coins/results are, so the
--    client is allowed to write it directly.
-- ------------------------------------------------------------
create table public.game_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.game_state enable row level security;

create policy "game_state_select_own"
  on public.game_state for select
  using (auth.uid() = user_id);

create policy "game_state_insert_own"
  on public.game_state for insert
  with check (auth.uid() = user_id);

create policy "game_state_update_own"
  on public.game_state for update
  using (auth.uid() = user_id);

create policy "game_state_delete_own"
  on public.game_state for delete
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 6. Auto-generated display names for new profiles
-- ------------------------------------------------------------
create or replace function public.generate_display_name()
returns text
language sql
as $$
  select (
    (array['Swift','Lucky','Quiet','Bold','Clever','Sly','Golden','Iron',
           'Silent','Nimble'])[floor(random() * 10 + 1)]
    || (array['Fox','Raven','Otter','Wolf','Hawk','Badger','Lynx','Heron',
              'Panther','Falcon'])[floor(random() * 10 + 1)]
    || floor(random() * 900 + 100)::text
  );
$$;

-- ------------------------------------------------------------
-- 7. Create a profile row whenever a new auth user appears
--    (fires for both anonymous and permanent sign-ups)
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, is_anonymous)
  values (new.id, public.generate_display_name(), coalesce(new.is_anonymous, false));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 8. Keep profiles.is_anonymous in sync when an anonymous user
--    links a permanent identity (e.g. Google)
-- ------------------------------------------------------------
create or replace function public.handle_user_linked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_anonymous = true and new.is_anonymous = false then
    update public.profiles set is_anonymous = false, updated_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_linked
  after update of is_anonymous on auth.users
  for each row execute function public.handle_user_linked();

-- ------------------------------------------------------------
-- 9. submit_game_result — the ONLY way coins/stats/achievements
--    ever change. Client calls it like:
--      supabase.rpc('submit_game_result', {
--        p_won: true, p_moves: 87, p_duration_seconds: 210
--      })
-- ------------------------------------------------------------
create or replace function public.submit_game_result(
  p_won boolean,
  p_moves integer,
  p_duration_seconds integer
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

  insert into public.game_results (user_id, won, moves, duration_seconds)
  values (v_user_id, p_won, p_moves, p_duration_seconds);

  if p_won then
    v_coins_awarded := 10; -- flat reward for now; tune later
  end if;

  update public.profiles
  set games_played = games_played + 1,
      games_won = games_won + case when p_won then 1 else 0 end,
      current_streak = case when p_won then current_streak + 1 else 0 end,
      best_streak = greatest(best_streak, case when p_won then current_streak + 1 else best_streak end),
      coins = coins + v_coins_awarded,
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
end;
$$;

grant execute on function public.submit_game_result(boolean, integer, integer) to authenticated;

-- ------------------------------------------------------------
-- 10. rename_display_name — the only way a user changes their name
-- ------------------------------------------------------------
create or replace function public.rename_display_name(p_display_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if length(trim(p_display_name)) < 1 or length(p_display_name) > 24 then
    raise exception 'Display name must be 1-24 characters';
  end if;
  update public.profiles
  set display_name = p_display_name, updated_at = now()
  where id = auth.uid();
end;
$$;

grant execute on function public.rename_display_name(text) to authenticated;
