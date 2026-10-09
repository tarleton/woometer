-- Woometer database setup for Supabase.
--
-- Paste this whole file into the Supabase SQL editor and click Run.
-- It is safe to run again later: every statement replaces what it creates.
--
-- Every visitor gets a Supabase user (anonymous until they sign in with
-- Google, which keeps the same user). Answers are keyed by each claim's
-- permanent id from claims.js, so new claims need no database change.
--
-- Row-level security means a user can only read and write their own rows.
-- Everything shared between users (other people's names, friends' answers,
-- totals across all users) goes through the functions at the bottom.

-- Tables

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 40),
  -- The code in a friend link. Random so links don't reveal user ids.
  share_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  created_at timestamptz not null default now()
);

create table if not exists public.answers (
  user_id uuid not null references auth.users (id) on delete cascade,
  claim_id text not null check (char_length(claim_id) between 1 and 100),
  answer text not null check (answer in ('yes', 'no')),
  updated_at timestamptz not null default now(),
  primary key (user_id, claim_id)
);

create index if not exists answers_claim_id_idx on public.answers (claim_id);

-- One row per direction: (me, them) puts them in my friend list.
create table if not exists public.friends (
  user_id uuid not null references auth.users (id) on delete cascade,
  friend_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

-- Row-level security

alter table public.profiles enable row level security;
alter table public.answers enable row level security;
alter table public.friends enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists "read own answers" on public.answers;
create policy "read own answers" on public.answers
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "add own answers" on public.answers;
create policy "add own answers" on public.answers
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "change own answers" on public.answers;
create policy "change own answers" on public.answers
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "remove own answers" on public.answers;
create policy "remove own answers" on public.answers
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "read own friends" on public.friends;
create policy "read own friends" on public.friends
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "remove own friends" on public.friends;
create policy "remove own friends" on public.friends
  for delete to authenticated using (user_id = auth.uid());

-- Table access for signed-in users (anonymous visitors count as signed in).
-- Granted explicitly so this works whether or not Supabase auto-exposes new
-- tables; the policies above still limit every user to their own rows.
-- Profiles are created and renamed only through the functions below.
grant usage on schema public to anon, authenticated;
revoke all on public.profiles, public.answers, public.friends from anon;
revoke insert, update, delete on public.profiles from authenticated;
revoke insert, update on public.friends from authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.answers to authenticated;
grant select, delete on public.friends to authenticated;

-- Functions

-- Returns the caller's profile, creating it on first visit.
create or replace function public.ensure_profile()
returns table (display_name text, share_code text)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into profiles (id) values (auth.uid()) on conflict (id) do nothing;
  return query select p.display_name, p.share_code from profiles p where p.id = auth.uid();
end $$;

create or replace function public.set_display_name(new_name text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into profiles (id, display_name)
  values (auth.uid(), nullif(left(btrim(new_name), 40), ''))
  on conflict (id) do update set display_name = excluded.display_name;
end $$;

-- The name behind a friend link, for the "X wants to compare" banner.
create or replace function public.name_for_code(code text)
returns text
language sql stable security definer set search_path = public as $$
  select display_name from profiles where share_code = code;
$$;

-- Tapping "Add as a friend" on someone's link adds each of you to the other's list.
-- Returns the friend's user id, or null for an unknown code or your own link.
create or replace function public.add_friend(code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  other uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into other from profiles where share_code = code;
  if other is null or other = auth.uid() then return null; end if;
  insert into profiles (id) values (auth.uid()) on conflict (id) do nothing;
  insert into friends (user_id, friend_id) values (auth.uid(), other), (other, auth.uid())
  on conflict do nothing;
  return other;
end $$;

create or replace function public.my_friends()
returns table (friend_id uuid, display_name text, added_at timestamptz, answered bigint)
language sql stable security definer set search_path = public as $$
  select f.friend_id, p.display_name, f.created_at,
         (select count(*) from answers a where a.user_id = f.friend_id)
  from friends f
  left join profiles p on p.id = f.friend_id
  where f.user_id = auth.uid()
  order by f.created_at desc;
$$;

-- A friend's answers, only if they are in the caller's friend list.
create or replace function public.friend_answers(friend uuid)
returns table (claim_id text, answer text)
language sql stable security definer set search_path = public as $$
  select a.claim_id, a.answer
  from answers a
  where a.user_id = friend
    and exists (select 1 from friends f where f.user_id = auth.uid() and f.friend_id = friend);
$$;

-- The answers behind a shared link (woometer.com/?f=CODE), so whoever opens
-- it can see that person's results without adding them as a friend.
create or replace function public.answers_for_code(code text)
returns table (claim_id text, answer text)
language sql stable security definer set search_path = public as $$
  select a.claim_id, a.answer
  from answers a
  join profiles p on p.id = a.user_id
  where p.share_code = code;
$$;

-- Yes and No totals per claim across everyone, for "N% of people agree".
-- Pass a list of claim ids to get just those, or nothing for every claim.
create or replace function public.claim_stats(only_ids text[] default null)
returns table (claim_id text, yes bigint, no bigint)
language sql stable security definer set search_path = public as $$
  select a.claim_id,
         count(*) filter (where a.answer = 'yes'),
         count(*) filter (where a.answer = 'no')
  from answers a
  where only_ids is null or a.claim_id = any (only_ids)
  group by a.claim_id;
$$;

revoke execute on function public.ensure_profile(), public.set_display_name(text), public.name_for_code(text),
  public.add_friend(text), public.my_friends(), public.friend_answers(uuid), public.answers_for_code(text), public.claim_stats(text[]) from public, anon;
grant execute on function public.ensure_profile(), public.set_display_name(text), public.name_for_code(text),
  public.add_friend(text), public.my_friends(), public.friend_answers(uuid), public.answers_for_code(text), public.claim_stats(text[]) to authenticated;
