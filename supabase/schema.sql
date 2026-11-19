-- GradeSwap database. Run once in Supabase: SQL Editor → New query → paste → Run.

-- 1. Book listings (public to read; sellers manage their own)
create table if not exists public.listings (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title       text not null check (char_length(title) between 2 and 120),
  publisher   text not null check (char_length(publisher) between 1 and 80),
  grade       text not null,
  school      text not null check (char_length(school) between 2 and 100),
  area        text not null check (char_length(area) between 2 and 60),
  condition   text not null,
  price       integer not null check (price > 0 and price <= 100000),
  description text check (char_length(description) <= 600),
  photos      text[] not null default '{}' check (array_length(photos, 1) is null or array_length(photos, 1) <= 4),
  status      text not null default 'available' check (status in ('available', 'reserved', 'sold')),
  created_at  timestamptz not null default now()
);
create index if not exists listings_search_idx on public.listings (status, grade, created_at desc);

alter table public.listings enable row level security;

drop policy if exists "Anyone can view listings" on public.listings;
create policy "Anyone can view listings" on public.listings
  for select using (true);

drop policy if exists "Sellers add their own listings" on public.listings;
create policy "Sellers add their own listings" on public.listings
  for insert to authenticated with check (seller_id = auth.uid());

drop policy if exists "Sellers update their own listings" on public.listings;
create policy "Sellers update their own listings" on public.listings
  for update to authenticated using (seller_id = auth.uid()) with check (seller_id = auth.uid());

drop policy if exists "Sellers delete their own listings" on public.listings;
create policy "Sellers delete their own listings" on public.listings
  for delete to authenticated using (seller_id = auth.uid());

-- 2. Seller payout phone numbers (private: only the seller, and you in the dashboard)
create table if not exists public.seller_contacts (
  user_id      uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  display_name text,
  phone        text not null check (phone ~ '^(\+?254|0)[17][0-9]{8}$'),
  updated_at   timestamptz not null default now()
);
alter table public.seller_contacts enable row level security;

drop policy if exists "Sellers read their own contact" on public.seller_contacts;
create policy "Sellers read their own contact" on public.seller_contacts
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "Sellers add their own contact" on public.seller_contacts;
create policy "Sellers add their own contact" on public.seller_contacts
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "Sellers update their own contact" on public.seller_contacts;
create policy "Sellers update their own contact" on public.seller_contacts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 3. Buy requests (anyone can send one; only you read them, in the Supabase dashboard)
create table if not exists public.orders (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique,
  listing_id  uuid not null references public.listings(id) on delete cascade,
  buyer_name  text not null check (char_length(buyer_name) between 2 and 80),
  buyer_phone text not null check (buyer_phone ~ '^(\+?254|0)[17][0-9]{8}$'),
  buyer_area  text not null check (char_length(buyer_area) between 2 and 120),
  status      text not null default 'new' check (status in ('new', 'confirmed', 'paid', 'collected', 'seller_paid', 'cancelled', 'refunded')),
  created_at  timestamptz not null default now()
);
alter table public.orders enable row level security;

drop policy if exists "Anyone can send a buy request" on public.orders;
create policy "Anyone can send a buy request" on public.orders
  for insert to anon, authenticated with check (status = 'new');

-- Handy view for you: each order with its book and the seller's payout number.
-- Only visible to you in the dashboard (no public access).
create or replace view public.orders_admin with (security_invoker = true) as
  select o.ref, o.status, o.created_at, o.buyer_name, o.buyer_phone, o.buyer_area,
         l.title, l.grade, l.price, floor(l.price * 0.9)::int as seller_gets,
         c.display_name as seller_name, c.phone as seller_phone, l.id as listing_id
  from public.orders o
  join public.listings l on l.id = o.listing_id
  left join public.seller_contacts c on c.user_id = l.seller_id;
revoke all on public.orders_admin from anon, authenticated;

-- 4. Photo storage: public to view, sellers upload only into their own folder
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "Sellers upload their own photos" on storage.objects;
create policy "Sellers upload their own photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Sellers delete their own photos" on storage.objects;
create policy "Sellers delete their own photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);
