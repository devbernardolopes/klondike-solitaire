-- ============================================================
-- Klondike Solitaire — Supabase migration 030 (cascade deletes)
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================
-- Enables proper cascading deletion for:
-- 1. Deleting from profiles → cascade to all user-owned records
-- 2. Deleting from special_events → cascade to game_results (event deals)
-- 3. Creates helper functions for seed-based lookups
-- ============================================================

-- ------------------------------------------------------------
-- 1. Profiles cascade FKs — enable direct deletion from profiles
--    (currently user_id columns FKs point to auth.users; this adds
--    FKs to profiles.id so deleting a profile row cascades)
-- ------------------------------------------------------------
-- These FK constraints allow deletion to propagate from profiles
-- to all user-owned data when the profile is deleted directly
-- (in addition to auth.users deletion cascade).

alter table public.game_results
  add constraint game_results_user_id_fkey_profiles
    foreign key (user_id) references public.profiles (id) on delete cascade
  not valid;

alter table public.game_sessions
  add constraint game_sessions_user_id_fkey_profiles
    foreign key (user_id) references public.profiles (id) on delete cascade
  not valid;

alter table public.game_starts
  add constraint game_starts_user_id_fkey_profiles
    foreign key (user_id) references public.profiles (id) on delete cascade
  not valid;

alter table public.achievements_unlocked
  add constraint achievements_unlocked_user_id_fkey_profiles
    foreign key (user_id) references public.profiles (id) on delete cascade
  not valid;

alter table public.played_seeds
  add constraint played_seeds_user_id_fkey_profiles
    foreign key (user_id) references public.profiles (id) on delete cascade
  not valid;

alter table public.daily_results
  add constraint daily_results_user_id_fkey_profiles
    foreign key (user_id) references public.profiles (id) on delete cascade
  not valid;

alter table public.owned_items
  add constraint owned_items_user_id_fkey_profiles
    foreign key (user_id) references public.profiles (id) on delete cascade
  not valid;

alter table public.event_deal_progress
  add constraint event_deal_progress_user_id_fkey_profiles
    foreign key (user_id) references public.profiles (id) on delete cascade
  not valid;

alter table public.event_page_progress
  add constraint event_page_progress_user_id_fkey_profiles
    foreign key (user_id) references public.profiles (id) on delete cascade
  not valid;

alter table public.event_progress
  add constraint event_progress_user_id_fkey_profiles
    foreign key (user_id) references public.profiles (id) on delete cascade
  not valid;

-- Validate all the new constraints
alter table public.game_results validate constraint game_results_user_id_fkey_profiles;
alter table public.game_sessions validate constraint game_sessions_user_id_fkey_profiles;
alter table public.game_starts validate constraint game_starts_user_id_fkey_profiles;
alter table public.achievements_unlocked validate constraint achievements_unlocked_user_id_fkey_profiles;
alter table public.played_seeds validate constraint played_seeds_user_id_fkey_profiles;
alter table public.daily_results validate constraint daily_results_user_id_fkey_profiles;
alter table public.owned_items validate constraint owned_items_user_id_fkey_profiles;
alter table public.event_deal_progress validate constraint event_deal_progress_user_id_fkey_profiles;
alter table public.event_page_progress validate constraint event_page_progress_user_id_fkey_profiles;
alter table public.event_progress validate constraint event_progress_user_id_fkey_profiles;

-- ------------------------------------------------------------
-- 2. Special events -> game_results cascade
--    Add event_id to game_results with FK cascade
-- ------------------------------------------------------------
alter table public.game_results
  add column if not exists event_id text null references public.special_events (id) on delete cascade;

create index if not exists game_results_event_id_idx
  on public.game_results (event_id);

-- ------------------------------------------------------------
-- 3. Helper function: get event_id from seed
--    (for use in insert triggers)
-- ------------------------------------------------------------
create or replace function public.seed_to_event_id(p_seed bigint)
returns text
language sql
stable
as $$
  select se.id
  from public.special_events se
  join public.special_event_pages sep on sep.event_id = se.id
  join public.special_event_deals sed on sed.page_id = sep.id
  where sed.seed = p_seed
  limit 1;
$$;

-- ------------------------------------------------------------
-- 4. Helper view: seeds_by_event (event_id -> array of seeds)
-- ------------------------------------------------------------
create or replace view public.seeds_by_event as
select
  se.id as event_id,
  array_agg(sed.seed order by sep.page_number, sed."position") as seeds
from public.special_events se
join public.special_event_pages sep on sep.event_id = se.id
join public.special_event_deals sed on sed.page_id = sep.id
group by se.id;

-- ------------------------------------------------------------
-- 5. Trigger: auto-populate event_id on game_results insert
--    (when game_kind = 'winning' and seed matches an event deal)
-- ------------------------------------------------------------
create or replace function public.set_game_results_event_id()
returns trigger
language plpgsql
as $$
begin
  if new.event_id is null
     and new.seed is not null
     and new.game_kind = 'winning' then
    select se.id
    into new.event_id
    from public.special_events se
    join public.special_event_pages sep on sep.event_id = se.id
    join public.special_event_deals sed on sed.page_id = sep.id
    where sed.seed = new.seed
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists set_event_id_trigger on public.game_results;
create trigger set_event_id_trigger
  before insert on public.game_results
  for each row
  execute function public.set_game_results_event_id();

-- ------------------------------------------------------------
-- 6. Update existing game_results with the event_id from their seed
--    (idempotent — only updates rows where event_id is null)
-- ------------------------------------------------------------
update public.game_results gr
set event_id = se.id
from public.special_events se
join public.special_event_pages sep on sep.event_id = se.id
join public.special_event_deals sed on sed.page_id = sep.id
where gr.seed = sed.seed
  and gr.event_id is null
  and gr.game_kind = 'winning';

-- ============================================================
-- Testing note: verify with:
--   select * from seeds_by_event limit 1;
--   select event_id, count(*) from game_results group by event_id;
-- ============================================================