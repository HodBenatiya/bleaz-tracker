-- Landing-page view and click counts. Additive only.
-- Creates public.landing_events and public.landing_events_daily.
-- Does not alter, drop, or read any existing table, policy, function, or row.
--
-- APPLY (project jiqhnonfqmcvdmkjbdds)
-- Supabase → SQL editor → paste this whole file → Run.
-- Safe to run more than once.
--
-- Daily counts (authenticated CRM users):
--   select day, views, clicks, click_rate
--   from public.landing_events_daily
--   order by day desc;
--
-- click_rate is clicks / views for that Asia/Jerusalem day, or null when views = 0.
-- The table stores no IP and no personal data. fbclid is a boolean only.

create or replace function public.landing_utm_ok(payload jsonb)
returns boolean
language sql
immutable
security definer
set search_path = public
as $$
  select
    jsonb_typeof(payload) = 'object'
    and (select count(*) from jsonb_object_keys(payload)) <= 12
    and not exists (
      select 1
      from jsonb_each_text(payload) kv
      where kv.key !~ '^utm_[a-z0-9_]{1,40}$'
         or char_length(kv.value) > 200
    );
$$;

revoke all on function public.landing_utm_ok(jsonb) from public;
grant execute on function public.landing_utm_ok(jsonb) to anon, authenticated, service_role;

create table if not exists public.landing_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event_type text not null,
  utm jsonb not null default '{}'::jsonb,
  has_fbclid boolean not null,
  user_agent text not null default '',
  is_fb_inapp boolean not null
);

comment on table public.landing_events is
  'Public jobs-page views and WhatsApp clicks. No IP, no fbclid value, no personal data.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'landing_events_event_type_chk'
      and conrelid = 'public.landing_events'::regclass
  ) then
    alter table public.landing_events
      add constraint landing_events_event_type_chk
      check (event_type in ('view', 'click'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'landing_events_utm_chk'
      and conrelid = 'public.landing_events'::regclass
  ) then
    alter table public.landing_events
      add constraint landing_events_utm_chk
      check (public.landing_utm_ok(utm));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'landing_events_user_agent_chk'
      and conrelid = 'public.landing_events'::regclass
  ) then
    alter table public.landing_events
      add constraint landing_events_user_agent_chk
      check (char_length(user_agent) <= 160);
  end if;
end $$;

create index if not exists landing_events_created_at_idx
  on public.landing_events (created_at);

alter table public.landing_events enable row level security;

revoke all on table public.landing_events from public, anon, authenticated;
grant insert (event_type, utm, has_fbclid, user_agent, is_fb_inapp)
  on table public.landing_events to anon;
grant select on table public.landing_events to authenticated;
grant all on table public.landing_events to service_role;

grant usage, select on sequence public.landing_events_id_seq to anon, service_role;

drop policy if exists landing_events_anon_insert on public.landing_events;
create policy landing_events_anon_insert
  on public.landing_events
  for insert
  to anon
  with check (
    event_type in ('view', 'click')
    and public.landing_utm_ok(utm)
    and char_length(user_agent) <= 160
  );

drop policy if exists landing_events_authenticated_select on public.landing_events;
create policy landing_events_authenticated_select
  on public.landing_events
  for select
  to authenticated
  using (true);

drop view if exists public.landing_events_daily;
create view public.landing_events_daily
with (security_invoker = true) as
select
  (created_at at time zone 'Asia/Jerusalem')::date as day,
  count(*) filter (where event_type = 'view') as views,
  count(*) filter (where event_type = 'click') as clicks,
  round(
    (count(*) filter (where event_type = 'click'))::numeric
    / nullif(count(*) filter (where event_type = 'view'), 0),
    4
  ) as click_rate
from public.landing_events
group by 1;

comment on view public.landing_events_daily is
  'Daily jobs-page views, WhatsApp clicks, and click rate. Asia/Jerusalem. Authenticated read only.';

revoke all on table public.landing_events_daily from public, anon;
grant select on table public.landing_events_daily to authenticated, service_role;
