-- ============================================================
-- Klondike Solitaire - Supabase migration 019 (statistics persistence repair)
-- ============================================================

-- Migration 018 updates these personal-best columns from submit_game_result,
-- but older canonical schemas do not define them. Keep this migration safe for
-- databases where migration 002 was skipped or only partially applied.
alter table public.profiles
  add column if not exists lowest_time_ms integer,
  add column if not exists lowest_moves integer;

-- Restore personal bests from durable wins when the profile columns are empty.
-- Existing values are preserved, and a historical value can only improve them.
with historical as (
  select
    user_id,
    min(duration_ms) filter (where won and duration_ms is not null) as lowest_time_ms,
    min(moves) filter (where won and moves is not null) as lowest_moves
  from public.game_results
  group by user_id
)
update public.profiles as p
set lowest_time_ms = case
      when historical.lowest_time_ms is null then p.lowest_time_ms
      when p.lowest_time_ms is null then historical.lowest_time_ms
      else least(p.lowest_time_ms, historical.lowest_time_ms)
    end,
    lowest_moves = case
      when historical.lowest_moves is null then p.lowest_moves
      when p.lowest_moves is null then historical.lowest_moves
      else least(p.lowest_moves, historical.lowest_moves)
    end,
    updated_at = now()
from historical
where p.id = historical.user_id
  and (historical.lowest_time_ms is not null or historical.lowest_moves is not null);

-- The function body from migration 018 references these columns. Validate that
-- the extended result RPC is installed after the columns have been repaired.
do $$
begin
  if not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'submit_game_result'
      and pronargs = 19
  ) then
    raise exception 'submit_game_result migration 018 function is not installed';
  end if;
end;
$$;
