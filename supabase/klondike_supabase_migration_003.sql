-- ============================================================
-- Klondike Solitaire — Supabase migration 003 (username rename)
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

-- ------------------------------------------------------------
-- 1. profiles — track when the name was last changed (cooldown basis)
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists display_name_updated_at timestamptz;

-- Case-insensitive uniqueness. Extremely unlikely to collide with the
-- existing auto-generated names (90,000 possible combinations), but if
-- this fails on an existing duplicate, rename the colliding row manually
-- first, then re-run.
create unique index if not exists profiles_display_name_lower_idx
  on public.profiles (lower(display_name));

-- ------------------------------------------------------------
-- 2. check_display_name_available — narrow, read-only, leaks nothing
--    beyond true/false (profiles RLS otherwise hides other users' rows
--    entirely, so this can't be a plain client-side select).
-- ------------------------------------------------------------
create or replace function public.check_display_name_available(p_display_name text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles where lower(display_name) = lower(p_display_name)
  );
$$;

grant execute on function public.check_display_name_available(text) to authenticated;

-- ------------------------------------------------------------
-- 3. rename_display_name — replaces the Phase 1 version. Adds format
--    validation, a 14-day cooldown (waived until the first-ever change),
--    and a friendly uniqueness error (the unique index above is the
--    final backstop against a same-instant race between two renames).
-- ------------------------------------------------------------
drop function if exists public.rename_display_name(text);

create or replace function public.rename_display_name(p_display_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_last_change timestamptz;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_display_name !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'Usernames must be 3-20 characters: letters, numbers, and underscores only.';
  end if;

  select display_name_updated_at into v_last_change
  from public.profiles where id = v_user_id;

  if v_last_change is not null and now() - v_last_change < interval '14 days' then
    raise exception 'You can change your username again on %.',
      to_char(v_last_change + interval '14 days', 'YYYY-MM-DD');
  end if;

  if exists (
    select 1 from public.profiles
    where lower(display_name) = lower(p_display_name) and id != v_user_id
  ) then
    raise exception 'That username is already taken.';
  end if;

  begin
    update public.profiles
    set display_name = p_display_name,
        display_name_updated_at = now(),
        updated_at = now()
    where id = v_user_id;
  exception
    when unique_violation then
      raise exception 'That username is already taken.';
  end;
end;
$$;

grant execute on function public.rename_display_name(text) to authenticated;
