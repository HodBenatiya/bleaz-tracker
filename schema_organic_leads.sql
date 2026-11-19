-- Daily organic Facebook leads, read from candidates.data.
-- Additive view only. Does not add a column: source and organicJob already
-- live in the candidate jsonb. No IP and no message text.
--
-- APPLY (project jiqhnonfqmcvdmkjbdds)
-- Supabase → SQL editor → paste this whole file → Run.
-- Safe to run more than once. Independent of schema_go_clicks.sql.
--
--   select day, job_id, leads, relevant, not_relevant
--   from public.organic_leads_daily
--   order by day desc, job_id;
--
-- relevant statuses: relevant, future_relevant, sent_to_client,
-- interview_scheduled, started_working, placement_complete.
-- not_relevant: irrelevant.
-- Other statuses (new, screening, call_scheduled, called) are leads that are
-- neither relevant nor not_relevant.

drop view if exists public.organic_leads_daily;
create view public.organic_leads_daily
with (security_invoker = true) as
select
  ((data->>'createdAt')::timestamptz at time zone 'Asia/Jerusalem')::date as day,
  nullif(data->>'organicJob', '')::int as job_id,
  count(*)::bigint as leads,
  (count(*) filter (
    where data->>'status' in (
      'relevant',
      'future_relevant',
      'sent_to_client',
      'interview_scheduled',
      'started_working',
      'placement_complete'
    )
  ))::bigint as relevant,
  (count(*) filter (where data->>'status' = 'irrelevant'))::bigint as not_relevant
from public.candidates
where data->>'source' = 'organic_fb'
  and data->>'createdAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
group by 1, 2;

comment on view public.organic_leads_daily is
  'Organic Facebook leads per Jerusalem day and job, from candidates.data. Authenticated read only.';

revoke all on table public.organic_leads_daily from public, anon;
grant select on table public.organic_leads_daily to authenticated, service_role;
