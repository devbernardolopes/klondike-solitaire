-- ============================================================
-- Klondike Solitaire — Supabase migration 006 (game_sessions)
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

-- ------------------------------------------------------------
-- game_sessions — per-user, per-device in-progress session
-- mirror. One row per (user, device) so every save is an upsert
-- into the same row (no duplicates across devices or repeated
-- deals on the same device). Plain per-user CRUD; no RPC.
-- ------------------------------------------------------------
create table if not exists public.game_sessions (
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id text not null,
  board_state jsonb not null,
  replay_spec jsonb,
  moves integer not null default 0,
  score integer not null default 0,
  undos integer not null default 0,
  start_time bigint,
  paused_accum_ms bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

alter table public.game_sessions enable row level security;

create policy "game_sessions_user_all"
  on public.game_sessions for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
