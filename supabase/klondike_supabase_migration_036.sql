-- ============================================================
-- Klondike Solitaire — Supabase migration 036 (daily last-win sync)
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================
-- Makes the Daily Challenge side panel's "Last" time/moves cross-device.
-- Until now daily_results carried bests + wins only, so Last was a
-- Dexie-local field (see src/db/dailyResults.js) that never left the
-- device. This adds last_time_ms / last_moves / last_won_at, set to the
-- just-flushed win by submit_game_result's daily upsert (insert + conflict
-- update both stamp now()). Clients converge with latest-last_won_at-wins
-- (see mergeDailyResults), resolved from the existing pullDailyResults
-- single SELECT — zero extra requests.
--
-- Client impact: pullDailyResults selects the three new columns; old
-- clients simply ignore them (nullable: pre-036 rows stay null = "—").
-- ============================================================

-- ------------------------------------------------------------
-- 1. Last-win columns (nullable: pre-036 rows + never-played stay null)
-- ------------------------------------------------------------
alter table public.daily_results
  add column if not exists last_time_ms integer,
  add column if not exists last_moves integer,
  add column if not exists last_won_at timestamptz;

-- ------------------------------------------------------------
-- 2. submit_game_result — same 21-arg signature, daily upsert stamps Last
-- (canonical mirror: supabase/submit_game_result.sql)
-- ------------------------------------------------------------
-- Canonical submit_game_result definition. The schema changes and reset RPC
-- are applied by klondike_supabase_migration_018.sql. This revision (paired
-- with migration_022.sql) adds p_event_deal_id: when a win comes from a
-- Special Events grid cell, the client passes that deal's id and this
-- function atomically (1) marks the deal solved, (2) if that was the deal
-- that completed its page, awards the page's coin bonus exactly once, and
-- (3) if that was the page that completed the event, flags the event as
-- fully solved exactly once (for the deferred prize feature). All three
-- steps are idempotent via on-conflict-do-nothing, on top of the existing
-- game_id dedup guard at the top of the function.
--
-- Revision paired with migration_032.sql: the per-win coin reward is no
-- longer the `v_coins_awarded := 10` literal. Coins are derived server-side
-- from the admin-settable coin_reward_rules / coin_reward_settings tables
-- (per-kind base + speed/move bonuses, daily rate cap, plausibility floors
-- that pay 0 + flag instead of raising). The RPC accepts FACTS only
-- (kind/moves/duration) — never an amount — and returns a coins_* breakdown
-- the client uses to reconcile its optimistic display. Signature unchanged.
--
-- The event page bonus (coin_reward on special_event_pages) still applies to
-- event deals same as any other win — on top of the computed base+bonuses.
--
-- Revision paired with migration_033.sql: claimed wins are judged against
-- the admin-settable game_limit_rules / game_limit_settings tables. An
-- over-limit win is REJECTED — recorded as a loss with no win credit
-- (no streak/bests/coins/achievements/seed/daily/event progress), flagged
-- in game_limit_flags, and reported via limit_rejected + the authoritative
-- limits so the client rolls back its optimistic win. Signature unchanged.
--
-- Revision paired with migration_035.sql: deal recording. A new trailing
-- p_move_log (TEXT, nullable) carries the compact human-readable move log
-- (one step per line: D / R / U / "Ah W->F1" / "7h,6s,5h T3->T6", see
-- src/core/moveLog.js) stored verbatim on game_results.move_log for the
-- deferred playback feature. Facts-only like the rest: never judged, never
-- affects coins/limits/achievements; recorded on wins AND losses.

drop function if exists public.submit_game_result(
  boolean, integer, integer, integer, integer, bigint, text, date, uuid,
  boolean, boolean, integer, integer, integer, integer, boolean, boolean,
  integer, jsonb
);

drop function if exists public.submit_game_result(
  boolean, integer, integer, integer, integer, bigint, text, date, uuid,
  boolean, boolean, integer, integer, integer, integer, boolean, boolean,
  integer, jsonb, bigint
);

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
  p_event_deal_id bigint default null,
  p_move_log text default null
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
    ace_collector_eligible, aces_to_foundation, ace_ids_to_foundation, move_log
  ) values (
    -- A rejected win is recorded as a loss: history, leaderboards, and the
    -- win/loss aggregates stay truthful without any client-side surgery.
    v_user_id, v_game_id, (p_won and not v_limit_rejected), p_moves, p_duration_ms, p_score, p_undos,
    p_seed, p_game_kind, p_hint_used, (p_undo_used or p_undos > 0),
    p_tableau_to_tableau_moves, p_foundation_moves, p_foundation_to_tableau_moves,
    p_recycle_count, p_foundation_first_eligible, p_ace_collector_eligible,
    p_aces_to_foundation, p_ace_ids_to_foundation, p_move_log
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
      insert into public.daily_results (user_id, date, seed, best_score, best_time_ms, best_moves, wins, last_time_ms, last_moves, last_won_at)
      values (v_user_id, p_daily_date, p_seed, p_score, p_duration_ms, p_moves, 1, p_duration_ms, p_moves, now())
      on conflict (user_id, date) do update
      set seed = coalesce(public.daily_results.seed, excluded.seed),
          best_score = greatest(public.daily_results.best_score, excluded.best_score),
          best_time_ms = least(public.daily_results.best_time_ms, excluded.best_time_ms),
          best_moves = least(public.daily_results.best_moves, excluded.best_moves),
          wins = public.daily_results.wins + 1,
          last_time_ms = excluded.best_time_ms,
          last_moves = excluded.best_moves,
          last_won_at = now();
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
  integer, jsonb, bigint, text
) to authenticated;