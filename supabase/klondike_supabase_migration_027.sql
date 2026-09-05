-- ============================================================
-- Klondike Solitaire - Supabase migration 027 (game history index)
-- Adds a composite index for the History view's per-user, newest-first
-- paged reads over game_results. The table already has row-level scoping
-- (game_results_select_own: auth.uid() = user_id) and a unique
-- (user_id, game_id) dedupe key; this index serves the
-- WHERE user_id = ? ORDER BY created_at DESC, id DESC access pattern so
-- history pagination stays fast as the table grows.
--
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

create index if not exists game_results_user_created_idx
  on public.game_results (user_id, created_at desc, id desc);
