-- Optional ?v=A|B|C|D on /go/<jobId>. Additive only.
-- Does not rewrite click rows. Apply schema_go_clicks.sql first if the table
-- is not there yet.
--
-- APPLY (project jiqhnonfqmcvdmkjbdds)
-- Supabase → SQL editor → paste this whole file → Run.
-- Safe to run more than once.
--
-- go_clicks_daily is replaced so each row is day + job + variant + group.
-- Older rows have variant null.

do $$
begin
  if to_regclass('public.go_clicks') is null then
    raise exception 'public.go_clicks does not exist. Run schema_go_clicks.sql first.';
  end if;
end $$;

alter table public.go_clicks
  add column if not exists variant text;

comment on column public.go_clicks.variant is
  'Optional /go variant from ?v=. A, B, C, or D. Null when missing or invalid. No personal data.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'go_clicks_variant_chk'
      and conrelid = 'public.go_clicks'::regclass
  ) then
    alter table public.go_clicks
      add constraint go_clicks_variant_chk
      check (variant is null or variant in ('A', 'B', 'C', 'D'));
  end if;
end $$;

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
group by 1, 2, 3, 4;

comment on view public.go_clicks_daily is
  'Daily /go clicks per job, variant, and group. Asia/Jerusalem. Authenticated read only.';

revoke all on table public.go_clicks_daily from public, anon;
grant select on table public.go_clicks_daily to authenticated, service_role;
