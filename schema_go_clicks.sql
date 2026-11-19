-- Short /go/<jobId> WhatsApp redirect clicks. Additive only.
-- Creates public.go_clicks and public.go_clicks_daily.
-- Does not alter, drop, or read landing_events. landing_events_daily counts
-- every event_type = 'click' as a /jobs page click, and landing_utm_ok only
-- allows utm_* keys, so these redirects cannot share that table.
--
-- APPLY (project jiqhnonfqmcvdmkjbdds)
-- Supabase → SQL editor → paste this whole file → Run.
-- Safe to run more than once.
-- Until this runs, /go still redirects. Inserts fail, are logged, and are ignored.
--
-- Daily counts (authenticated CRM users):
--   select day, job_id, group_id, clicks
--   from public.go_clicks_daily
--   order by day desc, job_id, group_id nulls first;
--
-- The table stores job id, optional group id, and created_at. No IP, no user agent,
-- no personal data. Inserts are service-role only (the apply function).

create table if not exists public.go_clicks (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  job_id int not null,
  group_id text
);

comment on table public.go_clicks is
  'GET /go/<jobId> clicks. Job id, optional group id, timestamp. No IP, no user agent, no personal data.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'go_clicks_job_id_chk'
      and conrelid = 'public.go_clicks'::regclass
  ) then
    alter table public.go_clicks
      add constraint go_clicks_job_id_chk
      check (job_id between 1 and 10);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'go_clicks_group_id_chk'
      and conrelid = 'public.go_clicks'::regclass
  ) then
    alter table public.go_clicks
      add constraint go_clicks_group_id_chk
      check (
        group_id is null
        or (
          char_length(group_id) between 1 and 64
          and group_id ~ '^[A-Za-z0-9_-]+$'
        )
      );
  end if;
end $$;

create index if not exists go_clicks_created_at_idx
  on public.go_clicks (created_at);

create index if not exists go_clicks_job_created_idx
  on public.go_clicks (job_id, created_at);

alter table public.go_clicks enable row level security;

revoke all on table public.go_clicks from public, anon, authenticated;
grant select on table public.go_clicks to authenticated;
grant all on table public.go_clicks to service_role;

grant usage, select on sequence public.go_clicks_id_seq to service_role;

drop policy if exists go_clicks_authenticated_select on public.go_clicks;
create policy go_clicks_authenticated_select
  on public.go_clicks
  for select
  to authenticated
  using (true);

drop view if exists public.go_clicks_daily;
create view public.go_clicks_daily
with (security_invoker = true) as
select
  (created_at at time zone 'Asia/Jerusalem')::date as day,
  job_id,
  group_id,
  count(*)::bigint as clicks
from public.go_clicks
group by 1, 2, 3;

comment on view public.go_clicks_daily is
  'Daily /go WhatsApp clicks per job and group. Asia/Jerusalem. Authenticated read only. group_id is null when g was missing or invalid.';

revoke all on table public.go_clicks_daily from public, anon;
grant select on table public.go_clicks_daily to authenticated, service_role;
