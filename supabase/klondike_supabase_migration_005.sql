-- ============================================================
-- Klondike Solitaire — Supabase migration 005 (toast config)
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

-- ------------------------------------------------------------
-- toast_config — single global row (id = 1) controlling the
-- achievement-unlock toast. Edited by Bernardo directly via the
-- dashboard; no client write policy.
-- ------------------------------------------------------------
create table if not exists public.toast_config (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default true,
  position text not null default 'top-center'
    check (position in ('top-center', 'bottom-center'))
);

alter table public.toast_config enable row level security;

create policy "toast_config_public_read"
  on public.toast_config for select
  to anon, authenticated
  using (true);

-- ------------------------------------------------------------
-- Seed the singleton row (idempotent).
-- ------------------------------------------------------------
insert into public.toast_config (id, enabled, position)
values (1, true, 'top-center')
on conflict (id) do nothing;
