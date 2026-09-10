-- ============================================================
-- Klondike Solitaire — Supabase migration 034 (favorite_deals)
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

-- ------------------------------------------------------------
-- favorite_deals — per-user favorited deals (the Favorites modal).
-- One row per (user, seed): deal seeds are globally unique across
-- modes (winning pool / daily / special events / random — see
-- scripts/lib/seedRegistry.mjs + core/randomSeed.js), so the seed
-- alone identifies the deal. game_kind + the daily/event context
-- ride along so replaying a favorite restores the exact deal mode
-- (daily results, event progress) instead of a plain shuffle.
-- Plain per-user CRUD; no RPC (mirrors migration_006 game_sessions).
-- The client syncs through the offline-first outbox (add_favorite /
-- remove_favorite ops, last-write-wins per seed via dedupeKey) with
-- a local Dexie mirror for offline players.
-- ------------------------------------------------------------
create table if not exists public.favorite_deals (
  user_id uuid not null references auth.users (id) on delete cascade,
  seed bigint not null,
  game_kind text not null default 'winning',
  daily_date text,
  event_deal_id bigint,
  event_id text,
  created_at timestamptz not null default now(),
  primary key (user_id, seed)
);

alter table public.favorite_deals enable row level security;

create policy "favorite_deals_user_all"
  on public.favorite_deals for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Newest-first list reads for the Favorites modal.
create index if not exists favorite_deals_user_created_idx
  on public.favorite_deals (user_id, created_at desc, seed desc);
