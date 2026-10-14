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

-- Test accounts (like the pretend John Doe) are marked as testers so their
-- answers stay out of the "N% of people agree" totals. Only the SQL editor
-- can set it; nobody can mark themselves from the site.
alter table public.profiles add column if not exists is_tester boolean not null default false;

-- Someone's other account, for people who ended up with two. Holds the id of
-- the account they use now: the stats skip this one, and its link leads to
-- that one (see user_for_code), so a link they already sent keeps working.
-- It happens when a browser signs in with Google to an account that already
-- exists (the answers move to that account, and the anonymous profile the
-- browser had been using keeps a copy), or when a phone forgets its sign-in
-- partway through a visit and starts over. finish_move sets it for the first
-- case; the SQL editor for anything else. Setting it also gives its friends
-- to the account in use, and friend lists leave it out, so friends see that
-- person once (see duplicate_friends). Nothing is deleted.
alter table public.profiles add column if not exists duplicate_of uuid;

create table if not exists public.answers (
  user_id uuid not null references auth.users (id) on delete cascade,
  claim_id text not null check (char_length(claim_id) between 1 and 100),
  answer text not null check (answer in ('yes', 'no', 'unsure')),
  updated_at timestamptz not null default now(),
  primary key (user_id, claim_id)
);

create index if not exists answers_claim_id_idx on public.answers (claim_id);

-- 'unsure' is the Not Sure button. Databases set up before it existed only
-- allow 'yes' and 'no', so replace that rule.
alter table public.answers drop constraint if exists answers_answer_check;
alter table public.answers add constraint answers_answer_check check (answer in ('yes', 'no', 'unsure'));

-- One row per direction: (me, them) puts them in my friend list.
create table if not exists public.friends (
  user_id uuid not null references auth.users (id) on delete cascade,
  friend_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

-- A private nickname for a friend (say "Dad"). It sits on your own row of the
-- pair, so only you ever see it.
alter table public.friends add column if not exists nickname text check (char_length(nickname) <= 40);

-- Who tapped Add for the pair, so the Friends badge counts only people who
-- added you, never friends you added yourself (say, on your phone). Rows from
-- before this column are blank and never count as new.
alter table public.friends add column if not exists added_by uuid;

-- When each person last opened Friends, on any device, for the badge. Only
-- the functions below touch it.
create table if not exists public.friends_seen (
  user_id uuid primary key references auth.users (id) on delete cascade,
  seen_at timestamptz not null default now()
);

-- Asking to be friends. Tapping Add on someone's link sends a request, and
-- nobody joins anyone's friend list until the person asked taps Accept, so a
-- link posted somewhere public can't fill a list with strangers. One row per
-- direction. status is what the person asked did: pending, accepted or
-- ignored. An ignored request still looks sent to whoever asked, so they
-- aren't told, and asking again leaves it ignored. cancelled_at is when
-- whoever asked took it back. Only the functions below touch it.
create table if not exists public.friend_requests (
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'ignored')),
  answered_at timestamptz,
  cancelled_at timestamptz,
  primary key (from_user, to_user),
  check (from_user <> to_user)
);
create index if not exists friend_requests_to_user_idx on public.friend_requests (to_user);

-- Where people visit from, for the site owner to look at in the database,
-- and later for a world map on the stats page. One row per account per IP
-- address, refreshed on every visit. The country, region and city are
-- Cloudflare's rough guess from the IP. ip_code is a scrambled code of the
-- IP (see ip_code() below), used as the key and for leaving spam out of the
-- stats. Nobody can read this table from the site: it has row-level security
-- on and no policies, so IPs never show on any page or in shared links.
create table if not exists public.visits (
  user_id uuid not null references auth.users (id) on delete cascade,
  ip_code text not null,
  country text,
  region text,
  city text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  visit_count integer not null default 1,
  primary key (user_id, ip_code)
);

-- Settings only the database can see. Holds the random salt that scrambles
-- IP addresses; it is made here on first run and never leaves the database.
create table if not exists public.private_settings (
  name text primary key,
  value text not null
);
insert into public.private_settings (name, value)
values ('ip_salt', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

-- The first version of visits had only an "ip" column and no ip_code.
-- Turn that column into ip_code; the next statement adds ip back.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'visits' and column_name = 'ip')
     and not exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'visits' and column_name = 'ip_code') then
    update public.visits set ip = substr(encode(sha256(convert_to(
      (select value from public.private_settings where name = 'ip_salt') || ip, 'UTF8')), 'hex'), 1, 16);
    alter table public.visits rename column ip to ip_code;
  end if;
end $$;

-- The IP address itself, alongside its code.
alter table public.visits add column if not exists ip text;

-- Spam, quietly left out of the stats. Add an IP's code here from the SQL
-- editor, e.g. insert into ignored_ip_codes (ip_code) values (ip_code('1.2.3.4')),
-- and everyone who has visited from it stops counting toward the stats and
-- "N% of people agree", the same way testers do. Their own page keeps
-- working as normal.
create table if not exists public.ignored_ip_codes (
  ip_code text primary key,
  note text,
  created_at timestamptz not null default now()
);

-- The numbers behind /stats and the Statistics box, worked out at most once a
-- minute and kept here, so lots of page loads at once (or a script calling
-- site_stats over and over) can't wear out the database. Only site_stats and
-- map_stats touch it.
create table if not exists public.stats_cache (
  name text primary key,
  value json not null,
  made_at timestamptz not null default now()
);

-- A browser about to leave its anonymous account for an account that already
-- exists (see start_move). Only start_move and finish_move touch it.
create table if not exists public.moves (
  secret text primary key,
  from_user uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.moves add column if not exists used_at timestamptz;

-- Row-level security

alter table public.profiles enable row level security;
alter table public.answers enable row level security;
alter table public.friends enable row level security;
alter table public.visits enable row level security;
alter table public.private_settings enable row level security;
alter table public.ignored_ip_codes enable row level security;
alter table public.friends_seen enable row level security;
alter table public.friend_requests enable row level security;
alter table public.stats_cache enable row level security;
alter table public.moves enable row level security;

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

-- Each of a pair can read both rows of their friendship, but only who is in
-- it: the grants below leave out the nickname and the rest, which come from
-- my_friends, so each person sees just their own.
drop policy if exists "read own friends" on public.friends;
create policy "read own friends" on public.friends
  for select to authenticated using (user_id = auth.uid() or friend_id = auth.uid());

-- Removing a friend works both ways: either of the pair can take away both
-- rows, so you can always leave the list of someone you no longer trust.
-- (Postgres only removes rows the remover can also read, hence the policy
-- above.)
drop policy if exists "remove own friends" on public.friends;
create policy "remove own friends" on public.friends
  for delete to authenticated using (user_id = auth.uid() or friend_id = auth.uid());

-- Table access for signed-in users (anonymous visitors count as signed in).
-- Granted explicitly so this works whether or not Supabase auto-exposes new
-- tables; the policies above still limit every user to their own rows.
-- Profiles are created and renamed only through the functions below.
grant usage on schema public to anon, authenticated;
revoke all on public.profiles, public.answers, public.friends from anon;
revoke all on public.visits, public.private_settings, public.ignored_ip_codes, public.friends_seen, public.friend_requests, public.stats_cache, public.moves from anon, authenticated;
revoke insert, update, delete on public.profiles from authenticated;
revoke select, insert, update on public.friends from authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.answers to authenticated;
grant select (user_id, friend_id), delete on public.friends to authenticated;

-- Functions

-- The scrambled code for an IP address: the first 16 hex characters of a
-- salted SHA-256. The same address always gets the same code, but the code
-- can't be turned back into the address.
create or replace function public.ip_code(addr text)
returns text
language sql stable security definer set search_path = public as $$
  select substr(encode(sha256(convert_to(
    (select value from private_settings where name = 'ip_salt') || addr, 'UTF8')), 'hex'), 1, 16);
$$;

-- Notes the caller's IP address, its code and rough location in visits.
-- Supabase's gateway passes the visitor's IP and Cloudflare's location guess
-- in as request headers. Called from ensure_profile on every page load; it
-- never stops the page loading if something is missing.
create or replace function public.record_visit()
returns void
language plpgsql security definer set search_path = public as $$
declare
  h json;
  addr text;
begin
  h := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  addr := nullif(btrim(coalesce(h->>'cf-connecting-ip', split_part(h->>'x-forwarded-for', ',', 1), h->>'x-real-ip', '')), '');
  if auth.uid() is null or addr is null then return; end if;
  insert into visits (user_id, ip_code, ip, country, region, city)
  values (auth.uid(), ip_code(addr), left(addr, 64), nullif(h->>'cf-ipcountry', ''),
          nullif(coalesce(h->>'cf-region', h->>'cf-ipregion'), ''), nullif(h->>'cf-ipcity', ''))
  on conflict (user_id, ip_code) do update set
    ip = excluded.ip,
    country = coalesce(excluded.country, visits.country),
    region = coalesce(excluded.region, visits.region),
    city = coalesce(excluded.city, visits.city),
    last_seen = now(),
    visit_count = visits.visit_count + 1;
exception when others then
  return;
end $$;

-- Runs after answers are saved from the site. It caps each account at 1,000
-- answers (there are a few hundred claims, plus retired ones), so one account
-- can't fill the database with made-up claims. And it notes the visitor's IP
-- if the account has none yet, so answers saved by a script that never loads
-- the page can still be put on the spam list. The SQL editor skips both.
create or replace function public.check_answers()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return null; end if;
  if (select count(*) from answers where user_id = auth.uid()) > 1000 then
    raise exception 'too many answers';
  end if;
  if not exists (select 1 from visits where user_id = auth.uid()) then
    perform record_visit();
  end if;
  return null;
end $$;

create or replace trigger check_answers
  after insert on public.answers
  for each statement execute function public.check_answers();

-- True for accounts kept out of the stats: testers, leftover duplicates, and
-- anyone who has visited from a network listed in ignored_ip_codes.
create or replace function public.left_out_of_stats(uid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = uid and (p.is_tester or p.duplicate_of is not null))
      or exists (select 1 from visits v join ignored_ip_codes i using (ip_code) where v.user_id = uid);
$$;

-- The same accounts as a list, for the stats functions below. Looking the list
-- up once is much faster than asking left_out_of_stats about every answer,
-- which matters for "N% of people agree" after every tap once lots of people
-- have answered.
create or replace function public.left_out_users()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from profiles where is_tester or duplicate_of is not null
  union
  select v.user_id from visits v join ignored_ip_codes i using (ip_code);
$$;

-- Returns the caller's profile, creating it on first visit.
create or replace function public.ensure_profile()
returns table (display_name text, share_code text)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into profiles (id) values (auth.uid()) on conflict (id) do nothing;
  perform record_visit();
  return query select p.display_name, p.share_code from profiles p where p.id = auth.uid();
end $$;

create or replace function public.set_display_name(new_name text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  -- Friends see this name in their list, so a blank one keeps the old name.
  insert into profiles (id, display_name)
  values (auth.uid(), nullif(left(btrim(new_name), 40), ''))
  on conflict (id) do update set display_name = coalesce(excluded.display_name, profiles.display_name);
end $$;

-- "Get a new link" in Share: a fresh code for the caller's link, so the old
-- link (say, one kept by someone they've since removed) stops working. Links
-- of their other accounts lead to them too (see user_for_code), so those get
-- fresh codes as well. Friends stay friends, since friend rows use account ids.
create or replace function public.new_share_code()
returns text
language plpgsql security definer set search_path = public as $$
declare
  fresh text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update profiles set share_code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
  where duplicate_of = auth.uid();
  update profiles set share_code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
  where id = auth.uid()
  returning share_code into fresh;
  return fresh;
end $$;

-- The account behind a friend link: its own, or the one its link now leads to
-- (see duplicate_of).
create or replace function public.user_for_code(code text)
returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(p.duplicate_of, p.id) from profiles p where p.share_code = code;
$$;

-- Signing in with Google where someone has been answering as a visitor links
-- Google to that same account. If their Google account already has its own
-- woometer account (say, from another device), the browser moves to that one
-- instead and takes its answers along, and the visitor account stays behind
-- with a copy. So before moving, the visitor account gets a secret from
-- start_move, and once signed in to the other account the browser hands it
-- to finish_move, which marks the one left behind as its duplicate. The
-- secret shows the same browser held both sign-ins.
create or replace function public.start_move()
returns text
language plpgsql security definer set search_path = public as $$
declare
  s text := replace(gen_random_uuid()::text, '-', '');
begin
  -- Only a visitor account is ever left behind this way.
  if auth.uid() is null or coalesce(auth.jwt() ->> 'is_anonymous', 'false') <> 'true' then return null; end if;
  insert into moves (secret, from_user) values (s, auth.uid());
  return s;
end $$;

create or replace function public.finish_move(proof text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  left_behind uuid;
  now_using uuid;
begin
  if auth.uid() is null then return; end if;
  update moves m set used_at = now()
  where m.secret = proof and m.used_at is null and m.created_at > now() - interval '1 hour'
  returning m.from_user into left_behind;
  if left_behind is null or left_behind = auth.uid() then return; end if;
  select coalesce(p.duplicate_of, p.id) into now_using from profiles p where p.id = auth.uid();
  update profiles set duplicate_of = coalesce(now_using, auth.uid()) where id = left_behind and duplicate_of is null;
end $$;

-- When an account is marked as someone's duplicate (by finish_move or in the
-- SQL editor), the account they use now takes over its friends, both ways and
-- with any nicknames, unless the pair is already friends, and its friend
-- requests, sent and received. Friend lists and requests leave the duplicate
-- out (see my_friends and my_requests), so a friend sees that person once.
create or replace function public.duplicate_friends()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.duplicate_of is null or new.duplicate_of = new.id or new.duplicate_of is not distinct from old.duplicate_of then
    return null;
  end if;
  insert into friends (user_id, friend_id, created_at, nickname, added_by)
  select new.duplicate_of, f.friend_id, f.created_at, f.nickname,
         case when f.added_by = new.id then new.duplicate_of else f.added_by end
  from friends f
  where f.user_id = new.id and f.friend_id <> new.duplicate_of
  on conflict do nothing;
  insert into friends (user_id, friend_id, created_at, nickname, added_by)
  select f.user_id, new.duplicate_of, f.created_at, f.nickname,
         case when f.added_by = new.id then new.duplicate_of else f.added_by end
  from friends f
  where f.friend_id = new.id and f.user_id <> new.duplicate_of
  on conflict do nothing;
  insert into friend_requests (from_user, to_user, created_at, status, answered_at, cancelled_at)
  select new.duplicate_of, r.to_user, r.created_at, r.status, r.answered_at, r.cancelled_at
  from friend_requests r
  where r.from_user = new.id and r.to_user <> new.duplicate_of
  on conflict do nothing;
  insert into friend_requests (from_user, to_user, created_at, status, answered_at, cancelled_at)
  select r.from_user, new.duplicate_of, r.created_at, r.status, r.answered_at, r.cancelled_at
  from friend_requests r
  where r.to_user = new.id and r.from_user <> new.duplicate_of
  on conflict do nothing;
  return null;
end $$;

create or replace trigger duplicate_friends
  after update of duplicate_of on public.profiles
  for each row execute function public.duplicate_friends();

-- The name behind a friend link, for the "X wants to compare" banner.
create or replace function public.name_for_code(code text)
returns text
language sql stable security definer set search_path = public as $$
  select display_name from profiles where id = user_for_code(code);
$$;

-- Whether a friend link leads to anyone, so an old or mistyped link can say
-- it doesn't work instead of showing an empty result.
create or replace function public.link_works(code text)
returns boolean
language sql stable security definer set search_path = public as $$
  select user_for_code(code) is not null;
$$;

-- Puts each of you in the other's friend list and marks any request between
-- you accepted. Only runs inside ask_friend and answer_friend_request. added_by is
-- whoever made it happen (by accepting, or by asking someone who had already
-- asked them), so the other person's Friends badge counts the new friend.
create or replace function public.make_friends(other uuid)
returns void
language sql security definer set search_path = public as $$
  insert into friends (user_id, friend_id, added_by)
  values (auth.uid(), other, auth.uid()), (other, auth.uid(), auth.uid())
  on conflict do nothing;
  update friend_requests set status = 'accepted', answered_at = now()
  where status <> 'accepted'
    and ((from_user = auth.uid() and to_user = other) or (from_user = other and to_user = auth.uid()));
$$;

-- Tapping "Add as a friend" on someone's link (or pasting it in Friends) asks
-- them to be friends. You need a name, since it shows in their requests. They
-- don't: having their link is enough, and once they accept they show as
-- "Unnamed friend" until they add a name or you give them a nickname.
-- Returns 'asked'; 'friends' if you already are, or if they had already asked
-- you (you both want it, so it happens right away); or null for an unknown
-- code or your own link.
create or replace function public.ask_friend(code text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  other uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from profiles where id = auth.uid() and btrim(display_name) <> '') then
    raise exception 'add your name first';
  end if;
  other := user_for_code(code);
  if other is null or other = auth.uid() then return null; end if;
  if exists (select 1 from friends where user_id = auth.uid() and friend_id = other) then
    return 'friends';
  end if;
  -- They had already asked you, so you both want it and it happens now.
  -- Their request is locked first, like Accept (see answer_friend_request),
  -- so if they tap Cancel at the same moment, one waits for the other.
  perform 1 from friend_requests
  where from_user = other and to_user = auth.uid() and status <> 'accepted' and cancelled_at is null
  for update;
  if found then
    perform make_friends(other);
    return 'friends';
  end if;
  -- Nobody can tap Accept for a pretend test account like John Doe, so
  -- asking one makes you friends at once.
  if exists (select 1 from profiles where id = other and is_tester) then
    perform make_friends(other);
    return 'friends';
  end if;
  -- Asking again after you were friends (one of you removed the other) is a
  -- new request. Asking again after being ignored stays ignored, quietly.
  insert into friend_requests as r (from_user, to_user) values (auth.uid(), other)
  on conflict (from_user, to_user) do update set
    status = case when r.status = 'accepted' then 'pending' else r.status end,
    answered_at = case when r.status = 'accepted' then null else r.answered_at end,
    created_at = case when r.status = 'accepted' or r.cancelled_at is not null then now() else r.created_at end,
    cancelled_at = null;
  return 'asked';
end $$;

-- Your friend requests: people asking you, waiting for Accept or Ignore
-- (incoming), and people you've asked who haven't accepted yet. One you
-- ignored leaves your list but still shows as sent to whoever asked, so
-- they aren't told. Leaves out duplicate accounts and anyone already a friend.
create or replace function public.my_requests()
returns table (other uuid, display_name text, asked_at timestamptz, incoming boolean)
language sql stable security definer set search_path = public as $$
  select r.from_user, p.display_name, r.created_at, true
  from friend_requests r
  left join profiles p on p.id = r.from_user
  where r.to_user = auth.uid() and r.status = 'pending' and r.cancelled_at is null
    and p.duplicate_of is null
    and not exists (select 1 from friends f where f.user_id = auth.uid() and f.friend_id = r.from_user)
  union all
  select r.to_user, p.display_name, r.created_at, false
  from friend_requests r
  left join profiles p on p.id = r.to_user
  where r.from_user = auth.uid() and r.status <> 'accepted' and r.cancelled_at is null
    and p.duplicate_of is null
    and not exists (select 1 from friends f where f.user_id = auth.uid() and f.friend_id = r.to_user)
  order by 3 desc;
$$;

-- Accept or Ignore on a request in Friends. Accepting makes you friends.
-- Ignoring takes it off your list without telling whoever asked. The request
-- is locked first, so if whoever asked taps Cancel at the same moment, one
-- waits for the other and never both happen: a Cancel that lands first
-- means no friends, and one that lands second finds you already are (see
-- cancel_my_request). Returns 'friends' or 'ignored'; 'cancelled' if they
-- took it back first; null if there's no such request.
create or replace function public.answer_friend_request(other uuid, accept boolean)
returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  perform 1 from friend_requests
  where from_user = other and to_user = auth.uid() and status <> 'accepted' and cancelled_at is null
  for update;
  if not found then
    if exists (select 1 from friend_requests
               where from_user = other and to_user = auth.uid() and cancelled_at is not null) then
      return 'cancelled';
    end if;
    return null;
  end if;
  if accept then
    perform make_friends(other);
    return 'friends';
  end if;
  update friend_requests set status = 'ignored', answered_at = now()
  where from_user = other and to_user = auth.uid() and status = 'pending';
  return 'ignored';
end $$;

-- What the page called before 14 Oct, kept for pages left open from then:
-- the same, with null for a request taken back.
create or replace function public.answer_request(other uuid, accept boolean)
returns text
language sql security definer set search_path = public as $$
  select nullif(answer_friend_request(other, accept), 'cancelled');
$$;

-- "Ignore all" in Friends, for a pile of requests from a link posted
-- somewhere public. Returns how many it ignored.
create or replace function public.ignore_requests()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update friend_requests set status = 'ignored', answered_at = now()
  where to_user = auth.uid() and status = 'pending' and cancelled_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Cancel on a request you sent. If they tap Accept at the same moment, one
-- waits for the other (see answer_friend_request), so the two never both
-- happen. Returns 'cancelled'; 'friends' if they had already accepted; null
-- if there's nothing to cancel.
create or replace function public.cancel_my_request(other uuid)
returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update friend_requests set cancelled_at = now()
  where from_user = auth.uid() and to_user = other and status <> 'accepted' and cancelled_at is null;
  if found then return 'cancelled'; end if;
  if exists (select 1 from friends where user_id = auth.uid() and friend_id = other) then
    return 'friends';
  end if;
  return null;
end $$;

-- What the page called before 14 Oct, kept for pages left open from then.
create or replace function public.cancel_request(other uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform cancel_my_request(other);
end $$;

-- What the page called before requests, kept for pages left open from then:
-- it asks too, and returns the friend's user id only once you're friends.
create or replace function public.add_friend(code text)
returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if ask_friend(code) = 'friends' then return user_for_code(code); end if;
  return null;
end $$;

-- Your friends, with the nickname you gave each one (if any), leaving out
-- anyone's duplicate account (see duplicate_friends). Dropped first because
-- the nickname column changed what it returns.
drop function if exists public.my_friends();
create function public.my_friends()
returns table (friend_id uuid, display_name text, nickname text, added_at timestamptz, answered bigint)
language sql stable security definer set search_path = public as $$
  select f.friend_id, p.display_name, f.nickname, f.created_at,
         (select count(*) from answers a where a.user_id = f.friend_id)
  from friends f
  left join profiles p on p.id = f.friend_id
  where f.user_id = auth.uid() and p.duplicate_of is null
  order by f.created_at desc;
$$;

-- Rename a friend in your own list; a blank nickname goes back to their name.
create or replace function public.set_friend_nickname(friend uuid, new_nickname text)
returns void
language sql security definer set search_path = public as $$
  update friends set nickname = nullif(left(btrim(new_nickname), 40), '')
  where user_id = auth.uid() and friend_id = friend;
$$;

-- The Friends badge, on any device: people who became your friends since you
-- last opened Friends (by accepting your request, or asking you after you
-- asked them), and everyone whose request is waiting for your Accept or
-- Ignore. Opening Friends calls saw_friends(), which clears the first kind;
-- requests count until you answer them.
create or replace function public.new_friends()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select f.friend_id from friends f
  left join profiles p on p.id = f.friend_id
  where f.user_id = auth.uid() and f.added_by = f.friend_id and p.duplicate_of is null
    and f.created_at > coalesce((select seen_at from friends_seen where user_id = auth.uid()), '-infinity')
  union
  select r.other from my_requests() r where r.incoming;
$$;

create or replace function public.saw_friends()
returns void
language sql security definer set search_path = public as $$
  insert into friends_seen (user_id, seen_at) values (auth.uid(), now())
  on conflict (user_id) do update set seen_at = excluded.seen_at;
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
  where a.user_id = user_for_code(code);
$$;

-- Yes, No and Not Sure totals per claim across everyone, for "N% of people
-- agree". Pass a list of claim ids to get just those, or nothing for every claim.
-- Test accounts and ignored spam are left out. Dropped first because the Not Sure column
-- changed what it returns.
drop function if exists public.claim_stats(text[]);
create function public.claim_stats(only_ids text[] default null)
returns table (claim_id text, yes bigint, no bigint, unsure bigint)
language sql stable security definer set search_path = public as $$
  select a.claim_id,
         count(*) filter (where a.answer = 'yes'),
         count(*) filter (where a.answer = 'no'),
         count(*) filter (where a.answer = 'unsure')
  from answers a
  where (only_ids is null or a.claim_id = any (only_ids))
    and a.user_id not in (select left_out_users())
  group by a.claim_id;
$$;

-- "Delete my account" in the account menu. Deleting the caller's sign-in also
-- deletes their profile, answers and friend rows in both directions, through
-- the "on delete cascade" on every table above.
create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = auth.uid();
end $$;

-- The numbers on woometer.com/stats, as one bundle: the average woo score
-- across everyone, how many people have each score, and Yes / No / Not Sure totals
-- per claim. A woo score is Yes out of all a person's answers, Not Sure
-- included, like the site's meter (score.js). Only totals, never who answered what. Test accounts and ignored spam are left out.
-- To keep the numbers meaningful, a person is counted once they have 10 Yes
-- or No answers, but only people with 50 count toward the average, median and
-- spread of woo %, and a claim is listed once it has 5. Anyone can
-- read it, even before the site has signed them in anonymously, through
-- site_stats() just below, which keeps the result for a minute.
create or replace function public.site_stats_fresh()
returns json
language sql stable security definer set search_path = public as $$
  with real_answers as (
    select a.user_id, a.claim_id, a.answer
    from answers a
    where a.user_id not in (select left_out_users())
  ),
  people as (
    select count(*) filter (where answer = 'yes')::numeric / count(*) as score,
           count(*) filter (where answer in ('yes', 'no')) as decided
    from real_answers
    group by user_id
    having count(*) filter (where answer in ('yes', 'no')) >= 10
  ),
  -- A woo % from only a few answers swings a lot, so the average, median
  -- and spread use people with 50 or more Yes or No answers.
  woo_people as (
    select score from people where decided >= 50
  ),
  claims as (
    select claim_id,
           count(*) filter (where answer = 'yes') as n_yes,
           count(*) filter (where answer = 'no') as n_no,
           count(*) filter (where answer = 'unsure') as n_unsure
    from real_answers
    group by claim_id
    having count(*) filter (where answer in ('yes', 'no')) >= 5
  )
  select json_build_object(
    'min_person_answers', 10,
    'min_woo_answers', 50,
    'min_claim_answers', 5,
    'people', (select count(*) from people),
    'woo_people', (select count(*) from woo_people),
    'average_score', (select avg(score) from woo_people),
    'median_score', (select percentile_cont(0.5) within group (order by score) from woo_people),
    -- How many people have each whole-number score, 0 to 100, as
    -- [{"pct": 4, "n": 3}, ...]. The page groups these into ranges.
    'scores', coalesce((select json_agg(json_build_object('pct', pct, 'n', n) order by pct)
                        from (select round(score * 100)::int as pct, count(*) as n
                              from woo_people group by 1) x), '[]'::json),
    'claims', coalesce((select json_agg(json_build_object(
                          'id', claim_id, 'yes', n_yes, 'no', n_no, 'unsure', n_unsure))
                        from claims), '[]'::json)
  );
$$;

create or replace function public.site_stats()
returns json
language plpgsql security definer set search_path = public as $$
declare
  result json;
begin
  select value into result from stats_cache where name = 'site' and made_at > now() - interval '1 minute';
  if result is null then
    result := site_stats_fresh();
    insert into stats_cache (name, value, made_at) values ('site', result, now())
    on conflict (name) do update set value = excluded.value, made_at = excluded.made_at;
  end if;
  return result;
end $$;

revoke execute on function public.site_stats_fresh() from public, anon, authenticated;
revoke execute on function public.site_stats() from public;
grant execute on function public.site_stats() to anon, authenticated;

-- Which continent each country is in, for the world map on /stats. Countries
-- are the two-letter codes Cloudflare puts in visits.country. Made by
-- tools/build-world-map.js; nobody can read it from the site.
create table if not exists public.country_continents (
  code text primary key,
  continent text not null
);
alter table public.country_continents enable row level security;
revoke all on public.country_continents from anon, authenticated;
insert into public.country_continents (code, continent) values
  ('AW', 'north-america'), ('AF', 'asia'), ('AO', 'africa'), ('AI', 'north-america'), ('AX', 'europe'), ('AL', 'europe'), ('AD', 'europe'), ('AE', 'asia'), ('AR', 'south-america'), ('AM', 'asia'),
  ('AS', 'oceania'), ('AG', 'north-america'), ('AU', 'oceania'), ('AT', 'europe'), ('AZ', 'asia'), ('BI', 'africa'), ('BE', 'europe'), ('BJ', 'africa'), ('BF', 'africa'), ('BD', 'asia'),
  ('BG', 'europe'), ('BH', 'asia'), ('BS', 'north-america'), ('BA', 'europe'), ('BL', 'north-america'), ('SH', 'africa'), ('BY', 'europe'), ('BZ', 'north-america'), ('BM', 'north-america'), ('BO', 'south-america'),
  ('BQ', 'north-america'), ('BR', 'south-america'), ('BB', 'north-america'), ('BN', 'asia'), ('BT', 'asia'), ('BW', 'africa'), ('CF', 'africa'), ('CA', 'north-america'), ('CC', 'oceania'), ('CH', 'europe'),
  ('CL', 'south-america'), ('CN', 'asia'), ('CI', 'africa'), ('CM', 'africa'), ('CD', 'africa'), ('CG', 'africa'), ('CK', 'oceania'), ('CO', 'south-america'), ('KM', 'africa'), ('CV', 'africa'),
  ('CR', 'north-america'), ('CU', 'north-america'), ('CW', 'north-america'), ('CX', 'oceania'), ('KY', 'north-america'), ('CY', 'europe'), ('CZ', 'europe'), ('DE', 'europe'), ('DJ', 'africa'), ('DM', 'north-america'),
  ('DK', 'europe'), ('DO', 'north-america'), ('DZ', 'africa'), ('EC', 'south-america'), ('EG', 'africa'), ('ER', 'africa'), ('EH', 'africa'), ('ES', 'europe'), ('EE', 'europe'), ('ET', 'africa'),
  ('FI', 'europe'), ('FJ', 'oceania'), ('FK', 'south-america'), ('FR', 'europe'), ('FO', 'europe'), ('FM', 'oceania'), ('GA', 'africa'), ('GB', 'europe'), ('GE', 'asia'), ('GG', 'europe'),
  ('GH', 'africa'), ('GI', 'europe'), ('GN', 'africa'), ('GP', 'north-america'), ('GM', 'africa'), ('GW', 'africa'), ('GQ', 'africa'), ('GR', 'europe'), ('GD', 'north-america'), ('GL', 'north-america'),
  ('GT', 'north-america'), ('GF', 'south-america'), ('GU', 'oceania'), ('GY', 'south-america'), ('HK', 'asia'), ('HN', 'north-america'), ('HR', 'europe'), ('HT', 'north-america'), ('HU', 'europe'), ('ID', 'asia'),
  ('IM', 'europe'), ('IN', 'asia'), ('IO', 'africa'), ('IE', 'europe'), ('IR', 'asia'), ('IQ', 'asia'), ('IS', 'europe'), ('IL', 'asia'), ('IT', 'europe'), ('JM', 'north-america'),
  ('JE', 'europe'), ('JO', 'asia'), ('JP', 'asia'), ('KZ', 'asia'), ('KE', 'africa'), ('KG', 'asia'), ('KH', 'asia'), ('KI', 'oceania'), ('KN', 'north-america'), ('KR', 'asia'),
  ('XK', 'europe'), ('KW', 'asia'), ('LA', 'asia'), ('LB', 'asia'), ('LR', 'africa'), ('LY', 'africa'), ('LC', 'north-america'), ('LI', 'europe'), ('LK', 'asia'), ('LS', 'africa'),
  ('LT', 'europe'), ('LU', 'europe'), ('LV', 'europe'), ('MO', 'asia'), ('MF', 'north-america'), ('MA', 'africa'), ('MC', 'europe'), ('MD', 'europe'), ('MG', 'africa'), ('MV', 'asia'),
  ('MX', 'north-america'), ('MH', 'oceania'), ('MK', 'europe'), ('ML', 'africa'), ('MT', 'europe'), ('MM', 'asia'), ('ME', 'europe'), ('MN', 'asia'), ('MP', 'oceania'), ('MZ', 'africa'),
  ('MR', 'africa'), ('MS', 'north-america'), ('MQ', 'north-america'), ('MU', 'africa'), ('MW', 'africa'), ('MY', 'asia'), ('YT', 'africa'), ('NA', 'africa'), ('NC', 'oceania'), ('NE', 'africa'),
  ('NF', 'oceania'), ('NG', 'africa'), ('NI', 'north-america'), ('NU', 'oceania'), ('NL', 'europe'), ('NO', 'europe'), ('NP', 'asia'), ('NR', 'oceania'), ('NZ', 'oceania'), ('OM', 'asia'),
  ('PK', 'asia'), ('PA', 'north-america'), ('PN', 'oceania'), ('PE', 'south-america'), ('PH', 'asia'), ('PW', 'oceania'), ('PG', 'oceania'), ('PL', 'europe'), ('PR', 'north-america'), ('KP', 'asia'),
  ('PT', 'europe'), ('PY', 'south-america'), ('PS', 'asia'), ('PF', 'oceania'), ('QA', 'asia'), ('RE', 'africa'), ('RO', 'europe'), ('RU', 'europe'), ('RW', 'africa'), ('SA', 'asia'),
  ('SD', 'africa'), ('SN', 'africa'), ('SG', 'asia'), ('SJ', 'europe'), ('SB', 'oceania'), ('SL', 'africa'), ('SV', 'north-america'), ('SM', 'europe'), ('SO', 'africa'), ('PM', 'north-america'),
  ('RS', 'europe'), ('SS', 'africa'), ('ST', 'africa'), ('SR', 'south-america'), ('SK', 'europe'), ('SI', 'europe'), ('SE', 'europe'), ('SZ', 'africa'), ('SX', 'north-america'), ('SC', 'africa'),
  ('SY', 'asia'), ('TC', 'north-america'), ('TD', 'africa'), ('TG', 'africa'), ('TH', 'asia'), ('TJ', 'asia'), ('TK', 'oceania'), ('TM', 'asia'), ('TL', 'asia'), ('TO', 'oceania'),
  ('TT', 'north-america'), ('TN', 'africa'), ('TR', 'asia'), ('TV', 'oceania'), ('TW', 'asia'), ('TZ', 'africa'), ('UG', 'africa'), ('UA', 'europe'), ('UM', 'north-america'), ('UY', 'south-america'),
  ('US', 'north-america'), ('UZ', 'asia'), ('VA', 'europe'), ('VC', 'north-america'), ('VE', 'south-america'), ('VG', 'north-america'), ('VI', 'north-america'), ('VN', 'asia'), ('VU', 'oceania'), ('WF', 'oceania'),
  ('WS', 'oceania'), ('YE', 'asia'), ('ZA', 'africa'), ('ZM', 'africa'), ('ZW', 'africa')
on conflict (code) do update set continent = excluded.continent;

-- The world map on woometer.com/stats: how many people answered from each
-- country, and totals per continent. Each person is placed in the country of
-- their latest visit. Only counts and totals leave the database, never IPs,
-- cities or who answered what, and testers and ignored networks are left out.
-- A continent shows its average and claims once at least 3 people there have
-- 10 Yes or No answers; claims need 5 Yes or No answers there, like site_stats.
-- Read through map_stats() below, which keeps the result for a minute.
create or replace function public.map_stats_fresh()
returns json
language sql stable security definer set search_path = public as $$
  with home as (
    select distinct on (v.user_id) v.user_id, upper(v.country) as code
    from visits v
    where v.country is not null
    order by v.user_id, v.last_seen desc
  ),
  placed as (
    select h.user_id, h.code, cc.continent
    from home h
    join country_continents cc on cc.code = h.code
    where exists (select 1 from answers a where a.user_id = h.user_id)
      and h.user_id not in (select left_out_users())
  ),
  people as (
    select p.continent,
           count(*) filter (where a.answer = 'yes')::numeric / count(*) as score,
           count(*) filter (where a.answer in ('yes', 'no')) as decided
    from placed p
    join answers a on a.user_id = p.user_id
    group by p.user_id, p.continent
    having count(*) filter (where a.answer in ('yes', 'no')) >= 10
  ),
  -- Woo % numbers use people with 50 or more Yes or No answers, like site_stats.
  continents as (
    select continent, count(*) as n,
           count(*) filter (where decided >= 50) as woo_n,
           avg(score) filter (where decided >= 50) as average_score,
           percentile_cont(0.5) within group (order by score) filter (where decided >= 50) as median_score
    from people
    group by continent
  ),
  scores as (
    select continent, round(score * 100)::int as pct, count(*) as n
    from people
    where decided >= 50 and continent in (select continent from continents where n >= 3 and woo_n >= 3)
    group by continent, round(score * 100)::int
  ),
  claims as (
    select p.continent, a.claim_id,
           count(*) filter (where a.answer = 'yes') as n_yes,
           count(*) filter (where a.answer = 'no') as n_no,
           count(*) filter (where a.answer = 'unsure') as n_unsure
    from placed p
    join answers a on a.user_id = p.user_id
    where p.continent in (select continent from continents where n >= 3)
    group by p.continent, a.claim_id
    having count(*) filter (where a.answer in ('yes', 'no')) >= 5
  )
  select json_build_object(
    'min_people', 3,
    'min_person_answers', 10,
    'min_woo_answers', 50,
    'min_claim_answers', 5,
    'countries', coalesce((select json_agg(json_build_object('code', code, 'n', n))
                           from (select code, count(*) as n from placed group by code) x), '[]'::json),
    'continents', coalesce((select json_agg(json_build_object(
                     'key', c.continent,
                     'people', c.n,
                     'woo_people', case when c.n >= 3 then c.woo_n end,
                     'average_score', case when c.n >= 3 and c.woo_n >= 3 then c.average_score end,
                     'median_score', case when c.n >= 3 and c.woo_n >= 3 then c.median_score end,
                     'scores', coalesce((select json_agg(json_build_object('pct', sc.pct, 'n', sc.n) order by sc.pct)
                                from scores sc where sc.continent = c.continent), '[]'::json),
                     'claims', coalesce((select json_agg(json_build_object(
                                  'id', cl.claim_id, 'yes', cl.n_yes, 'no', cl.n_no, 'unsure', cl.n_unsure))
                                from claims cl where cl.continent = c.continent), '[]'::json)))
                   from continents c), '[]'::json)
  );
$$;

create or replace function public.map_stats()
returns json
language plpgsql security definer set search_path = public as $$
declare
  result json;
begin
  select value into result from stats_cache where name = 'map' and made_at > now() - interval '1 minute';
  if result is null then
    result := map_stats_fresh();
    insert into stats_cache (name, value, made_at) values ('map', result, now())
    on conflict (name) do update set value = excluded.value, made_at = excluded.made_at;
  end if;
  return result;
end $$;

revoke execute on function public.map_stats_fresh() from public, anon, authenticated;
revoke execute on function public.map_stats() from public;
grant execute on function public.map_stats() to anon, authenticated;

-- How many claims people have answered, for "How far people get" on /stats:
-- the average and median count and how many answered every claim, for
-- everyone and for each continent with 3 or more people (placed like
-- map_stats). The same people as site_stats count. The page sends the claim
-- ids on the site now, so answers to retired claims aren't counted. Read
-- through answered_stats() below, which keeps the result for a minute.
create or replace function public.answered_stats_fresh(current_ids text[])
returns json
language sql stable security definer set search_path = public as $$
  with home as (
    select distinct on (v.user_id) v.user_id, upper(v.country) as code
    from visits v
    where v.country is not null
    order by v.user_id, v.last_seen desc
  ),
  people as (
    select a.user_id, count(*) filter (where a.claim_id = any (current_ids)) as n
    from answers a
    where a.user_id not in (select left_out_users())
    group by a.user_id
    having count(*) filter (where a.answer in ('yes', 'no')) >= 10
  ),
  placed as (
    select p.n, cc.continent
    from people p
    join home h on h.user_id = p.user_id
    join country_continents cc on cc.code = h.code
  ),
  continents as (
    select continent, count(*) as people, avg(n) as average,
           percentile_cont(0.5) within group (order by n) as median,
           count(*) filter (where n >= cardinality(current_ids)) as answered_all
    from placed
    group by continent
    having count(*) >= 3
  )
  select json_build_object(
    'claims', cardinality(current_ids),
    'people', (select count(*) from people),
    'average', (select avg(n) from people),
    'median', (select percentile_cont(0.5) within group (order by n) from people),
    'answered_all', (select count(*) from people where n >= cardinality(current_ids)),
    'continents', coalesce((select json_object_agg(continent, json_build_object(
                     'people', people, 'average', average, 'median', median, 'answered_all', answered_all))
                   from continents), '{}'::json)
  );
$$;

create or replace function public.answered_stats(current_ids text[])
returns json
language plpgsql security definer set search_path = public as $$
declare
  ids text[] := array(select distinct x from unnest(current_ids) x where x is not null order by x limit 2000);
  cache_key text := 'answered:' || md5(array_to_string(ids, ','));
  result json;
begin
  -- Everyone sends the same list, so one cached copy serves them all; any
  -- other list replaces it rather than piling up.
  select value into result from stats_cache
  where name = 'answered' and made_at > now() - interval '1 minute' and value->>'key' = cache_key;
  if result is null then
    result := (answered_stats_fresh(ids)::jsonb || jsonb_build_object('key', cache_key))::json;
    insert into stats_cache (name, value, made_at) values ('answered', result, now())
    on conflict (name) do update set value = excluded.value, made_at = excluded.made_at;
  end if;
  return result;
end $$;

revoke execute on function public.answered_stats_fresh(text[]) from public, anon, authenticated;
revoke execute on function public.answered_stats(text[]) from public;
grant execute on function public.answered_stats(text[]) to anon, authenticated;

revoke execute on function public.ensure_profile(), public.set_display_name(text), public.name_for_code(text),
  public.add_friend(text), public.my_friends(), public.set_friend_nickname(uuid, text), public.friend_answers(uuid), public.answers_for_code(text), public.claim_stats(text[]),
  public.new_friends(), public.saw_friends(), public.delete_my_account(), public.start_move(), public.finish_move(text),
  public.new_share_code(), public.link_works(text), public.ask_friend(text), public.my_requests(),
  public.answer_request(uuid, boolean), public.ignore_requests(), public.cancel_request(uuid),
  public.answer_friend_request(uuid, boolean), public.cancel_my_request(uuid) from public, anon;
grant execute on function public.ensure_profile(), public.set_display_name(text), public.name_for_code(text),
  public.add_friend(text), public.my_friends(), public.set_friend_nickname(uuid, text), public.friend_answers(uuid), public.answers_for_code(text), public.claim_stats(text[]),
  public.new_friends(), public.saw_friends(), public.delete_my_account(), public.start_move(), public.finish_move(text),
  public.new_share_code(), public.link_works(text), public.ask_friend(text), public.my_requests(),
  public.answer_request(uuid, boolean), public.ignore_requests(), public.cancel_request(uuid),
  public.answer_friend_request(uuid, boolean), public.cancel_my_request(uuid) to authenticated;

-- These only run inside the functions above, never called directly.
revoke execute on function public.record_visit(), public.ip_code(text), public.left_out_of_stats(uuid),
  public.left_out_users(), public.check_answers(), public.user_for_code(text), public.duplicate_friends(),
  public.make_friends(uuid) from public, anon, authenticated;
