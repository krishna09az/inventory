-- Inventory schema (initial). Applied with `supabase db push`; written to be safe to re-run.
--
-- Each row belongs to one user (user_id). Row Level Security makes sure a user can
-- only ever read or write their own rows, no matter what the app sends.
-- Rows are never hard-deleted by the app: `deleted = true` lets other devices learn
-- about deletions when they sync. `updated_at` is always set by the server and is
-- what devices use to fetch "everything changed since my last sync".

create table if not exists public.items (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  sku text not null default '',
  low_stock_at integer not null default 5 check (low_stock_at >= 0),
  notes text not null default '',
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.movements (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  type text not null check (type in ('in', 'out')),
  quantity integer not null check (quantity > 0),
  unit_price numeric(12, 2) check (unit_price >= 0),
  party text not null default '',
  city text not null default '',
  date date not null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists items_user_updated on public.items (user_id, updated_at);
create index if not exists movements_user_updated on public.movements (user_id, updated_at);
create index if not exists movements_item on public.movements (item_id);

-- Server clock decides updated_at (device clocks can be wrong).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists items_set_updated_at on public.items;
create trigger items_set_updated_at
  before insert or update on public.items
  for each row execute function public.set_updated_at();

drop trigger if exists movements_set_updated_at on public.movements;
create trigger movements_set_updated_at
  before insert or update on public.movements
  for each row execute function public.set_updated_at();

-- Row Level Security: owner-only access.
alter table public.items enable row level security;
alter table public.movements enable row level security;

drop policy if exists "Owner can read items" on public.items;
drop policy if exists "Owner can insert items" on public.items;
drop policy if exists "Owner can update items" on public.items;
create policy "Owner can read items" on public.items
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Owner can insert items" on public.items
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Owner can update items" on public.items
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Owner can read movements" on public.movements;
drop policy if exists "Owner can insert movements" on public.movements;
drop policy if exists "Owner can update movements" on public.movements;
create policy "Owner can read movements" on public.movements
  for select to authenticated using ((select auth.uid()) = user_id);
-- A movement may only point at an item the same user owns.
create policy "Owner can insert movements" on public.movements
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.items i where i.id = item_id and i.user_id = (select auth.uid()))
  );
create policy "Owner can update movements" on public.movements
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.items i where i.id = item_id and i.user_id = (select auth.uid()))
  );
