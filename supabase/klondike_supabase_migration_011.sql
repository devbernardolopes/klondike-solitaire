-- 11. reset_achievements — lets a user clear their own unlocked
--     achievements. Writes to achievements_unlocked go only through
--     privileged (SECURITY DEFINER) functions — there is no client
--     INSERT/DELETE RLS policy — so this mirrors submit_game_result and
--     keeps all mutations server-side. Anonymous sessions use the
--     `authenticated` role, so `grant ... to authenticated` covers them.
-- ------------------------------------------------------------
create or replace function public.reset_achievements()
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

  delete from public.achievements_unlocked
  where user_id = v_user_id;
end;
$$;

grant execute on function public.reset_achievements() to authenticated;
