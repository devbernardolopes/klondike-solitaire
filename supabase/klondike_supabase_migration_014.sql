-- ============================================================
-- Klondike Solitaire — Supabase migration 014 (remote seed pools)
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================
-- Moves the three bundled JSON pools (solvableSeeds, dailyChallenge,
-- specialEvents) into Supabase so seeds / events can be updated without
-- a Vercel redeploy. Client-side filtering stays sufficient for ~1k rows.
-- All tables are public-read (anon + authenticated) like
-- achievements_definitions / store_items — anonymous deals must work offline.
-- No client write policies; only service_role / scripts upsert.
-- ============================================================

-- ------------------------------------------------------------
-- 1. winning_seeds — pre-verified solvable pool (Winning Deal)
-- ------------------------------------------------------------
create table if not exists public.winning_seeds (
  seed bigint primary key,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.winning_seeds enable row level security;

drop policy if exists "winning_seeds_public_read" on public.winning_seeds;
create policy "winning_seeds_public_read"
  on public.winning_seeds for select
  to anon, authenticated
  using (true);

-- ------------------------------------------------------------
-- 2. daily_seeds — one row per calendar day (Daily Challenge)
-- ------------------------------------------------------------
create table if not exists public.daily_seeds (
  date date primary key,
  seed bigint not null unique,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.daily_seeds enable row level security;

drop policy if exists "daily_seeds_public_read" on public.daily_seeds;
create policy "daily_seeds_public_read"
  on public.daily_seeds for select
  to anon, authenticated
  using (true);

create index if not exists daily_seeds_date_idx on public.daily_seeds (date);

-- ------------------------------------------------------------
-- 3. special_events — curated event metadata (title + images)
-- ------------------------------------------------------------
create table if not exists public.special_events (
  id text primary key,
  title text not null,
  description text,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  image_paths text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.special_events enable row level security;

drop policy if exists "special_events_public_read" on public.special_events;
create policy "special_events_public_read"
  on public.special_events for select
  to anon, authenticated
  using (true);

-- ------------------------------------------------------------
-- 4. special_event_seeds — 50 seeds per event (FK to special_events)
-- ------------------------------------------------------------
create table if not exists public.special_event_seeds (
  event_id text not null references public.special_events (id) on delete cascade,
  seed bigint not null,
  sort_order integer not null default 0,
  primary key (event_id, seed)
);

alter table public.special_event_seeds enable row level security;

drop policy if exists "special_event_seeds_public_read" on public.special_event_seeds;
create policy "special_event_seeds_public_read"
  on public.special_event_seeds for select
  to anon, authenticated
  using (true);

create index if not exists special_event_seeds_event_idx on public.special_event_seeds (event_id);

-- ------------------------------------------------------------
-- 5. Storage buckets for event images + future award badges
--    (public-read, uploaded via dashboard — no client upload)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('event-images', 'event-images', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('award-badges', 'award-badges', true)
on conflict (id) do nothing;

drop policy if exists "event_images_public_read" on storage.objects;
create policy "event_images_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'event-images');

drop policy if exists "award_badges_public_read" on storage.objects;
create policy "award_badges_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'award-badges');
