-- ============================================================
-- Klondike Solitaire — Supabase migration 037 (paid SVG line-art felts)
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================
-- Phase-2 paid table backgrounds. Client art already ships in
-- src/render/themes/felts.css + backgroundRegistry.js (keys below);
-- these rows only unlock them in the Store (kind='table_felt') and
-- surface them on the Theme > Background tab once owned.
-- After running, refresh the canonical dump so locales stay in sync:
--   npm run catalog:dump && npm run i18n:fix
-- ------------------------------------------------------------
-- Seed purchasable felt items (idempotent)
-- ------------------------------------------------------------
insert into public.store_items (id, name, description, price, kind, asset_ref, enabled, sort_order)
values
  ('bg-crimson-deco', 'Deco Fan', 'Art-deco fan lines on crimson felt.', 250, 'table_felt', 'crimson-deco', true, 0),
  ('bg-emerald-suits', 'Suit Outlines', 'Minimalist suit line-art on emerald felt.', 250, 'table_felt', 'emerald-suits', true, 0),
  ('bg-desert-topo', 'Dune Contours', 'Topographic contour lines on desert felt.', 300, 'table_felt', 'desert-topo', true, 0),
  ('bg-midnight-bauhaus', 'Bauhaus Arcs', 'Bauhaus arcs on midnight felt.', 300, 'table_felt', 'midnight-bauhaus', true, 0)
on conflict (id) do nothing;
