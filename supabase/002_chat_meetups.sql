-- GradeSwap update 002: in-app chat, meetups and approximate book locations.
-- Run once in Supabase: SQL Editor → New query → paste → Run (after schema.sql).

-- 1. Listings: seller's first name, and an approximate location (rounded to about 1 km)
alter table public.listings add column if not exists seller_name text check (char_length(seller_name) <= 40);
alter table public.listings add column if not exists lat double precision check (lat between -5 and 5.5);
alter table public.listings add column if not exists lng double precision check (lng between 33 and 42.5);

-- 2. One conversation per buyer per book
create table if not exists public.conversations (
  id               uuid primary key default gen_random_uuid(),
  listing_id       uuid not null references public.listings(id) on delete cascade,
  buyer_id         uuid not null references auth.users(id) on delete cascade default auth.uid(),
  seller_id        uuid not null references auth.users(id) on delete cascade,
  buyer_name       text check (char_length(buyer_name) <= 40),
  seller_name      text check (char_length(seller_name) <= 40),
  last_message     text,
  last_sender      uuid,
  last_message_at  timestamptz not null default now(),
  buyer_last_read  timestamptz not null default now(),
  seller_last_read timestamptz not null default to_timestamp(0),
  created_at       timestamptz not null default now(),
  unique (listing_id, buyer_id),
  check (buyer_id <> seller_id)
);
create index if not exists conversations_buyer_idx on public.conversations (buyer_id, last_message_at desc);
create index if not exists conversations_seller_idx on public.conversations (seller_id, last_message_at desc);
alter table public.conversations enable row level security;

drop policy if exists "Participants see their conversations" on public.conversations;
create policy "Participants see their conversations" on public.conversations
  for select to authenticated using (auth.uid() in (buyer_id, seller_id));

drop policy if exists "Buyers start a conversation about a listing" on public.conversations;
create policy "Buyers start a conversation about a listing" on public.conversations
  for insert to authenticated
  with check (
    buyer_id = auth.uid()
    and seller_id = (select l.seller_id from public.listings l where l.id = listing_id)
  );

drop policy if exists "Participants mark conversations read" on public.conversations;
create policy "Participants mark conversations read" on public.conversations
  for update to authenticated using (auth.uid() in (buyer_id, seller_id)) with check (auth.uid() in (buyer_id, seller_id));

-- 3. Messages: text, meetup proposals and one-off "I'm here" locations
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references auth.users(id) on delete cascade default auth.uid(),
  kind            text not null default 'text' check (kind in ('text', 'meetup', 'location')),
  body            text not null check (char_length(body) between 1 and 1000),
  place           text check (char_length(place) <= 120),
  meet_at         timestamptz,
  lat             double precision check (lat between -90 and 90),
  lng             double precision check (lng between -180 and 180),
  created_at      timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);
alter table public.messages enable row level security;

drop policy if exists "Participants read messages" on public.messages;
create policy "Participants read messages" on public.messages
  for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id)));

drop policy if exists "Participants send messages" on public.messages;
create policy "Participants send messages" on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (select 1 from public.conversations c where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id))
  );

-- Keep each conversation's preview and order up to date
create or replace function public.touch_conversation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
     set last_message = case new.kind when 'meetup' then 'Meetup: ' || coalesce(new.place, '')
                                      when 'location' then 'Shared a location'
                                      else left(new.body, 120) end,
         last_sender = new.sender_id,
         last_message_at = new.created_at,
         buyer_last_read  = case when new.sender_id = buyer_id  then new.created_at else buyer_last_read end,
         seller_last_read = case when new.sender_id = seller_id then new.created_at else seller_last_read end
   where id = new.conversation_id;
  return new;
end $$;
drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation after insert on public.messages
  for each row execute function public.touch_conversation();

-- 4. Access for the website (row-level security above still applies)
grant select, insert on public.conversations to authenticated;
grant update (buyer_last_read, seller_last_read) on public.conversations to authenticated;
grant select, insert on public.messages to authenticated;

-- 5. Live updates for chat
do $$ begin
  begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.conversations; exception when duplicate_object then null; end;
end $$;
