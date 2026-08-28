
declare
  v_user_id uuid := auth.uid();
  v_new_streak integer;
  v_coins_awarded integer := 0;
  v_context jsonb;
  v_newly text[];
  v_profile record;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.game_results
    (user_id, won, moves, duration_ms, score, undos, seed, game_kind)
  values
    (v_user_id, p_won, p_moves, p_duration_ms, p_score, p_undos, p_seed, p_game_kind);

  if p_won then
    v_coins_awarded := 10; -- flat reward for now; tune later
  end if;

  update public.profiles
  set games_won = games_won + case when p_won then 1 else 0 end,
      current_streak = case when p_won then current_streak + 1 else 0 end,
      best_streak = greatest(best_streak, case when p_won then current_streak + 1 else best_streak end),
      coins = coins + v_coins_awarded,
      highest_score = case when p_won then greatest(highest_score, p_score) else highest_score end,
      lowest_time_ms = case when p_won then
        (case when lowest_time_ms is null then p_duration_ms else least(lowest_time_ms, p_duration_ms) end)
        else lowest_time_ms end,
      lowest_moves = case when p_won then
        (case when lowest_moves is null then p_moves else least(lowest_moves, p_moves) end)
        else lowest_moves end,
      lowest_undos = case when p_won then
        (case when lowest_undos is null then p_undos else least(lowest_undos, p_undos) end)
        else lowest_undos end,
      updated_at = now()
  where id = v_user_id
  returning current_streak into v_new_streak;

  -- Build the evaluation context from the post-update aggregates.
  select games_won, games_played, best_streak, highest_score,
         lowest_moves, lowest_time_ms, lowest_undos
    into v_profile
    from public.profiles where id = v_user_id;

  v_context := jsonb_build_object(
    'won', p_won,
    'moves', p_moves,
    'duration_ms', p_duration_ms,
    'score', p_score,
    'undos', p_undos,
    'game_kind', p_game_kind,
    'daily_date', p_daily_date::text,
    'current_streak', v_new_streak,
    'best_streak', v_profile.best_streak,
    'total_games_won', v_profile.games_won,
    'total_games_played', v_profile.games_played,
    'highest_score', v_profile.highest_score,
    'lowest_moves', v_profile.lowest_moves,
    'lowest_time_ms', v_profile.lowest_time_ms,
    'lowest_undos', v_profile.lowest_undos
  );

  v_newly := check_achievements(v_user_id, v_context);

  -- Winning-Deal pool seed tracking.
  if p_won and p_game_kind = 'winning' and p_seed is not null then
    insert into public.played_seeds (user_id, seed)
    values (v_user_id, p_seed)
    on conflict do nothing;
  end if;

  -- Daily Challenge per-day best folding.
  if p_won and p_game_kind = 'daily' and p_daily_date is not null then
    insert into public.daily_results (user_id, date, seed, best_score, best_time_ms, best_moves, wins)
    values (v_user_id, p_daily_date, p_seed, p_score, p_duration_ms, p_moves, 1)
    on conflict (user_id, date) do update
    set seed = coalesce(public.daily_results.seed, excluded.seed),
        best_score = greatest(public.daily_results.best_score, excluded.best_score),
        best_time_ms = least(public.daily_results.best_time_ms, excluded.best_time_ms),
        best_moves = least(public.daily_results.best_moves, excluded.best_moves),
        wins = public.daily_results.wins + 1;
  end if;

  return jsonb_build_object('newly_unlocked_achievement_ids', v_newly);
end;
