-- ============================================================
-- Klondike Solitaire — Supabase migration 029 (sequential event deal numbers)
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================
-- Adds a per-event sequential deal number to special_event_deals so the
-- grid can show global Deal N across pages (page 1 with 4 deals → 1-4,
-- page 2 with 4 deals → 5-8, and so on) instead of the per-page `position`
-- that resets on every page. `position` is intentionally kept as-is: it
-- still drives the grid layout + postcard slicing (row-major, 1 = top-left).
--
-- Run this BEFORE authoring new events with scripts/generateEventSeeds.mjs
-- or scripts/createSpecialEvent.mjs — both now write deal_number on insert,
-- and the upsert in createSpecialEvent.mjs fails on a DB without the column.
-- Reads degrade gracefully: the client selects deal_number but falls back to
-- a computed N (and to the legacy select) when the column is absent, so the
-- app keeps working if this migration hasn't been run yet.
-- ============================================================

alter table public.special_event_deals
  add column if not exists deal_number integer;

-- Backfill existing rows: per event, in page_number + position order.
-- Idempotent — re-running recomputes the same numbers.
with ordered as (
  select d.id as deal_id,
    row_number() over (
      partition by sep.event_id
      order by sep.page_number, d."position", d.id
    ) as n
  from public.special_event_deals d
  join public.special_event_pages sep on sep.id = d.page_id
)
update public.special_event_deals d
set deal_number = o.n
from ordered o
where o.deal_id = d.id
  and (d.deal_number is null or d.deal_number <> o.n);

-- Enforce presence once backfilled (rows inserted pre-migration are covered
-- by the update above; not-null is what lets the client order by it).
alter table public.special_event_deals
  alter column deal_number set not null;

create index if not exists special_event_deals_number_idx
  on public.special_event_deals (deal_number);

comment on column public.special_event_deals."position" is
  'Per-page cell (1-indexed, resets per page). Drives grid layout + postcard slicing only.';
comment on column public.special_event_deals.deal_number is
  'Per-event sequential deal number (1-indexed across all pages, in page_number/position order). Displayed as Deal N.';
