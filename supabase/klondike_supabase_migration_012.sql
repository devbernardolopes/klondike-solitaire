-- ============================================================
-- Klondike Solitaire — Supabase migration 012 (leaderboard scope + coins)
--
-- 1. profiles.leaderboard_visible — opt-out flag so a user can choose not to
--    appear on the public leaderboard. Defaults to true (visible) so existing
--    accounts keep showing until they opt out.
-- 2. public.leaderboard view — recreate to:
--      - expose coins_earned_total (lifetime coins earned; the Coins category
--        now ranks by this instead of the mutable coins balance), and
--      - drop the `is_anonymous = false` filter and instead show every account
--        that has leaderboard_visible = true (so anonymous sessions appear too,
--        and the opt-out hides the row globally).
-- 3. set_leaderboard_visible(p_visible) — SECURITY DEFINER RPC (mirrors
--    reset_achievements / rename_display_name) so the client can flip the flag
--    without any direct UPDATE RLS policy on profiles.
--
-- Depends on migration 009 (adds coins_earned_total) and 010 (credits it in
-- submit_game_result). Apply 009 -> 012 in order if not already run.
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. profiles — opt-out flag for the public leaderboard
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists leaderboard_visible boolean not null default true;

-- ------------------------------------------------------------
-- 2. Recreate the public leaderboard view: include coins_earned_total and
--    show all (non-opted-out) accounts, not just linked ones.
-- ------------------------------------------------------------
drop view if exists public.leaderboard;

create view public.leaderboard as
  select id, display_name, coins, games_played, games_won,
         current_streak, best_streak, highest_score, lowest_time_ms,
         lowest_moves, lowest_undos, coins_earned_total
  from public.profiles
  where leaderboard_visible = true;

grant select on public.leaderboard to anon, authenticated;

-- ------------------------------------------------------------
-- 3. set_leaderboard_visible — flip the opt-out flag for the caller
-- ------------------------------------------------------------
create or replace function public.set_leaderboard_visible(p_visible boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  update public.profiles
    set leaderboard_visible = p_visible, updated_at = now()
    where id = auth.uid();
end;
$$;

grant execute on function public.set_leaderboard_visible(boolean) to authenticated;
