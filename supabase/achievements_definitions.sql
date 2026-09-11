-- ============================================================
-- Catalog dump — generated 2026-09-11T18:54:39.678Z
-- Source of truth for scripts/i18n-sync.mjs. Do not edit by hand.
-- Re-run `npm run catalog:dump` after any dashboard edits.
-- Idempotent: safe to paste into Supabase SQL editor and re-run.
-- ============================================================
INSERT INTO public.achievements_definitions (id, name, description) VALUES
  ('ace_collector', 'Ace Collector', 'Move all four Aces to Foundation before any other Foundation card.'),
  ('back_on_track', 'Back on Track', 'Win 3 games in a row after a loss.'),
  ('blitz', 'Blitz', 'Win a game in under 30 seconds.'),
  ('broken_chain', 'Broken Chain', 'Win a game immediately after losing a game.'),
  ('champion', 'Champion', 'Win 10,000 games.'),
  ('clean_hands', 'Clean Hands', 'Win a game without using Undo.'),
  ('clean_sweep', 'Clean Sweep', 'Win a game without moving any card from Foundation back to Tableau.'),
  ('comeback', 'Comeback', 'Lose a game and then establish a new personal win-streak record.'),
  ('first_things_first', 'First Things First', 'Move a card to Foundation before making any Tableau-to-Tableau move.'),
  ('flawless', 'Flawless', 'Win a game in under 105 moves.'),
  ('fortune', 'Fortune', 'Earn 10,000 coins.'),
  ('hot_hand', 'Hot Hand', 'Achieve a 25-game win streak.'),
  ('immortal', 'Immortal', 'Play 100,000 games.'),
  ('legendary', 'Legendary', 'Achieve a 500-game win streak.'),
  ('lightning', 'Lightning', 'Win a game in under 45 seconds.'),
  ('master', 'Master', 'Win 100,000 games.'),
  ('near_perfect', 'Near Perfect', 'Win a game in under 100 moves.'),
  ('no_assistance', 'No Assistance', 'Win a game without using a Hint.'),
  ('no_looking_back', 'No Looking Back', 'Win a game without recycling the Stock.'),
  ('one_pass', 'One Pass', 'Win a game with exactly one Stock recycle.'),
  ('perfect_game', 'Perfect Game', 'Win a game without using Undo or Hint.'),
  ('perfect_timing', 'Perfect Timing', 'Win a game in under 2 minutes and under 105 moves.'),
  ('pocket_change', 'Pocket Change', 'Earn 1,000 coins.'),
  ('precision', 'Precision', 'Win a game in under 110 moves.'),
  ('proven', 'Proven', 'Win 1,000 games.'),
  ('quick_draw', 'Quick Draw', 'Win a game in under 90 seconds and under 110 moves.'),
  ('seasoned', 'Seasoned', 'Play 1,000 games.'),
  ('sharp_play', 'Sharp Play', 'Win a game in under 120 moves.'),
  ('speed_demon', 'Speed Demon', 'Win a game in under 60 seconds and under 120 moves.'),
  ('unstoppable', 'Unstoppable', 'Achieve a 50-game win streak.'),
  ('untouchable', 'Untouchable', 'Achieve a 100-game win streak.'),
  ('veteran', 'Veteran', 'Play 10,000 games.')
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name,
  description = excluded.description;
