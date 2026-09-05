-- ============================================================
-- Klondike Solitaire - Supabase migration 024 (drop dead objects)
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================
-- Removes DB objects that are no longer read or written by the app:
--   1. game_state — base-schema table (schema.sql) for a live-synced
--      in-progress board. Never referenced by src/scripts; the live
--      session mirror is game_sessions (migration 006, used by
--      sync/operations.js + sync/sessionPersistence.js).
--   2. Defensive re-drops of the flat Special Events model already
--      replaced by migration 022 (special_events v1 / special_event_seeds /
--      event_results + record_event_win). No-ops if 022 already ran;
--      they cover fresh or partially-migrated databases.
--
-- Drop-only: per the 022 comment the old event tables are empty in
-- production (eventCatalog.json / specialEvents.json ship events: []),
-- so there is no player data to preserve or migrate.
-- Explicitly NOT touched: game_sessions, game_results, daily_results,
-- played_seeds, winning_seeds, daily_seeds, special_events v2,
-- special_event_pages, special_event_deals, event_deal_progress,
-- event_page_progress, event_progress, profiles, achievements_*,
-- store_items, owned_items, toast_config, game_starts, leaderboard.
-- NOTE: special_events_seeds (plural) never existed — no DDL needed.
-- ============================================================

-- ------------------------------------------------------------
-- 1. game_state — dead table + its 4 RLS policies go with it
-- ------------------------------------------------------------
drop table if exists public.game_state cascade;

-- ------------------------------------------------------------
-- 2. Flat Special Events leftovers (belts + suspenders if 022 ran)
-- ------------------------------------------------------------
drop table if exists public.special_event_seeds cascade;
drop table if exists public.event_results cascade;
drop function if exists public.record_event_win(text, bigint);
