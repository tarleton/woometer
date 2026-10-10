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

create table if not exists public.answers (
  user_id uuid not null references auth.users (id) on delete cascade,
  claim_id text not null check (char_length(claim_id) between 1 and 100),
  answer text not null check (answer in ('yes', 'no', 'unsure')),
  updated_at timestamptz not null default now(),
  primary key (user_id, claim_id)
);

create index if not exists answers_claim_id_idx on public.answers (claim_id);

-- 'unsure' is the Don't Know button. Databases set up before it existed only
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

-- Row-level security

alter table public.profiles enable row level security;
alter table public.answers enable row level security;
alter table public.friends enable row level security;
alter table public.visits enable row level security;
alter table public.private_settings enable row level security;
alter table public.ignored_ip_codes enable row level security;

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
revoke all on public.visits, public.private_settings, public.ignored_ip_codes from anon, authenticated;
revoke insert, update, delete on public.profiles from authenticated;
revoke insert, update on public.friends from authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.answers to authenticated;
grant select, delete on public.friends to authenticated;

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

-- True for accounts kept out of the stats: testers, and anyone who has
-- visited from a network listed in ignored_ip_codes.
create or replace function public.left_out_of_stats(uid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = uid and p.is_tester)
      or exists (select 1 from visits v join ignored_ip_codes i using (ip_code) where v.user_id = uid);
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

-- The name behind a friend link, for the "X wants to compare" banner.
create or replace function public.name_for_code(code text)
returns text
language sql stable security definer set search_path = public as $$
  select display_name from profiles where share_code = code;
$$;

-- Tapping "Add as a friend" on someone's link adds each of you to the other's list.
-- Returns the friend's user id, or null for an unknown code, your own link, or
-- someone who hasn't given a name yet. Both of you need a name, so nobody shows
-- up in a friend list as "Unnamed friend".
create or replace function public.add_friend(code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  other uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from profiles where id = auth.uid() and btrim(display_name) <> '') then
    raise exception 'add your name first';
  end if;
  select id into other from profiles where share_code = code and btrim(display_name) <> '';
  if other is null or other = auth.uid() then return null; end if;
  insert into friends (user_id, friend_id) values (auth.uid(), other), (other, auth.uid())
  on conflict do nothing;
  return other;
end $$;

-- Your friends, with the nickname you gave each one (if any). Dropped first
-- because the nickname column changed what it returns.
drop function if exists public.my_friends();
create function public.my_friends()
returns table (friend_id uuid, display_name text, nickname text, added_at timestamptz, answered bigint)
language sql stable security definer set search_path = public as $$
  select f.friend_id, p.display_name, f.nickname, f.created_at,
         (select count(*) from answers a where a.user_id = f.friend_id)
  from friends f
  left join profiles p on p.id = f.friend_id
  where f.user_id = auth.uid()
  order by f.created_at desc;
$$;

-- Rename a friend in your own list; a blank nickname goes back to their name.
create or replace function public.set_friend_nickname(friend uuid, new_nickname text)
returns void
language sql security definer set search_path = public as $$
  update friends set nickname = nullif(left(btrim(new_nickname), 40), '')
  where user_id = auth.uid() and friend_id = friend;
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

-- Yes, No and Don't Know totals per claim across everyone, for "N% of people
-- agree". Pass a list of claim ids to get just those, or nothing for every claim.
-- Test accounts and ignored spam are left out. Dropped first because the Don't Know column
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
    and not left_out_of_stats(a.user_id)
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
-- across everyone, how many people have each score, and Yes / No / Don't Know totals
-- per claim. A woo score is Yes out of all a person's answers, Don't Know
-- included, like the site's meter (score.js). Only totals, never who answered what. Test accounts and ignored spam are left out.
-- To keep the numbers meaningful, a person counts toward the average once they
-- have 10 Yes or No answers, and a claim is listed once it has 5. Anyone can
-- read it, even before the site has signed them in anonymously.
create or replace function public.site_stats()
returns json
language sql stable security definer set search_path = public as $$
  with real_answers as (
    select a.user_id, a.claim_id, a.answer
    from answers a
    where not left_out_of_stats(a.user_id)
  ),
  people as (
    select count(*) filter (where answer = 'yes')::numeric / count(*) as score
    from real_answers
    group by user_id
    having count(*) filter (where answer in ('yes', 'no')) >= 10
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
    'min_claim_answers', 5,
    'people', (select count(*) from people),
    'average_score', (select avg(score) from people),
    'median_score', (select percentile_cont(0.5) within group (order by score) from people),
    -- How many people have each whole-number score, 0 to 100, as
    -- [{"pct": 4, "n": 3}, ...]. The page groups these into ranges.
    'scores', coalesce((select json_agg(json_build_object('pct', pct, 'n', n) order by pct)
                        from (select round(score * 100)::int as pct, count(*) as n
                              from people group by 1) x), '[]'::json),
    'claims', coalesce((select json_agg(json_build_object(
                          'id', claim_id, 'yes', n_yes, 'no', n_no, 'unsure', n_unsure))
                        from claims), '[]'::json)
  );
$$;

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
create or replace function public.map_stats()
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
      and not left_out_of_stats(h.user_id)
  ),
  people as (
    select p.continent,
           count(*) filter (where a.answer = 'yes')::numeric / count(*) as score
    from placed p
    join answers a on a.user_id = p.user_id
    group by p.user_id, p.continent
    having count(*) filter (where a.answer in ('yes', 'no')) >= 10
  ),
  continents as (
    select continent, count(*) as n, avg(score) as average_score,
           percentile_cont(0.5) within group (order by score) as median_score
    from people
    group by continent
  ),
  scores as (
    select continent, round(score * 100)::int as pct, count(*) as n
    from people
    where continent in (select continent from continents where n >= 3)
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
    'min_claim_answers', 5,
    'countries', coalesce((select json_agg(json_build_object('code', code, 'n', n))
                           from (select code, count(*) as n from placed group by code) x), '[]'::json),
    'continents', coalesce((select json_agg(json_build_object(
                     'key', c.continent,
                     'people', c.n,
                     'average_score', case when c.n >= 3 then c.average_score end,
                     'median_score', case when c.n >= 3 then c.median_score end,
                     'scores', coalesce((select json_agg(json_build_object('pct', sc.pct, 'n', sc.n) order by sc.pct)
                                from scores sc where sc.continent = c.continent), '[]'::json),
                     'claims', coalesce((select json_agg(json_build_object(
                                  'id', cl.claim_id, 'yes', cl.n_yes, 'no', cl.n_no, 'unsure', cl.n_unsure))
                                from claims cl where cl.continent = c.continent), '[]'::json)))
                   from continents c), '[]'::json)
  );
$$;

revoke execute on function public.map_stats() from public;
grant execute on function public.map_stats() to anon, authenticated;

revoke execute on function public.ensure_profile(), public.set_display_name(text), public.name_for_code(text),
  public.add_friend(text), public.my_friends(), public.set_friend_nickname(uuid, text), public.friend_answers(uuid), public.answers_for_code(text), public.claim_stats(text[]),
  public.delete_my_account() from public, anon;
grant execute on function public.ensure_profile(), public.set_display_name(text), public.name_for_code(text),
  public.add_friend(text), public.my_friends(), public.set_friend_nickname(uuid, text), public.friend_answers(uuid), public.answers_for_code(text), public.claim_stats(text[]),
  public.delete_my_account() to authenticated;

-- These only run inside the functions above, never called directly.
revoke execute on function public.record_visit(), public.ip_code(text), public.left_out_of_stats(uuid) from public, anon, authenticated;
