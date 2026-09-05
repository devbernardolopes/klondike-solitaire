-- ============================================================
-- Klondike Solitaire - Supabase migration 025 (factory reset)
-- One-call user-data wipe for the Advanced > Factory Reset affordance.
-- Deletes/resets EVERYTHING owned by the calling user (anonymous or
-- linked) while preserving repository/catalog data and the session
-- itself (same user id stays signed in).
--
-- Preserved (explicitly NOT touched):
--   profiles.id / display_name / display_name_updated_at / is_anonymous /
--     coins_earned_total / leaderboard_visible / created_at (identity,
--     lifetime-earnings audit, and prefs survive)
--   game_results (append-only log kept for history/audit)
--   Repository/catalog: special_events, special_event_pages,
--     special_event_deals, winning_seeds, daily_seeds,
--     achievements_definitions, store_items, toast_config, leaderboard view
--
-- Wiped for the caller:
--   profiles stats + wallet: games_played/won, streaks, highest_score,
--     lowest_time_ms/moves/undos, total_time/moves_won, last_result_won,
--     loss_recovery_*, coins, coins_spent_total
--   played_seeds, daily_results, achievements_unlocked, owned_items,
--     game_sessions, game_starts,
--     event_deal_progress, event_page_progress, event_progress
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

  -- 1. Zero the Statistics-modal aggregates + wallet balance (keep the
  --    lifetime-earned audit column and identity columns intact).
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
      coins_spent_total = 0,
      updated_at = now()
  where id = v_user_id;

  -- 2. Per-user progress / history / ownership / sessions.
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
