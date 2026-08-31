-- ============================================================
-- Klondike Solitaire — Supabase migration 015 (event results)
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================
-- Persists per-event wins so progressive image reveal syncs across
-- devices. Mirrors daily_results pattern but per (user, event, seed).
-- ============================================================

create table if not exists public.event_results (
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id text not null,
  seed bigint not null,
  wins integer not null default 1,
  best_score integer not null default 0,
  best_time_ms integer,
  best_moves integer,
  updated_at timestamptz not null default now(),
  primary key (user_id, event_id, seed),
  foreign key (event_id) references public.special_events (id) on delete cascade
);

alter table public.event_results enable row level security;

drop policy if exists "event_results_select_own" on public.event_results;
create policy "event_results_select_own"
  on public.event_results for select
  using (auth.uid() = user_id);

drop policy if exists "event_results_insert_own" on public.event_results;
create policy "event_results_insert_own"
  on public.event_results for insert
  with check (auth.uid() = user_id);

drop policy if exists "event_results_update_own" on public.event_results;
create policy "event_results_update_own"
  on public.event_results for update
  using (auth.uid() = user_id);

-- Extend submit_game_result to fold event wins (kept separate from
-- daily/winning logic; called via syncEngine operations.record_event_win).
create or replace function public.record_event_win(
  p_event_id text,
  p_seed bigint
)
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
  insert into public.event_results (user_id, event_id, seed, wins)
  values (v_user_id, p_event_id, p_seed, 1)
  on conflict (user_id, event_id, seed) do update
  set wins = public.event_results.wins + 1,
      updated_at = now();
end;
$$;

grant execute on function public.record_event_win(text, bigint) to authenticated;
