-- ============================================================
-- Klondike Solitaire — Supabase migration 017 (extended achievements)
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
--
-- Adds 28 tiers (100-1000 streak, sub-50/40/30s speed, 1k-100k
-- played, 500-10k total wins, 5k-1M earned/spent) and normalizes
-- image_path to '<id>.jpg' for all achievements. Also renames
-- existing tiers to a consistent scheme. Existing unlocks are
-- preserved (ON CONFLICT DO UPDATE); no RPC changes needed —
-- 016 already patches purchase_item/record_game_started to call
-- check_achievements.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Upsert 64 achievements (36 existing renamed/fixed + 28 new).
--    image_path = id || '.jpg' for every row per requirement.
-- ------------------------------------------------------------
insert into public.achievements_definitions (id, name, description, image_path, condition, enabled, sort_order)
values
  -- Winning Streak (current_streak >=) — 5 existing + 4 new
  ('3_win_streak', 'Win Streak 3', 'Win 3 games in a row.', '3_win_streak.jpg', '{"field":"current_streak","op":">=","value":3}'::jsonb, true, 10),
  ('5_win_streak', 'Win Streak 5', 'Win 5 games in a row.', '5_win_streak.jpg', '{"field":"current_streak","op":">=","value":5}'::jsonb, true, 11),
  ('10_win_streak', 'Win Streak 10', 'Win 10 games in a row.', '10_win_streak.jpg', '{"field":"current_streak","op":">=","value":10}'::jsonb, true, 12),
  ('20_win_streak', 'Win Streak 20', 'Win 20 games in a row.', '20_win_streak.jpg', '{"field":"current_streak","op":">=","value":20}'::jsonb, true, 13),
  ('50_win_streak', 'Win Streak 50', 'Win 50 games in a row.', '50_win_streak.jpg', '{"field":"current_streak","op":">=","value":50}'::jsonb, true, 14),
  ('100_win_streak', 'Win Streak 100', 'Win 100 games in a row.', '100_win_streak.jpg', '{"field":"current_streak","op":">=","value":100}'::jsonb, true, 15),
  ('200_win_streak', 'Win Streak 200', 'Win 200 games in a row.', '200_win_streak.jpg', '{"field":"current_streak","op":">=","value":200}'::jsonb, true, 16),
  ('500_win_streak', 'Win Streak 500', 'Win 500 games in a row.', '500_win_streak.jpg', '{"field":"current_streak","op":">=","value":500}'::jsonb, true, 17),
  ('1000_win_streak', 'Win Streak 1000', 'Win 1000 games in a row.', '1000_win_streak.jpg', '{"field":"current_streak","op":">=","value":1000}'::jsonb, true, 18),

  -- Completion Time — fast (won + duration_ms <) — 5 existing + 3 new
  ('won_under_60s', 'Win in Under 60s', 'Win a game in under 60 seconds.', 'won_under_60s.jpg', '{"all":[{"field":"won","op":"=","value":true},{"field":"duration_ms","op":"<","value":60000}]}'::jsonb, true, 20),
  ('won_under_90s', 'Win in Under 90s', 'Win a game in under 90 seconds.', 'won_under_90s.jpg', '{"all":[{"field":"won","op":"=","value":true},{"field":"duration_ms","op":"<","value":90000}]}'::jsonb, true, 21),
  ('won_under_120s', 'Win in Under 120s', 'Win a game in under 2 minutes.', 'won_under_120s.jpg', '{"all":[{"field":"won","op":"=","value":true},{"field":"duration_ms","op":"<","value":120000}]}'::jsonb, true, 22),
  ('won_under_180s', 'Win in Under 180s', 'Win a game in under 3 minutes.', 'won_under_180s.jpg', '{"all":[{"field":"won","op":"=","value":true},{"field":"duration_ms","op":"<","value":180000}]}'::jsonb, true, 23),
  ('won_under_240s', 'Win in Under 240s', 'Win a game in under 4 minutes.', 'won_under_240s.jpg', '{"all":[{"field":"won","op":"=","value":true},{"field":"duration_ms","op":"<","value":240000}]}'::jsonb, true, 24),
  ('won_under_50s', 'Win in Under 50s', 'Win a game in under 50 seconds.', 'won_under_50s.jpg', '{"all":[{"field":"won","op":"=","value":true},{"field":"duration_ms","op":"<","value":50000}]}'::jsonb, true, 25),
  ('won_under_40s', 'Win in Under 40s', 'Win a game in under 40 seconds.', 'won_under_40s.jpg', '{"all":[{"field":"won","op":"=","value":true},{"field":"duration_ms","op":"<","value":40000}]}'::jsonb, true, 26),
  ('won_under_30s', 'Win in Under 30s', 'Win a game in under 30 seconds.', 'won_under_30s.jpg', '{"all":[{"field":"won","op":"=","value":true},{"field":"duration_ms","op":"<","value":30000}]}'::jsonb, true, 27),

  -- Completion Time — slow comical (won + duration_ms >=) — 2 existing
  ('won_over_15min', 'Win Over 15 Minutes', 'Win a game that lasted at least 15 minutes.', 'won_over_15min.jpg', '{"all":[{"field":"won","op":"=","value":true},{"field":"duration_ms","op":">=","value":900000}]}'::jsonb, true, 28),
  ('won_over_30min', 'Win Over 30 Minutes', 'Win a game that lasted at least 30 minutes.', 'won_over_30min.jpg', '{"all":[{"field":"won","op":"=","value":true},{"field":"duration_ms","op":">=","value":1800000}]}'::jsonb, true, 29),

  -- Completion Moves — efficient (won + moves <) — 4 existing
  ('won_under_80_moves', 'Win in Under 80 Moves', 'Win a game in under 80 moves.', 'won_under_80_moves.jpg', '{"all":[{"field":"won","op":"=","value":true},{"field":"moves","op":"<","value":80}]}'::jsonb, true, 30),
  ('won_under_100_moves', 'Win in Under 100 Moves', 'Win a game in under 100 moves.', 'won_under_100_moves.jpg', '{"all":[{"field":"won","op":"=","value":true},{"field":"moves","op":"<","value":100}]}'::jsonb, true, 31),
  ('won_under_120_moves', 'Win in Under 120 Moves', 'Win a game in under 120 moves.', 'won_under_120_moves.jpg', '{"all":[{"field":"won","op":"=","value":true},{"field":"moves","op":"<","value":120}]}'::jsonb, true, 32),
  ('won_under_150_moves', 'Win in Under 150 Moves', 'Win a game in under 150 moves.', 'won_under_150_moves.jpg', '{"all":[{"field":"won","op":"=","value":true},{"field":"moves","op":"<","value":150}]}'::jsonb, true, 33),

  -- Completion Moves — bloat comical (won + moves >=) — 2 existing
  ('won_over_250_moves', 'Win Over 250 Moves', 'Win a game that took at least 250 moves.', 'won_over_250_moves.jpg', '{"all":[{"field":"won","op":"=","value":true},{"field":"moves","op":">=","value":250}]}'::jsonb, true, 34),
  ('won_over_400_moves', 'Win Over 400 Moves', 'Win a game that took at least 400 moves.', 'won_over_400_moves.jpg', '{"all":[{"field":"won","op":"=","value":true},{"field":"moves","op":">=","value":400}]}'::jsonb, true, 35),

  -- Total Games Played (total_games_played >=) — 5 existing + 5 new
  ('played_1', 'Played 1 Game', 'Play 1 game.', 'played_1.jpg', '{"field":"total_games_played","op":">=","value":1}'::jsonb, true, 40),
  ('played_10', 'Played 10 Games', 'Play 10 games.', 'played_10.jpg', '{"field":"total_games_played","op":">=","value":10}'::jsonb, true, 41),
  ('played_50', 'Played 50 Games', 'Play 50 games.', 'played_50.jpg', '{"field":"total_games_played","op":">=","value":50}'::jsonb, true, 42),
  ('played_100', 'Played 100 Games', 'Play 100 games.', 'played_100.jpg', '{"field":"total_games_played","op":">=","value":100}'::jsonb, true, 43),
  ('played_500', 'Played 500 Games', 'Play 500 games.', 'played_500.jpg', '{"field":"total_games_played","op":">=","value":500}'::jsonb, true, 44),
  ('played_1000', 'Played 1000 Games', 'Play 1000 games.', 'played_1000.jpg', '{"field":"total_games_played","op":">=","value":1000}'::jsonb, true, 45),
  ('played_5000', 'Played 5000 Games', 'Play 5000 games.', 'played_5000.jpg', '{"field":"total_games_played","op":">=","value":5000}'::jsonb, true, 46),
  ('played_10000', 'Played 10000 Games', 'Play 10000 games.', 'played_10000.jpg', '{"field":"total_games_played","op":">=","value":10000}'::jsonb, true, 47),
  ('played_50000', 'Played 50000 Games', 'Play 50000 games.', 'played_50000.jpg', '{"field":"total_games_played","op":">=","value":50000}'::jsonb, true, 48),
  ('played_100000', 'Played 100000 Games', 'Play 100000 games.', 'played_100000.jpg', '{"field":"total_games_played","op":">=","value":100000}'::jsonb, true, 49),

  -- Total Games Won (total_games_won >=) — 5 existing + 4 new
  ('won_1', 'Won 1 Game', 'Win 1 game.', 'won_1.jpg', '{"field":"total_games_won","op":">=","value":1}'::jsonb, true, 50),
  ('won_10', 'Won 10 Games', 'Win 10 games.', 'won_10.jpg', '{"field":"total_games_won","op":">=","value":10}'::jsonb, true, 51),
  ('won_50', 'Won 50 Games', 'Win 50 games.', 'won_50.jpg', '{"field":"total_games_won","op":">=","value":50}'::jsonb, true, 52),
  ('won_100', 'Won 100 Games', 'Win 100 games.', 'won_100.jpg', '{"field":"total_games_won","op":">=","value":100}'::jsonb, true, 53),
  ('won_250', 'Won 250 Games', 'Win 250 games.', 'won_250.jpg', '{"field":"total_games_won","op":">=","value":250}'::jsonb, true, 54),
  ('won_500', 'Won 500 Games', 'Win 500 games.', 'won_500.jpg', '{"field":"total_games_won","op":">=","value":500}'::jsonb, true, 55),
  ('won_1000', 'Won 1000 Games', 'Win 1000 games.', 'won_1000.jpg', '{"field":"total_games_won","op":">=","value":1000}'::jsonb, true, 56),
  ('won_5000', 'Won 5000 Games', 'Win 5000 games.', 'won_5000.jpg', '{"field":"total_games_won","op":">=","value":5000}'::jsonb, true, 57),
  ('won_10000', 'Won 10000 Games', 'Win 10000 games.', 'won_10000.jpg', '{"field":"total_games_won","op":">=","value":10000}'::jsonb, true, 58),

  -- Total Coins Earned (total_coins_earned >=) — 4 existing + 6 new
  ('earned_50', 'Earned 50 Coins', 'Earn 50 coins.', 'earned_50.jpg', '{"field":"total_coins_earned","op":">=","value":50}'::jsonb, true, 60),
  ('earned_100', 'Earned 100 Coins', 'Earn 100 coins.', 'earned_100.jpg', '{"field":"total_coins_earned","op":">=","value":100}'::jsonb, true, 61),
  ('earned_500', 'Earned 500 Coins', 'Earn 500 coins.', 'earned_500.jpg', '{"field":"total_coins_earned","op":">=","value":500}'::jsonb, true, 62),
  ('earned_1000', 'Earned 1000 Coins', 'Earn 1000 coins.', 'earned_1000.jpg', '{"field":"total_coins_earned","op":">=","value":1000}'::jsonb, true, 63),
  ('earned_5000', 'Earned 5000 Coins', 'Earn 5000 coins.', 'earned_5000.jpg', '{"field":"total_coins_earned","op":">=","value":5000}'::jsonb, true, 64),
  ('earned_10000', 'Earned 10000 Coins', 'Earn 10000 coins.', 'earned_10000.jpg', '{"field":"total_coins_earned","op":">=","value":10000}'::jsonb, true, 65),
  ('earned_50000', 'Earned 50000 Coins', 'Earn 50000 coins.', 'earned_50000.jpg', '{"field":"total_coins_earned","op":">=","value":50000}'::jsonb, true, 66),
  ('earned_100000', 'Earned 100000 Coins', 'Earn 100000 coins.', 'earned_100000.jpg', '{"field":"total_coins_earned","op":">=","value":100000}'::jsonb, true, 67),
  ('earned_500000', 'Earned 500000 Coins', 'Earn 500000 coins.', 'earned_500000.jpg', '{"field":"total_coins_earned","op":">=","value":500000}'::jsonb, true, 68),
  ('earned_1000000', 'Earned 1000000 Coins', 'Earn 1000000 coins.', 'earned_1000000.jpg', '{"field":"total_coins_earned","op":">=","value":1000000}'::jsonb, true, 69),

  -- Total Coins Spent (total_coins_spent >=) — 4 existing + 6 new
  ('spent_40', 'Spent 40 Coins', 'Spend 40 coins.', 'spent_40.jpg', '{"field":"total_coins_spent","op":">=","value":40}'::jsonb, true, 70),
  ('spent_100', 'Spent 100 Coins', 'Spend 100 coins.', 'spent_100.jpg', '{"field":"total_coins_spent","op":">=","value":100}'::jsonb, true, 71),
  ('spent_500', 'Spent 500 Coins', 'Spend 500 coins.', 'spent_500.jpg', '{"field":"total_coins_spent","op":">=","value":500}'::jsonb, true, 72),
  ('spent_1000', 'Spent 1000 Coins', 'Spend 1000 coins.', 'spent_1000.jpg', '{"field":"total_coins_spent","op":">=","value":1000}'::jsonb, true, 73),
  ('spent_5000', 'Spent 5000 Coins', 'Spend 5000 coins.', 'spent_5000.jpg', '{"field":"total_coins_spent","op":">=","value":5000}'::jsonb, true, 74),
  ('spent_10000', 'Spent 10000 Coins', 'Spend 10000 coins.', 'spent_10000.jpg', '{"field":"total_coins_spent","op":">=","value":10000}'::jsonb, true, 75),
  ('spent_50000', 'Spent 50000 Coins', 'Spend 50000 coins.', 'spent_50000.jpg', '{"field":"total_coins_spent","op":">=","value":50000}'::jsonb, true, 76),
  ('spent_100000', 'Spent 100000 Coins', 'Spend 100000 coins.', 'spent_100000.jpg', '{"field":"total_coins_spent","op":">=","value":100000}'::jsonb, true, 77),
  ('spent_500000', 'Spent 500000 Coins', 'Spend 500000 coins.', 'spent_500000.jpg', '{"field":"total_coins_spent","op":">=","value":500000}'::jsonb, true, 78),
  ('spent_1000000', 'Spent 1000000 Coins', 'Spend 1000000 coins.', 'spent_1000000.jpg', '{"field":"total_coins_spent","op":">=","value":1000000}'::jsonb, true, 79)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  image_path = excluded.image_path,
  condition = excluded.condition,
  enabled = excluded.enabled,
  sort_order = excluded.sort_order,
  updated_at = now();
