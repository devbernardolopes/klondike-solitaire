-- ============================================================
-- Klondike Solitaire — Supabase migration 022 (Special Events rebuild)
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================
-- Replaces the old flat "special_events / special_event_seeds / event_results"
-- model (migration 014 + 015) with a paginated model: an event has N pages,
-- each page is a square grid of pre-generated deals, each page reveals one
-- 512x512 postcard image as its deals are solved. Safe to run as a hard
-- replace — the old tables are empty in production (eventCatalog.json and
-- specialEvents.json both currently ship `events: []`), so there is no
-- player data to preserve or migrate.
--
-- Does NOT touch the `event-images` storage bucket created in migration 014
-- — that bucket + its public-read policy are reused as-is for postcards.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Drop the old model
-- ------------------------------------------------------------
drop function if exists public.record_event_win(text, bigint);
-- cascade takes special_event_seeds and event_results with it (both FK special_events)
drop table if exists public.special_events cascade;

-- ------------------------------------------------------------
-- 1. special_events — curated event metadata
-- ------------------------------------------------------------
create table public.special_events (
  id text primary key,
  title text not null,
  description text,
  enabled boolean not null default true,
  starts_at timestamptz not null,
  game_kind text not null default 'draw-1' check (game_kind in ('draw-1', 'draw-3')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.special_events enable row level security;

-- Visibility gate lives in the policy itself (not just client filtering) so an
-- event genuinely disappears — seeds, page structure, and postcard paths all
-- stay unreachable — until `enabled` and `starts_at` both clear. Once visible,
-- it stays visible/playable forever (no ends_at / expiry).
create policy "special_events_public_read"
  on public.special_events for select
  to anon, authenticated
  using (enabled and starts_at <= now());

-- ------------------------------------------------------------
-- 2. special_event_pages — one row per page within an event
-- ------------------------------------------------------------
create table public.special_event_pages (
  id bigint generated always as identity primary key,
  event_id text not null references public.special_events (id) on delete cascade,
  page_number integer not null,
  grid_size integer not null check (grid_size between 2 and 6),
  image_path text not null,
  coin_reward integer not null default 0,
  unique (event_id, page_number)
);

create index special_event_pages_event_idx on public.special_event_pages (event_id);

alter table public.special_event_pages enable row level security;

create policy "special_event_pages_public_read"
  on public.special_event_pages for select
  to anon, authenticated
  using (exists (
    select 1 from public.special_events se
    where se.id = special_event_pages.event_id
      and se.enabled and se.starts_at <= now()
  ));

-- ------------------------------------------------------------
-- 3. special_event_deals — the grid cells of a page (seed pool)
-- ------------------------------------------------------------
-- `position` is the sequential number shown on the cell (1-indexed, resets
-- per page). No DB-level check that count(deals) == grid_size^2 for a page —
-- author carefully; a future validation trigger could add this if desired.
create table public.special_event_deals (
  id bigint generated always as identity primary key,
  page_id bigint not null references public.special_event_pages (id) on delete cascade,
  "position" integer not null,
  seed bigint not null,
  unique (page_id, "position")
);

create index special_event_deals_page_idx on public.special_event_deals (page_id);

alter table public.special_event_deals enable row level security;

create policy "special_event_deals_public_read"
  on public.special_event_deals for select
  to anon, authenticated
  using (exists (
    select 1 from public.special_event_pages sep
    join public.special_events se on se.id = sep.event_id
    where sep.id = special_event_deals.page_id
      and se.enabled and se.starts_at <= now()
  ));

-- ------------------------------------------------------------
-- 4. Per-user progress — deal, page, event. Written ONLY by
--    submit_game_result (see submit_game_result.sql). No client
--    insert/update policy, same anti-tamper pattern as owned_items.
-- ------------------------------------------------------------
create table public.event_deal_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  deal_id bigint not null references public.special_event_deals (id) on delete cascade,
  score integer not null default 0,
  time_ms integer,
  moves integer,
  solved_at timestamptz not null default now(),
  primary key (user_id, deal_id)
);

alter table public.event_deal_progress enable row level security;

create policy "event_deal_progress_select_own"
  on public.event_deal_progress for select
  using (auth.uid() = user_id);

create table public.event_page_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  page_id bigint not null references public.special_event_pages (id) on delete cascade,
  coins_awarded integer not null default 0,
  completed_at timestamptz not null default now(),
  primary key (user_id, page_id)
);

alter table public.event_page_progress enable row level security;

create policy "event_page_progress_select_own"
  on public.event_page_progress for select
  using (auth.uid() = user_id);

create table public.event_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id text not null references public.special_events (id) on delete cascade,
  prize_claimed boolean not null default false,
  completed_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

alter table public.event_progress enable row level security;

create policy "event_progress_select_own"
  on public.event_progress for select
  using (auth.uid() = user_id);

-- ============================================================
-- Authoring reference (not executed) — how Christmas 2026 would be seeded
-- once you're ready, e.g. one week before Dec 25 2026:
--
-- insert into special_events (id, title, description, starts_at, game_kind, sort_order)
-- values ('christmas-2026', 'Christmas 2026', 'A festive three-page collection.', '2026-12-18T00:00:00Z', 'draw-1', 10);
--
-- insert into special_event_pages (event_id, page_number, grid_size, image_path, coin_reward) values
--   ('christmas-2026', 1, 2, 'christmas-2026/page1.png', 50),
--   ('christmas-2026', 2, 3, 'christmas-2026/page2.png', 100),
--   ('christmas-2026', 3, 4, 'christmas-2026/page3.png', 200);
--
-- -- deals for page 1 (2x2 = 4 seeds), referencing the page just inserted:
-- insert into special_event_deals (page_id, "position", seed)
-- select id, unnest(array[1,2,3,4]), unnest(array[111111,222222,333333,444444]::bigint[])
-- from special_event_pages where event_id = 'christmas-2026' and page_number = 1;
-- ============================================================