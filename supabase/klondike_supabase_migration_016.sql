-- ============================================================
-- Klondike Solitaire — Supabase migration 016 (fresh achievements)
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
--
-- Replaces the 7 legacy achievements with 36 tiered ones across 7
-- active categories (averages deferred per plan). Patches
-- purchase_item() and record_game_started() to call
-- check_achievements() so spend/played achievements unlock instantly
-- instead of only on the next win. Achievements that depend on
-- per-game won/duration/moves remain evaluated in
-- submit_game_result() as before.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Wipe legacy achievements
-- ------------------------------------------------------------
delete from public.achievements_definitions;

-- ------------------------------------------------------------
-- 2. Seed 36 tiered achievements
--    sort_order groups preserve category ordering in UI.
-- ------------------------------------------------------------
insert into public.achievements_definitions (id, name, description, image_path, condition, enabled, sort_order)
values
  -- Winning Streak (current_streak >=)
  ('3_win_streak', 'Three in a Row', 'Win 3 games in a row.', null, '{"field":"current_streak","op":">=","value":3}'::jsonb, true, 10),
  ('5_win_streak', 'On a Roll', 'Win 5 games in a row.', null, '{"field":"current_streak","op":">=","value":5}'::jsonb, true, 11),
  ('10_win_streak', 'Hot Streak', 'Win 10 games in a row.', null, '{"field":"current_streak","op":">=","value":10}'::jsonb, true, 12),
  ('20_win_streak', 'Unstoppable', 'Win 20 games in a row.', null, '{"field":"current_streak","op":">=","value":20}'::jsonb, true, 13),
  ('50_win_streak', 'Legendary Run', 'Win 50 games in a row.', null, '{"field":"current_streak","op":">=","value":50}'::jsonb, true, 14),

  -- Completion Time — fast (won + duration_ms <)
  ('won_under_60s', 'Quicksilver', 'Win a game in under 60 seconds.', null, '{"all":[{"field":"won","op":"=","value":true},{"field":"duration_ms","op":"<","value":60000}]}'::jsonb, true, 20),
  ('won_under_90s', 'Speed Demon', 'Win a game in under 90 seconds.', null, '{"all":[{"field":"won","op":"=","value":true},{"field":"duration_ms","op":"<","value":90000}]}'::jsonb, true, 21),
  ('won_under_120s', 'Swift Victory', 'Win a game in under 2 minutes.', null, '{"all":[{"field":"won","op":"=","value":true},{"field":"duration_ms","op":"<","value":120000}]}'::jsonb, true, 22),
  ('won_under_180s', 'Brisk Win', 'Win a game in under 3 minutes.', null, '{"all":[{"field":"won","op":"=","value":true},{"field":"duration_ms","op":"<","value":180000}]}'::jsonb, true, 23),
  ('won_under_240s', 'Steady Pace', 'Win a game in under 4 minutes.', null, '{"all":[{"field":"won","op":"=","value":true},{"field":"duration_ms","op":"<","value":240000}]}'::jsonb, true, 24),

  -- Completion Time — slow comical (won + duration_ms >=)
  ('won_over_15min', 'Taking Your Time', 'Win a game that lasted at least 15 minutes.', null, '{"all":[{"field":"won","op":"=","value":true},{"field":"duration_ms","op":">=","value":900000}]}'::jsonb, true, 25),
  ('won_over_30min', 'Marathon', 'Win a game that lasted at least 30 minutes.', null, '{"all":[{"field":"won","op":"=","value":true},{"field":"duration_ms","op":">=","value":1800000}]}'::jsonb, true, 26),

  -- Completion Moves — efficient (won + moves <)
  ('won_under_80_moves', 'Surgical', 'Win a game in under 80 moves.', null, '{"all":[{"field":"won","op":"=","value":true},{"field":"moves","op":"<","value":80}]}'::jsonb, true, 30),
  ('won_under_100_moves', 'Efficient', 'Win a game in under 100 moves.', null, '{"all":[{"field":"won","op":"=","value":true},{"field":"moves","op":"<","value":100}]}'::jsonb, true, 31),
  ('won_under_120_moves', 'Economical', 'Win a game in under 120 moves.', null, '{"all":[{"field":"won","op":"=","value":true},{"field":"moves","op":"<","value":120}]}'::jsonb, true, 32),
  ('won_under_150_moves', 'Well Played', 'Win a game in under 150 moves.', null, '{"all":[{"field":"won","op":"=","value":true},{"field":"moves","op":"<","value":150}]}'::jsonb, true, 33),

  -- Completion Moves — bloat comical (won + moves >=)
  ('won_over_250_moves', 'Winding Road', 'Win a game that took at least 250 moves.', null, '{"all":[{"field":"won","op":"=","value":true},{"field":"moves","op":">=","value":250}]}'::jsonb, true, 34),
  ('won_over_400_moves', 'Scenic Route', 'Win a game that took at least 400 moves.', null, '{"all":[{"field":"won","op":"=","value":true},{"field":"moves","op":">=","value":400}]}'::jsonb, true, 35),

  -- Total Games Played (total_games_played >=)
  ('played_1', 'First Steps', 'Play your first game.', null, '{"field":"total_games_played","op":">=","value":1}'::jsonb, true, 40),
  ('played_10', 'Getting Started', 'Play 10 games.', null, '{"field":"total_games_played","op":">=","value":10}'::jsonb, true, 41),
  ('played_50', 'Regular', 'Play 50 games.', null, '{"field":"total_games_played","op":">=","value":50}'::jsonb, true, 42),
  ('played_100', 'Dedicated', 'Play 100 games.', null, '{"field":"total_games_played","op":">=","value":100}'::jsonb, true, 43),
  ('played_500', 'Veteran', 'Play 500 games.', null, '{"field":"total_games_played","op":">=","value":500}'::jsonb, true, 44),

  -- Total Games Won (total_games_won >=)
  ('won_1', 'First Win', 'Win your first game.', null, '{"field":"total_games_won","op":">=","value":1}'::jsonb, true, 50),
  ('won_10', 'Winner', 'Win 10 games.', null, '{"field":"total_games_won","op":">=","value":10}'::jsonb, true, 51),
  ('won_50', 'Champion', 'Win 50 games.', null, '{"field":"total_games_won","op":">=","value":50}'::jsonb, true, 52),
  ('won_100', 'Master', 'Win 100 games.', null, '{"field":"total_games_won","op":">=","value":100}'::jsonb, true, 53),
  ('won_250', 'Grandmaster', 'Win 250 games.', null, '{"field":"total_games_won","op":">=","value":250}'::jsonb, true, 54),

  -- Total Coins Earned (total_coins_earned >=) — 10 per win
  ('earned_50', 'Pocket Change', 'Earn 50 coins.', null, '{"field":"total_coins_earned","op":">=","value":50}'::jsonb, true, 60),
  ('earned_100', 'Coin Collector', 'Earn 100 coins.', null, '{"field":"total_coins_earned","op":">=","value":100}'::jsonb, true, 61),
  ('earned_500', 'Treasure Hoard', 'Earn 500 coins.', null, '{"field":"total_coins_earned","op":">=","value":500}'::jsonb, true, 62),
  ('earned_1000', 'Fortune', 'Earn 1000 coins.', null, '{"field":"total_coins_earned","op":">=","value":1000}'::jsonb, true, 63),

  -- Total Coins Spent (total_coins_spent >=) — unlocked via purchase_item()
  ('spent_40', 'First Purchase', 'Spend 40 coins.', null, '{"field":"total_coins_spent","op":">=","value":40}'::jsonb, true, 70),
  ('spent_100', 'Spender', 'Spend 100 coins.', null, '{"field":"total_coins_spent","op":">=","value":100}'::jsonb, true, 71),
  ('spent_500', 'Big Spender', 'Spend 500 coins.', null, '{"field":"total_coins_spent","op":">=","value":500}'::jsonb, true, 72),
  ('spent_1000', 'High Roller', 'Spend 1000 coins.', null, '{"field":"total_coins_spent","op":">=","value":1000}'::jsonb, true, 73)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  image_path = excluded.image_path,
  condition = excluded.condition,
  enabled = excluded.enabled,
  sort_order = excluded.sort_order,
  updated_at = now();

-- ------------------------------------------------------------
-- 3. Patch purchase_item() to check achievements on spend
-- ------------------------------------------------------------
create or replace function public.purchase_item(p_item_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_price integer;
  v_enabled boolean;
  v_coins integer;
  v_context jsonb;
  v_newly text[];
  v_profile record;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select price, enabled into v_price, v_enabled
    from public.store_items
    where id = p_item_id;

  if v_price is null then
    raise exception 'Unknown item';
  end if;
  if not v_enabled then
    raise exception 'Item not available';
  end if;

  if exists (
    select 1 from public.owned_items
    where user_id = v_user_id and item_id = p_item_id
  ) then
    raise exception 'Item already owned';
  end if;

  select coins into v_coins from public.profiles where id = v_user_id for update;

  if v_coins < v_price then
    raise exception 'Insufficient coins';
  end if;

  update public.profiles
  set coins = coins - v_price,
      coins_spent_total = coins_spent_total + v_price,
      updated_at = now()
  where id = v_user_id;

  insert into public.owned_items (user_id, item_id) values (v_user_id, p_item_id);

  select games_won, games_played, best_streak, current_streak,
         highest_score, lowest_moves, lowest_time_ms, lowest_undos,
         coins_earned_total, coins_spent_total
    into v_profile
    from public.profiles where id = v_user_id;

  v_context := jsonb_build_object(
    'total_games_won', v_profile.games_won,
    'total_games_played', v_profile.games_played,
    'best_streak', v_profile.best_streak,
    'current_streak', v_profile.current_streak,
    'highest_score', v_profile.highest_score,
    'lowest_moves', v_profile.lowest_moves,
    'lowest_time_ms', v_profile.lowest_time_ms,
    'lowest_undos', v_profile.lowest_undos,
    'total_coins_earned', v_profile.coins_earned_total,
    'total_coins_spent', v_profile.coins_spent_total
  );

  v_newly := check_achievements(v_user_id, v_context);

  return jsonb_build_object('item_id', p_item_id, 'coins', v_coins - v_price, 'newly_unlocked_achievement_ids', v_newly);
end;
$$;

grant execute on function public.purchase_item(text) to authenticated;

-- ------------------------------------------------------------
-- 4. Patch record_game_started() for instant played_X unlocks
-- ------------------------------------------------------------
drop function if exists public.record_game_started();

create or replace function public.record_game_started()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_context jsonb;
  v_newly text[];
  v_profile record;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  update public.profiles
  set games_played = games_played + 1, updated_at = now()
  where id = v_user_id;

  select games_won, games_played, best_streak, current_streak,
         highest_score, lowest_moves, lowest_time_ms, lowest_undos,
         coins_earned_total, coins_spent_total
    into v_profile
    from public.profiles where id = v_user_id;

  v_context := jsonb_build_object(
    'total_games_won', v_profile.games_won,
    'total_games_played', v_profile.games_played,
    'best_streak', v_profile.best_streak,
    'current_streak', v_profile.current_streak,
    'highest_score', v_profile.highest_score,
    'lowest_moves', v_profile.lowest_moves,
    'lowest_time_ms', v_profile.lowest_time_ms,
    'lowest_undos', v_profile.lowest_undos,
    'total_coins_earned', v_profile.coins_earned_total,
    'total_coins_spent', v_profile.coins_spent_total
  );

  v_newly := check_achievements(v_user_id, v_context);

  return jsonb_build_object('newly_unlocked_achievement_ids', v_newly);
end;
$$;

grant execute on function public.record_game_started() to authenticated;
