-- ============================================================
-- Klondike Solitaire — Supabase migration 007 (store: card backs)
-- Paste into: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

-- ------------------------------------------------------------
-- 1. coins_spent_total — lifetime spend, needed for purchase_item below.
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists coins_spent_total integer not null default 0;

alter table public.profiles
  add constraint coins_spent_total_nonneg check (coins_spent_total >= 0);

-- ------------------------------------------------------------
-- 2. store_items — catalog data, managed by Bernardo directly in the
--    dashboard. Public read, no client write policy — mirrors the
--    achievements_definitions pattern from migration 004.
-- ------------------------------------------------------------
create table public.store_items (
  id text primary key,
  name text not null,
  description text,
  price integer not null check (price >= 0),
  kind text not null check (kind in ('card_back')),  -- widen later as new kinds ship
  asset_ref text not null,   -- registry key the client resolves to actual art
  image_path text,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.store_items enable row level security;

create policy "store_items_public_read"
  on public.store_items for select
  to anon, authenticated
  using (true);

-- ------------------------------------------------------------
-- 3. owned_items — the only record of what a user owns. RLS gives
--    users select on their own rows and NO insert/update/delete
--    policy at all — the only writer is purchase_item() below,
--    running SECURITY DEFINER. This is the actual anti-tamper
--    mechanism: there is no client-reachable write path.
-- ------------------------------------------------------------
create table public.owned_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id text not null references public.store_items (id),
  purchased_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.owned_items enable row level security;

create policy "owned_items_select_own"
  on public.owned_items for select
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 4. purchase_item — the only way coins/ownership ever change here.
--    Row-locks the profile so two rapid taps can't both pass the
--    balance check before either debit lands.
-- ------------------------------------------------------------
create or replace function public.purchase_item(p_item_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_price integer;
  v_enabled boolean;
  v_coins integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select price, enabled into v_price, v_enabled
    from public.store_items
    where id = p_item_id;

  if v_price is null then
    raise exception 'Unknown item';
  end if;
  if not v_enabled then
    raise exception 'Item not available';
  end if;

  if exists (
    select 1 from public.owned_items
    where user_id = v_user_id and item_id = p_item_id
  ) then
    raise exception 'Item already owned';
  end if;

  select coins into v_coins from public.profiles where id = v_user_id for update;

  if v_coins < v_price then
    raise exception 'Insufficient coins';
  end if;

  update public.profiles
  set coins = coins - v_price,
      coins_spent_total = coins_spent_total + v_price,
      updated_at = now()
  where id = v_user_id;

  insert into public.owned_items (user_id, item_id) values (v_user_id, p_item_id);

  return jsonb_build_object('item_id', p_item_id, 'coins', v_coins - v_price);
end;
$$;

grant execute on function public.purchase_item(text) to authenticated;

-- ------------------------------------------------------------
-- 5. Seed the one item (idempotent).
-- ------------------------------------------------------------
insert into public.store_items (id, name, description, price, kind, asset_ref, enabled, sort_order)
values ('card-back-red', 'Red Card Back', 'A red-themed card back.', 40, 'card_back', 'red', true, 0)
on conflict (id) do nothing;