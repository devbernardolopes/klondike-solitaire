-- ============================================================
-- Catalog dump — generated 2026-09-10T02:17:57.713Z
-- Source of truth for scripts/i18n-sync.mjs. Do not edit by hand.
-- Re-run `npm run catalog:dump` after any dashboard edits.
-- Idempotent: safe to paste into Supabase SQL editor and re-run.
-- ============================================================
INSERT INTO public.store_items (id, name, description) VALUES
  ('bg-noir', 'Noir', 'Deep black felt.'),
  ('bg-retro-crt', 'Retro CRT', 'Phosphor green tint.'),
  ('card-back-black', 'Black Card Back', 'A black-themed card back.'),
  ('card-back-golden', 'Golden Card Back', 'A golden-themed card back.'),
  ('card-back-gray', 'Gray Card Back', 'A gray-themed card back.'),
  ('card-back-green', 'Green Card Back', 'A green-themed card back.'),
  ('card-back-purple', 'Purple Card Back', 'A purple-themed card back.'),
  ('card-back-red', 'Red Card Back', 'A red-themed card back.')
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name,
  description = excluded.description;
