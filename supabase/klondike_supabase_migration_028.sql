-- ============================================================
-- Klondike Solitaire - Supabase migration 028 (factory-reset marker)
-- Lets devices OTHER than the one that triggered a Factory Reset notice
-- the wipe and clear their own stale Dexie caches. A reset timestamp is
-- stamped on the profile by factory_reset(); every client compares it
-- against its locally remembered value on profile pulls and Special
-- Events fetches, and self-wipes when the remote marker is newer.
--
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

alter table public.profiles
  add column if not exists factory_reset_at timestamptz;

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
  --    lifetime-earned total). Identity columns stay intact. Stamp the
  --    reset so other devices can detect it.
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
      factory_reset_at = now(),
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
