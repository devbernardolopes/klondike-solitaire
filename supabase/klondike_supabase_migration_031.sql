-- ============================================================
-- Klondike Solitaire — Supabase migration 031 (event teaser window)
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================
-- Shows events starting within the next 7 days in the Special Events
-- list as disabled teasers (title + starts_at only). Only the
-- `special_events` metadata policy widens to
-- `starts_at <= now() + interval '7 days'`.
--
-- `special_event_pages` / `special_event_deals` policies stay at
-- `starts_at <= now()` on purpose, so page structure, seeds, and
-- postcard image paths remain unreachable until the event actually
-- starts. The client renders teasers as non-clickable buttons and
-- never opens the detail modal for them.
-- ============================================================

drop policy if exists "special_events_public_read" on public.special_events;

create policy "special_events_public_read"
  on public.special_events for select
  to anon, authenticated
  using (enabled and starts_at <= now() + interval '7 days');

-- ============================================================
-- Testing note: verify with:
--   insert a draft event starting in ~3 days, then as anon:
--   select id, starts_at from special_events;  -- row visible
--   select * from special_event_pages where event_id = '<id>';  -- 0 rows
-- ============================================================
