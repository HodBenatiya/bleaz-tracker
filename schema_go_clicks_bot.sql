-- Flag preview crawlers on /go clicks. Additive only.
-- The column may already exist. Daily counts stay human clicks only.
-- No user agent and no IP are stored.
--
-- APPLY (project jiqhnonfqmcvdmkjbdds)
-- Supabase → SQL editor → paste this whole file → Run.
-- Safe to run more than once. Run schema_go_clicks.sql and
-- schema_go_clicks_variant.sql first.

do $$
begin
  if to_regclass('public.go_clicks') is null then
    raise exception 'public.go_clicks does not exist. Run schema_go_clicks.sql first.';
  end if;
end $$;

alter table public.go_clicks
  add column if not exists is_bot boolean not null default false;

comment on column public.go_clicks.is_bot is
  'True for link-preview crawlers and non-browser clients. False for people. No user agent or IP.';

drop view if exists public.go_clicks_daily;
create view public.go_clicks_daily
with (security_invoker = true) as
select
  (created_at at time zone 'Asia/Jerusalem')::date as day,
  job_id,
  variant,
  group_id,
  count(*)::bigint as clicks
from public.go_clicks
where is_bot = false
group by 1, 2, 3, 4;

comment on view public.go_clicks_daily is
  'Daily human /go clicks per job, variant, and group. Asia/Jerusalem. Bots excluded. Authenticated read only.';

revoke all on table public.go_clicks_daily from public, anon;
grant select on table public.go_clicks_daily to authenticated, service_role;
