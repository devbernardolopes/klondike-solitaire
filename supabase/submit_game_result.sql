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
-- The flat per-win coin reward (v_coins_awarded, currently 10) already
-- applies to event deals same as any other win — no change needed there,
-- this only adds the event-specific bonus layer on top.

drop function if exists public.submit_game_result(
  boolean, integer, integer, integer, integer, bigint, text, date, uuid,
  boolean, boolean, integer, integer, integer, integer, boolean, boolean,
  integer, jsonb
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
    return jsonb_build_object('newly_unlocked_achievement_ids', '{}'::text[], 'event_progress', '{}'::jsonb);
  end if;

  if p_won and (p_duration_ms is null or p_duration_ms < 0) then
    raise exception 'Winning duration must be a non-negative integer';
  end if;

  if p_won and (p_moves is null or p_moves < 0) then
    raise exception 'Winning moves must be a non-negative integer';
  end if;

  insert into public.game_results (
    user_id, game_id, won, moves, duration_ms, score, undos, seed, game_kind,
    hint_used, undo_used, tableau_to_tableau_moves, foundation_moves,
    foundation_to_tableau_moves, recycle_count, foundation_first_eligible,
    ace_collector_eligible, aces_to_foundation, ace_ids_to_foundation
  ) values (
    v_user_id, v_game_id, p_won, p_moves, p_duration_ms, p_score, p_undos,
    p_seed, p_game_kind, p_hint_used, (p_undo_used or p_undos > 0),
    p_tableau_to_tableau_moves, p_foundation_moves, p_foundation_to_tableau_moves,
    p_recycle_count, p_foundation_first_eligible, p_ace_collector_eligible,
    p_aces_to_foundation, p_ace_ids_to_foundation
  );

  if p_won then
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
    v_coins_awarded := 10;

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
    'event_progress', v_event_result
  );
end;
$$;

grant execute on function public.submit_game_result(
  boolean, integer, integer, integer, integer, bigint, text, date, uuid,
  boolean, boolean, integer, integer, integer, integer, boolean, boolean,
  integer, jsonb, bigint
) to authenticated;