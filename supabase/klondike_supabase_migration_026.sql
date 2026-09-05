-- ============================================================
-- Klondike Solitaire - Supabase migration 026 (factory reset fix)
-- Extends 025's factory_reset(): also wipe the lifetime-earnings audit
-- column and the append-only results log, which 025 preserved.
--
-- Wiped for the caller (full list):
--   profiles stats + wallet: games_played/won, streaks, highest_score,
--     lowest_time_ms/moves/undos, total_time/moves_won, last_result_won,
--     loss_recovery_*, coins, coins_earned_total, coins_spent_total
--   game_results, achievements_unlocked, played_seeds, daily_results,
--     owned_items, game_sessions, game_starts,
--     event_deal_progress, event_page_progress, event_progress
--
-- Preserved (explicitly NOT touched):
--   profiles.id / display_name / display_name_updated_at / is_anonymous /
--     leaderboard_visible / created_at (identity and prefs survive)
--   Repository/catalog: special_events, special_event_pages,
--     special_event_deals, winning_seeds, daily_seeds,
--     achievements_definitions, store_items, toast_config, leaderboard view
--
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

create or replace function public.factory_reset()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- 1. Zero the Statistics-modal aggregates + wallet (including the
  --    lifetime-earned total). Identity columns stay intact.
  update public.profiles
  set games_played = 0,
      games_won = 0,
      current_streak = 0,
      best_streak = 0,
      highest_score = 0,
      lowest_time_ms = null,
      lowest_moves = null,
      lowest_undos = null,
      total_time_ms_won = 0,
      total_moves_won = 0,
      last_result_won = null,
      loss_recovery_streak = 0,
      loss_recovery_baseline_best_streak = 0,
      coins = 0,
      coins_earned_total = 0,
      coins_spent_total = 0,
      updated_at = now()
  where id = v_user_id;

  -- 2. Per-user progress / history / ownership / sessions.
  delete from public.game_results where user_id = v_user_id;
  delete from public.achievements_unlocked where user_id = v_user_id;
  delete from public.played_seeds where user_id = v_user_id;
  delete from public.daily_results where user_id = v_user_id;
  delete from public.owned_items where user_id = v_user_id;
  delete from public.game_sessions where user_id = v_user_id;
  delete from public.game_starts where user_id = v_user_id;
  delete from public.event_deal_progress where user_id = v_user_id;
  delete from public.event_page_progress where user_id = v_user_id;
  delete from public.event_progress where user_id = v_user_id;
end;
$$;

grant execute on function public.factory_reset() to authenticated;
