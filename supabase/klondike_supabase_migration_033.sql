-- ============================================================
-- Klondike Solitaire — Supabase migration 033 (DB-driven game-over limits)
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================
-- Moves the hard game-over limits (30:00 elapsed, 500 moves) out of the
-- client constants (useStatsStore MAX_TIME_MS / MAX_MOVES) into
-- admin-settable tables that the client NEVER writes:
--
--   game_limit_rules      per-game_kind max elapsed time + max moves
--   game_limit_settings   global fallback pair for unknown kinds
--   game_limit_flags      append-only anomaly log (rejected over-limit
--                         wins) for review — no client access, written
--                         only by submit_game_result.
--
-- Enforcement model (mirrors the coin_reward_* tables from migration_032,
-- adapted: limits must fire instantly and offline, so the client enforces
-- from its cache while the server judges on flush):
--   1. The client polls/checks against its cached config (bundled seed ->
--      Dexie snapshot -> live SELECT) and freezes the game at the limit.
--      Stale cache only ever enforces older values; behavior is unchanged
--      when the cache matches the tables.
--   2. The RPC accepts FACTS only (kind/moves/duration) — never a verdict.
--      On flush it compares a claimed WIN against the live tables.
--   3. An over-limit win is REJECTED: the game_results row is recorded as a
--      LOSS (history/leaderboard stay truthful), no win credit is applied
--      (no streak, no bests, no coins, no achievements, no played-seed /
--      daily / event progress), a game_limit_flags row is written, and the
--      response carries limit_rejected:true plus the authoritative limits
--      so the client rolls back its optimistic win and refreshes its cache.
--   4. Deliberately NOT an exception: a raise would fail the sync op
--      forever and wedge the client's outbox (same flag-not-raise rule as
--      implausible/rate-capped coin rewards).
--   5. Losses are never judged (a limit-ended game legitimately exceeds).
-- Client impact: NONE on the RPC signature (same 20 args). The response
-- JSON gains limit_rejected / limit_max_time_ms / limit_max_moves keys the
-- client uses to roll back a rejected optimistic win. Offline flow
-- unchanged: the outbox submits facts on reconnect; the server judges then.
--
-- Fairness note: rejection compares against the CURRENT table values, so a
-- win queued offline under older (looser) limits is judged by the newer
-- ones. Retune limits with that in mind; every rejection is logged with
-- the facts and the limits that judged it.
--
-- To retune limits, edit the tables directly, e.g.:
--   update game_limit_rules set max_moves = 600 where game_kind = 'daily';
--   update game_limit_settings set value_int = 3600000
--     where key = 'fallback_max_time_ms';
-- ============================================================

-- ------------------------------------------------------------
-- 1. Limit tables (admin-settable; client gets SELECT only)
-- ------------------------------------------------------------

create table if not exists public.game_limit_rules (
  game_kind text primary key,
  max_time_ms integer not null check (max_time_ms > 0),
  max_moves integer not null check (max_moves > 0)
);

create table if not exists public.game_limit_settings (
  key text primary key,
  value_int integer not null
);

-- Anomaly log: written by the RPC only. No client policies are created on
-- purpose — with RLS enabled and zero policies, all client roles are denied
-- while SECURITY DEFINER functions still write.
create table if not exists public.game_limit_flags (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  game_id uuid,
  reason text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.game_limit_rules enable row level security;
alter table public.game_limit_settings enable row level security;
alter table public.game_limit_flags enable row level security;

drop policy if exists "game_limit_rules_public_read" on public.game_limit_rules;
create policy "game_limit_rules_public_read"
  on public.game_limit_rules for select
  to anon, authenticated
  using (true);

drop policy if exists "game_limit_settings_public_read" on public.game_limit_settings;
create policy "game_limit_settings_public_read"
  on public.game_limit_settings for select
  to anon, authenticated
  using (true);

-- ------------------------------------------------------------
-- 2. Seed defaults (insert-only — re-running never overwrites admin edits)
-- ------------------------------------------------------------

insert into public.game_limit_rules (game_kind, max_time_ms, max_moves)
values
  ('winning', 1800000, 500),
  ('daily',   1800000, 500),
  ('random',  1800000, 500),
  ('event',   1800000, 500)
on conflict (game_kind) do nothing;

insert into public.game_limit_settings (key, value_int)
values
  ('fallback_max_time_ms', 1800000),
  ('fallback_max_moves', 500)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 3. Limit check inside submit_game_result (same 20-arg signature)
-- ------------------------------------------------------------

create or replace function public.submit_game_result(
  p_won boolean,
  p_moves integer,
  p_duration_ms integer,
  p_score integer default 0,
  p_undos integer default 0,
  p_seed bigint default null,
  p_game_kind text default null,
  p_daily_date date default null,
  p_game_id uuid default gen_random_uuid(),
  p_hint_used boolean default false,
  p_undo_used boolean default false,
  p_tableau_to_tableau_moves integer default 0,
  p_foundation_moves integer default 0,
  p_foundation_to_tableau_moves integer default 0,
  p_recycle_count integer default 0,
  p_foundation_first_eligible boolean default true,
  p_ace_collector_eligible boolean default true,
  p_aces_to_foundation integer default 0,
  p_ace_ids_to_foundation jsonb default '[]'::jsonb,
  p_event_deal_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile record;
  v_game_id uuid := coalesce(p_game_id, gen_random_uuid());
  v_new_streak integer := 0;
  v_recovery_streak integer := 0;
  v_broken_chain boolean := false;
  v_back_on_track boolean := false;
  v_comeback boolean := false;
  v_coins_awarded integer := 0;
  v_coins_base integer := 0;
  v_coins_time_bonus integer := 0;
  v_coins_moves_bonus integer := 0;
  v_coins_rate_limited boolean := false;
  v_coins_implausible boolean := false;
  v_rule record;
  v_fallback_base integer := 5;
  v_max_wins_per_day integer := 50;
  v_min_duration_ms integer := 5000;
  v_min_moves integer := 1;
  v_wins_today integer := 0;
  v_limit record;
  v_limit_max_time_ms integer := 1800000;
  v_limit_max_moves integer := 500;
  v_limit_rejected boolean := false;
  v_context jsonb;
  v_newly text[] := '{}';
  -- event progress locals
  v_event_page_id bigint;
  v_event_grid_size integer;
  v_event_page_coin_reward integer;
  v_event_id text;
  v_deal_inserted boolean := false;
  v_page_solved_count integer;
  v_page_inserted boolean := false;
  v_event_total_pages integer;
  v_event_completed_pages integer;
  v_event_inserted boolean := false;
  v_event_result jsonb := '{}'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Serialize result transitions per profile and make retries harmless.
  select * into v_profile
    from public.profiles
    where id = v_user_id
    for update;

  if exists (
    select 1 from public.game_results
    where user_id = v_user_id and game_id = v_game_id
  ) then
    -- Duplicate delivery (offline retry / double submit): success WITHOUT
    -- re-crediting. No coins_* breakdown here by design — the client already
    -- applied its optimistic display on first win and must not adjust twice.
    return jsonb_build_object('newly_unlocked_achievement_ids', '{}'::text[], 'event_progress', '{}'::jsonb);
  end if;

  if p_won and (p_duration_ms is null or p_duration_ms < 0) then
    raise exception 'Winning duration must be a non-negative integer';
  end if;

  if p_won and (p_moves is null or p_moves < 0) then
    raise exception 'Winning moves must be a non-negative integer';
  end if;

  -- Game-over limit check (migration_033): a claimed win whose facts exceed
  -- the live per-kind limits is REJECTED. Judged against the CURRENT table
  -- values (see fairness note in the header). Losses are never judged.
  select * into v_limit
    from public.game_limit_rules
    where game_kind = p_game_kind;

  select coalesce(
    (select value_int from public.game_limit_settings where key = 'fallback_max_time_ms'),
    v_limit_max_time_ms
  ) into v_limit_max_time_ms;
  select coalesce(
    (select value_int from public.game_limit_settings where key = 'fallback_max_moves'),
    v_limit_max_moves
  ) into v_limit_max_moves;

  if p_game_kind is not null and v_limit.game_kind is not null then
    v_limit_max_time_ms := v_limit.max_time_ms;
    v_limit_max_moves := v_limit.max_moves;
  end if;

  if p_won and (p_moves > v_limit_max_moves or p_duration_ms > v_limit_max_time_ms) then
    v_limit_rejected := true;
    insert into public.game_limit_flags (user_id, game_id, reason, detail)
    values (v_user_id, v_game_id, 'limit_exceeded',
      jsonb_build_object('game_kind', p_game_kind, 'moves', p_moves,
        'duration_ms', p_duration_ms, 'limit_max_moves', v_limit_max_moves,
        'limit_max_time_ms', v_limit_max_time_ms));
  end if;

  insert into public.game_results (
    user_id, game_id, won, moves, duration_ms, score, undos, seed, game_kind,
    hint_used, undo_used, tableau_to_tableau_moves, foundation_moves,
    foundation_to_tableau_moves, recycle_count, foundation_first_eligible,
    ace_collector_eligible, aces_to_foundation, ace_ids_to_foundation
  ) values (
    -- A rejected win is recorded as a loss: history, leaderboards, and the
    -- win/loss aggregates stay truthful without any client-side surgery.
    v_user_id, v_game_id, (p_won and not v_limit_rejected), p_moves, p_duration_ms, p_score, p_undos,
    p_seed, p_game_kind, p_hint_used, (p_undo_used or p_undos > 0),
    p_tableau_to_tableau_moves, p_foundation_moves, p_foundation_to_tableau_moves,
    p_recycle_count, p_foundation_first_eligible, p_ace_collector_eligible,
    p_aces_to_foundation, p_ace_ids_to_foundation
  );

  if p_won and not v_limit_rejected then
    v_new_streak := v_profile.current_streak + 1;
    v_broken_chain := v_profile.last_result_won = false;
    v_recovery_streak := case
      when v_broken_chain then 1
      when v_profile.loss_recovery_streak > 0 then v_profile.loss_recovery_streak + 1
      else 0
    end;
    v_back_on_track := v_recovery_streak >= 3;
    v_comeback := v_profile.games_won >= 1
      and v_profile.best_streak >= 1
      and v_profile.last_result_won = false
      and v_recovery_streak > 0
      and v_profile.loss_recovery_baseline_best_streak >= 1
      and v_new_streak > v_profile.loss_recovery_baseline_best_streak;
    -- Configurable reward: facts in (kind/moves/duration), coins out.
    -- No amount is ever accepted from the client. See migration_032.sql.
    select * into v_rule
      from public.coin_reward_rules
      where game_kind = p_game_kind;

    select coalesce(
      (select value_int from public.coin_reward_settings where key = 'fallback_base_reward'),
      v_fallback_base
    ) into v_fallback_base;

    v_coins_base := coalesce(v_rule.base_reward, v_fallback_base);

    if v_rule.fast_ms_threshold is not null
      and p_duration_ms < v_rule.fast_ms_threshold then
      v_coins_time_bonus := coalesce(v_rule.fast_bonus, 0);
    end if;

    if v_rule.few_moves_threshold is not null
      and p_moves < v_rule.few_moves_threshold then
      v_coins_moves_bonus := coalesce(v_rule.few_moves_bonus, 0);
    end if;

    -- Plausibility floors: impossible submissions still record the win but
    -- pay 0 and are flagged for review. Deliberately NOT an exception: a
    -- raise would fail the sync op forever and wedge the client's outbox.
    select coalesce(
      (select value_int from public.coin_reward_settings where key = 'min_win_duration_ms'),
      v_min_duration_ms
    ) into v_min_duration_ms;
    select coalesce(
      (select value_int from public.coin_reward_settings where key = 'min_win_moves'),
      v_min_moves
    ) into v_min_moves;

    if p_duration_ms < v_min_duration_ms or p_moves < v_min_moves then
      v_coins_implausible := true;
      insert into public.coin_reward_flags (user_id, game_id, reason, detail)
      values (v_user_id, v_game_id, 'implausible',
        jsonb_build_object('game_kind', p_game_kind, 'moves', p_moves,
          'duration_ms', p_duration_ms));
    end if;

    -- Daily rate cap: beyond N rewarded wins/day the win still records
    -- (streaks/stats/achievements unaffected) but pays 0. The count includes
    -- this row (inserted above), so with cap 50 the first 50 wins of the day
    -- are paid and the 51st+ pay 0.
    select coalesce(
      (select value_int from public.coin_reward_settings where key = 'max_rewarded_wins_per_day'),
      v_max_wins_per_day
    ) into v_max_wins_per_day;

    select count(*) into v_wins_today
      from public.game_results
      where user_id = v_user_id
        and won = true
        and created_at >= date_trunc('day', now());

    if v_wins_today > v_max_wins_per_day then
      v_coins_rate_limited := true;
      insert into public.coin_reward_flags (user_id, game_id, reason, detail)
      values (v_user_id, v_game_id, 'rate_capped',
        jsonb_build_object('wins_today_incl_this', v_wins_today,
          'cap', v_max_wins_per_day));
    end if;

    if v_coins_implausible or v_coins_rate_limited then
      v_coins_awarded := 0;
      v_coins_base := 0;
      v_coins_time_bonus := 0;
      v_coins_moves_bonus := 0;
    else
      v_coins_awarded := v_coins_base + v_coins_time_bonus + v_coins_moves_bonus;
    end if;

    update public.profiles as p
    set games_won = p.games_won + 1,
        current_streak = v_new_streak,
        best_streak = greatest(p.best_streak, v_new_streak),
        coins = p.coins + v_coins_awarded,
        coins_earned_total = p.coins_earned_total + v_coins_awarded,
        highest_score = greatest(p.highest_score, p_score),
        lowest_time_ms = least(coalesce(p.lowest_time_ms, p_duration_ms), p_duration_ms),
        lowest_moves = least(coalesce(p.lowest_moves, p_moves), p_moves),
        lowest_undos = least(coalesce(p.lowest_undos, p_undos), p_undos),
        total_time_ms_won = p.total_time_ms_won + p_duration_ms,
        total_moves_won = p.total_moves_won + p_moves,
        last_result_won = true,
        loss_recovery_streak = v_recovery_streak,
        updated_at = now()
    where p.id = v_user_id;

    v_context := jsonb_build_object(
      'won', true,
      'moves', p_moves,
      'duration_ms', p_duration_ms,
      'score', p_score,
      'undos', p_undos,
      'hint_used', p_hint_used,
      'undo_used', (p_undo_used or p_undos > 0),
      'tableau_to_tableau_moves', p_tableau_to_tableau_moves,
      'foundation_moves', p_foundation_moves,
      'foundation_to_tableau_moves', p_foundation_to_tableau_moves,
      'recycle_count', p_recycle_count,
      'foundation_first_eligible', p_foundation_first_eligible,
      'ace_collector_eligible', p_ace_collector_eligible,
      'aces_to_foundation', p_aces_to_foundation,
      'broken_chain', v_broken_chain,
      'back_on_track', v_back_on_track,
      'comeback', v_comeback,
      'game_kind', p_game_kind,
      'daily_date', p_daily_date::text,
      'current_streak', v_new_streak,
      'best_streak', greatest(v_profile.best_streak, v_new_streak),
      'total_games_won', v_profile.games_won + 1,
      'total_games_played', v_profile.games_played,
      'highest_score', greatest(v_profile.highest_score, p_score),
      'lowest_moves', least(coalesce(v_profile.lowest_moves, p_moves), p_moves),
      'lowest_time_ms', least(coalesce(v_profile.lowest_time_ms, p_duration_ms), p_duration_ms),
      'lowest_undos', least(coalesce(v_profile.lowest_undos, p_undos), p_undos),
      'total_coins_earned', v_profile.coins_earned_total + v_coins_awarded,
      'total_coins_spent', v_profile.coins_spent_total
    );

    v_newly := public.check_achievements(v_user_id, v_context);

    if p_game_kind = 'winning' and p_seed is not null then
      insert into public.played_seeds (user_id, seed)
      values (v_user_id, p_seed)
      on conflict do nothing;
    end if;

    if p_game_kind = 'daily' and p_daily_date is not null then
      insert into public.daily_results (user_id, date, seed, best_score, best_time_ms, best_moves, wins)
      values (v_user_id, p_daily_date, p_seed, p_score, p_duration_ms, p_moves, 1)
      on conflict (user_id, date) do update
      set seed = coalesce(public.daily_results.seed, excluded.seed),
          best_score = greatest(public.daily_results.best_score, excluded.best_score),
          best_time_ms = least(public.daily_results.best_time_ms, excluded.best_time_ms),
          best_moves = least(public.daily_results.best_moves, excluded.best_moves),
          wins = public.daily_results.wins + 1;
    end if;

    -- Special Events: mark the deal solved, then cascade page/event completion.
    if p_event_deal_id is not null then
      select sep.id, sep.grid_size, sep.coin_reward, sep.event_id
        into v_event_page_id, v_event_grid_size, v_event_page_coin_reward, v_event_id
      from public.special_event_deals sed
      join public.special_event_pages sep on sep.id = sed.page_id
      where sed.id = p_event_deal_id;

      if v_event_page_id is not null then
        insert into public.event_deal_progress (user_id, deal_id, score, time_ms, moves)
        values (v_user_id, p_event_deal_id, p_score, p_duration_ms, p_moves)
        on conflict (user_id, deal_id) do nothing;
        v_deal_inserted := found;

        if v_deal_inserted then
          select count(*) into v_page_solved_count
          from public.event_deal_progress edp
          join public.special_event_deals sed2 on sed2.id = edp.deal_id
          where edp.user_id = v_user_id and sed2.page_id = v_event_page_id;

          if v_page_solved_count >= (v_event_grid_size * v_event_grid_size) then
            insert into public.event_page_progress (user_id, page_id, coins_awarded)
            values (v_user_id, v_event_page_id, v_event_page_coin_reward)
            on conflict (user_id, page_id) do nothing;
            v_page_inserted := found;

            if v_page_inserted and v_event_page_coin_reward > 0 then
              update public.profiles
              set coins = coins + v_event_page_coin_reward,
                  coins_earned_total = coins_earned_total + v_event_page_coin_reward,
                  updated_at = now()
              where id = v_user_id;
            end if;

            if v_page_inserted then
              select count(*) into v_event_total_pages
              from public.special_event_pages
              where event_id = v_event_id;

              select count(*) into v_event_completed_pages
              from public.event_page_progress epp
              join public.special_event_pages sep2 on sep2.id = epp.page_id
              where epp.user_id = v_user_id and sep2.event_id = v_event_id;

              if v_event_completed_pages >= v_event_total_pages then
                insert into public.event_progress (user_id, event_id)
                values (v_user_id, v_event_id)
                on conflict (user_id, event_id) do nothing;
                v_event_inserted := found;
              end if;
            end if;
          end if;
        end if;
      end if;

      v_event_result := jsonb_build_object(
        'deal_solved', coalesce(v_deal_inserted, false),
        'event_id', v_event_id,
        'page_id', v_event_page_id,
        'page_completed', coalesce(v_page_inserted, false),
        'page_coins_awarded', case when v_page_inserted then v_event_page_coin_reward else 0 end,
        'event_completed', coalesce(v_event_inserted, false)
      );
    end if;
  else
    update public.profiles
    set current_streak = 0,
        last_result_won = false,
        loss_recovery_streak = 0,
        loss_recovery_baseline_best_streak = best_streak,
        updated_at = now()
    where id = v_user_id;
  end if;

  return jsonb_build_object(
    'newly_unlocked_achievement_ids', v_newly,
    'event_progress', v_event_result,
    'coins_awarded', v_coins_awarded,
    'coins_base', v_coins_base,
    'coins_time_bonus', v_coins_time_bonus,
    'coins_moves_bonus', v_coins_moves_bonus,
    'coins_rate_limited', v_coins_rate_limited,
    'coins_implausible', v_coins_implausible,
    'limit_rejected', v_limit_rejected,
    'limit_max_time_ms', v_limit_max_time_ms,
    'limit_max_moves', v_limit_max_moves
  );
end;
$$;

grant execute on function public.submit_game_result(
  boolean, integer, integer, integer, integer, bigint, text, date, uuid,
  boolean, boolean, integer, integer, integer, integer, boolean, boolean,
  integer, jsonb, bigint
) to authenticated;

-- ============================================================
-- Testing note (run as the table owner / service role):
--   -- breakdown for a normal win:
--   select public.submit_game_result(true, 120, 240000, 0, 0, 1, 'winning');
--   -- expect coins_awarded = 10+3+0 = 13 (fast bonus, moves >= 100).
--   -- unknown kind falls back to base 5, no bonuses:
--   select public.submit_game_result(true, 50, 60000, 0, 0, 2, 'nope');
--   -- duplicate game_id pays once:
--   select public.submit_game_result(true, 50, 60000, 0, 0, 2, 'nope',
--     null, '00000000-0000-0000-0000-000000000001');
--   select public.submit_game_result(true, 50, 60000, 0, 0, 2, 'nope',
--     null, '00000000-0000-0000-0000-000000000001');
--   -- second call returns no coins_* keys (no double adjustment client-side).
--   -- over-limit win is rejected and recorded as a loss:
--   select public.submit_game_result(true, 600, 240000, 0, 0, 3, 'winning');
--   -- expect limit_rejected = true, coins_awarded = 0, no newly unlocked ids.
-- ============================================================
