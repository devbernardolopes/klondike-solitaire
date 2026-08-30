-- ============================================================
-- Klondike Solitaire — Supabase migration 013 (table felt backgrounds)
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

-- ------------------------------------------------------------
-- 1. Widen store_items.kind to include 'table_felt'
-- ------------------------------------------------------------
alter table public.store_items drop constraint if exists store_items_kind_check;
alter table public.store_items add constraint store_items_kind_check check (kind in ('card_back', 'table_felt'));

-- ------------------------------------------------------------
-- 2. Seed purchasable felt items (idempotent)
-- ------------------------------------------------------------
insert into public.store_items (id, name, description, price, kind, asset_ref, enabled, sort_order)
values
  ('bg-noir', 'Noir', 'Deep black felt.', 100, 'table_felt', 'noir', true, 0),
  ('bg-retro-crt', 'Retro CRT', 'Phosphor green tint.', 200, 'table_felt', 'retro-crt', true, 0)
on conflict (id) do nothing;
