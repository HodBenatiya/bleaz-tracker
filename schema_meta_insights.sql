-- Deeper Meta read models: ad daily insights, placement, region, ad metadata,
-- candidate ad link, and the views a marketing agent can read.
-- Additive only. Nullable new columns. No deletes.
-- Do not run schema.sql, schema_v2.sql, or schema_wa.sql.
-- Safe to run more than once.
--
-- Lead definition (same as the campaign sync, not a sum):
-- the first positive action among
--   onsite_conversion.messaging_conversation_started_7d,
--   onsite_conversion.messaging_first_reply,
--   onsite_conversion.total_messaging_connection,
--   messaging_conversation_started_7d,
--   contact_total,
--   lead,
--   onsite_conversion.lead_grouped,
--   omni_lead.
-- Ad and placement dates are Meta's reporting date (the ad account timezone).
-- They are not shifted to Israel hours, because those breakdowns are daily.

-- ── ad and ad set metadata ──────────────────────────────────────────────────

create table if not exists public.meta_adsets (
  account_id text not null,
  adset_id text not null,
  campaign_id text not null,
  name text not null default '',
  status text not null default '',
  effective_status text not null default '',
  created_time timestamptz,
  updated_at timestamptz not null default now(),
  primary key (account_id, adset_id)
);

create table if not exists public.meta_ads (
  account_id text not null,
  ad_id text not null,
  adset_id text not null default '',
  campaign_id text not null default '',
  name text not null default '',
  status text not null default '',
  effective_status text not null default '',
  creative_id text not null default '',
  thumbnail_url text not null default '',
  created_time timestamptz,
  updated_at timestamptz not null default now(),
  primary key (account_id, ad_id)
);

-- ── daily facts ─────────────────────────────────────────────────────────────

create table if not exists public.meta_ad_insights_daily (
  account_id text not null,
  campaign_id text not null,
  adset_id text not null default '',
  ad_id text not null,
  ad_name text not null default '',
  insight_date date not null,
  currency text not null default '',
  spend numeric not null default 0,
  impressions integer not null default 0,
  reach integer not null default 0,
  frequency numeric,
  clicks integer not null default 0,
  inline_link_clicks integer not null default 0,
  ctr numeric,
  cpm numeric,
  cpc numeric,
  leads integer not null default 0,
  lead_action text not null default '',
  cost_per_lead numeric,
  synced_at timestamptz not null default now(),
  primary key (account_id, ad_id, insight_date)
);

create index if not exists meta_ad_insights_daily_date_idx
  on public.meta_ad_insights_daily (insight_date);

create table if not exists public.meta_ad_placement_insights_daily (
  account_id text not null,
  campaign_id text not null,
  adset_id text not null default '',
  ad_id text not null,
  ad_name text not null default '',
  insight_date date not null,
  publisher_platform text not null default '',
  platform_position text not null default '',
  currency text not null default '',
  spend numeric not null default 0,
  impressions integer not null default 0,
  reach integer not null default 0,
  frequency numeric,
  clicks integer not null default 0,
  inline_link_clicks integer not null default 0,
  ctr numeric,
  cpm numeric,
  cpc numeric,
  leads integer not null default 0,
  lead_action text not null default '',
  cost_per_lead numeric,
  synced_at timestamptz not null default now(),
  primary key (account_id, ad_id, insight_date, publisher_platform, platform_position)
);

create table if not exists public.meta_campaign_region_insights_daily (
  account_id text not null,
  campaign_id text not null,
  insight_date date not null,
  region text not null default '',
  currency text not null default '',
  spend numeric not null default 0,
  impressions integer not null default 0,
  reach integer not null default 0,
  frequency numeric,
  clicks integer not null default 0,
  inline_link_clicks integer not null default 0,
  ctr numeric,
  cpm numeric,
  cpc numeric,
  leads integer not null default 0,
  lead_action text not null default '',
  cost_per_lead numeric,
  synced_at timestamptz not null default now(),
  primary key (account_id, campaign_id, insight_date, region)
);

-- ── status changes seen by each sync ────────────────────────────────────────

create table if not exists public.meta_status_history (
  id bigint generated always as identity primary key,
  account_id text not null,
  object_type text not null,
  object_id text not null,
  effective_status text not null default '',
  delivering boolean,
  observed_at timestamptz not null default now()
);

create index if not exists meta_status_history_object_idx
  on public.meta_status_history (account_id, object_type, object_id, observed_at desc);

-- ── candidate link down to the ad, when the referral has an ad id ───────────

alter table public.candidates
  add column if not exists meta_adset_id text,
  add column if not exists meta_ad_id text;

comment on column public.candidates.meta_adset_id is
  'Meta ad set id when the WhatsApp referral matched a stored ad. Null means campaign-level only.';
comment on column public.candidates.meta_ad_id is
  'Meta ad id when the WhatsApp referral source id matched a stored ad.';

-- ── locks ───────────────────────────────────────────────────────────────────

do $rls$
declare
  tbl text;
begin
  foreach tbl in array array[
    'meta_adsets',
    'meta_ads',
    'meta_ad_insights_daily',
    'meta_ad_placement_insights_daily',
    'meta_campaign_region_insights_daily',
    'meta_status_history'
  ]
  loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on table public.%I from public, anon, authenticated', tbl);
    execute format('grant select on table public.%I to authenticated', tbl);
    execute format('grant all on table public.%I to service_role', tbl);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = tbl and policyname = tbl || '_select'
    ) then
      execute format(
        'create policy %I on public.%I for select to authenticated using (true)',
        tbl || '_select', tbl
      );
    end if;
  end loop;
end
$rls$;

grant usage, select on sequence public.meta_status_history_id_seq to service_role;

-- ── quality views ───────────────────────────────────────────────────────────
-- Totals over everything synced, not a date filter. The daily tables are the
-- grain for a custom range. Placement month overrides are not applied here:
-- a placement is a candidate whose status is started_working or placement_complete.

create or replace view public.meta_campaign_quality
with (security_invoker = true) as
with linked as (
  select
    coalesce(nullif(c.meta_account_id, ''), c.data->>'metaAccountId') as account_id,
    coalesce(nullif(c.meta_campaign_id, ''), c.data->>'metaCampaignId') as campaign_id,
    coalesce(c.data->>'status', '') as status
  from public.candidates c
),
crm as (
  select
    account_id,
    campaign_id,
    count(*) as crm_leads,
    count(*) filter (where status in ('relevant','sent_to_client','interview_scheduled','started_working','placement_complete')) as relevant,
    count(*) filter (where status in ('sent_to_client','interview_scheduled','started_working','placement_complete')) as sent_to_employer,
    count(*) filter (where status in ('interview_scheduled','started_working','placement_complete')) as interviews,
    count(*) filter (where status in ('started_working','placement_complete')) as placements,
    count(*) filter (where status = 'irrelevant') as not_relevant
  from linked
  where coalesce(campaign_id, '') <> ''
  group by account_id, campaign_id
),
meta as (
  select
    account_id,
    campaign_id,
    max(campaign_name) as campaign_name,
    sum(spend) as meta_spend,
    sum(results) as meta_leads
  from public.meta_campaign_daily
  group by account_id, campaign_id
)
select
  coalesce(m.account_id, c.account_id) as account_id,
  coalesce(m.campaign_id, c.campaign_id) as campaign_id,
  coalesce(m.campaign_name, '') as campaign_name,
  coalesce(m.meta_spend, 0) as meta_spend,
  coalesce(m.meta_leads, 0) as meta_leads,
  case when coalesce(m.meta_leads, 0) > 0 then m.meta_spend / m.meta_leads end as meta_cost_per_lead,
  coalesce(c.crm_leads, 0) as crm_leads,
  coalesce(c.relevant, 0) as relevant,
  coalesce(c.sent_to_employer, 0) as sent_to_employer,
  coalesce(c.interviews, 0) as interviews,
  coalesce(c.placements, 0) as placements,
  coalesce(c.not_relevant, 0) as not_relevant,
  case when coalesce(c.crm_leads, 0) > 0 then m.meta_spend / c.crm_leads end as cost_per_crm_lead,
  case when coalesce(c.relevant, 0) > 0 then m.meta_spend / c.relevant end as cost_per_relevant,
  case when coalesce(c.interviews, 0) > 0 then m.meta_spend / c.interviews end as cost_per_interview,
  case when coalesce(c.placements, 0) > 0 then m.meta_spend / c.placements end as cost_per_placement
from meta m
full join crm c on c.account_id = m.account_id and c.campaign_id = m.campaign_id;

create or replace view public.meta_ad_quality
with (security_invoker = true) as
with linked as (
  select
    coalesce(nullif(c.meta_account_id, ''), c.data->>'metaAccountId') as account_id,
    coalesce(nullif(c.meta_ad_id, ''), c.data->>'metaAdId') as ad_id,
    coalesce(c.data->>'status', '') as status
  from public.candidates c
),
crm as (
  select
    account_id,
    ad_id,
    count(*) as crm_leads,
    count(*) filter (where status in ('relevant','sent_to_client','interview_scheduled','started_working','placement_complete')) as relevant,
    count(*) filter (where status in ('sent_to_client','interview_scheduled','started_working','placement_complete')) as sent_to_employer,
    count(*) filter (where status in ('interview_scheduled','started_working','placement_complete')) as interviews,
    count(*) filter (where status in ('started_working','placement_complete')) as placements,
    count(*) filter (where status = 'irrelevant') as not_relevant
  from linked
  where coalesce(ad_id, '') <> ''
  group by account_id, ad_id
),
meta as (
  select
    account_id,
    ad_id,
    max(campaign_id) as campaign_id,
    max(adset_id) as adset_id,
    max(ad_name) as ad_name,
    sum(spend) as meta_spend,
    sum(leads) as meta_leads
  from public.meta_ad_insights_daily
  group by account_id, ad_id
)
select
  coalesce(m.account_id, c.account_id) as account_id,
  coalesce(m.ad_id, c.ad_id) as ad_id,
  coalesce(m.adset_id, '') as adset_id,
  coalesce(m.campaign_id, '') as campaign_id,
  coalesce(m.ad_name, '') as ad_name,
  coalesce(m.meta_spend, 0) as meta_spend,
  coalesce(m.meta_leads, 0) as meta_leads,
  case when coalesce(m.meta_leads, 0) > 0 then m.meta_spend / m.meta_leads end as meta_cost_per_lead,
  coalesce(c.crm_leads, 0) as crm_leads,
  coalesce(c.relevant, 0) as relevant,
  coalesce(c.sent_to_employer, 0) as sent_to_employer,
  coalesce(c.interviews, 0) as interviews,
  coalesce(c.placements, 0) as placements,
  coalesce(c.not_relevant, 0) as not_relevant,
  case when coalesce(c.crm_leads, 0) > 0 then m.meta_spend / c.crm_leads end as cost_per_crm_lead,
  case when coalesce(c.relevant, 0) > 0 then m.meta_spend / c.relevant end as cost_per_relevant,
  case when coalesce(c.interviews, 0) > 0 then m.meta_spend / c.interviews end as cost_per_interview,
  case when coalesce(c.placements, 0) > 0 then m.meta_spend / c.placements end as cost_per_placement
from meta m
full join crm c on c.account_id = m.account_id and c.ad_id = m.ad_id;

-- ── signals for the marketing agent ─────────────────────────────────────────
-- Windows are relative to each ad's latest stored day, not the server clock.
-- CTR is clicks / impressions. Frequency is impressions / reach.
-- spend_without_leads_days counts days in the last 3 with spend and zero leads.
-- Ad insights are daily, so this is days, not clock hours.
-- creative_fatigue is true only when the last 3 days have data and frequency
-- rose, CTR fell, and CPL rose versus the previous 3 days.

create or replace view public.meta_ad_signals
with (security_invoker = true) as
with bounds as (
  select account_id, ad_id, max(insight_date) as as_of
  from public.meta_ad_insights_daily
  group by account_id, ad_id
),
rolled as (
  select
    d.account_id,
    d.ad_id,
    max(d.campaign_id) as campaign_id,
    max(d.ad_name) as ad_name,
    b.as_of,
    count(*) filter (where d.insight_date > b.as_of - 3 and d.insight_date <= b.as_of) as days_3,
    coalesce(sum(d.spend) filter (where d.insight_date > b.as_of - 3 and d.insight_date <= b.as_of), 0) as spend_3,
    coalesce(sum(d.leads) filter (where d.insight_date > b.as_of - 3 and d.insight_date <= b.as_of), 0) as leads_3,
    coalesce(sum(d.clicks) filter (where d.insight_date > b.as_of - 3 and d.insight_date <= b.as_of), 0) as clicks_3,
    coalesce(sum(d.impressions) filter (where d.insight_date > b.as_of - 3 and d.insight_date <= b.as_of), 0) as impressions_3,
    coalesce(sum(d.reach) filter (where d.insight_date > b.as_of - 3 and d.insight_date <= b.as_of), 0) as reach_3,
    count(*) filter (
      where d.insight_date > b.as_of - 3 and d.insight_date <= b.as_of and d.spend > 0 and d.leads = 0
    ) as spend_without_leads_days,
    coalesce(sum(d.spend) filter (where d.insight_date > b.as_of - 6 and d.insight_date <= b.as_of - 3), 0) as spend_prior,
    coalesce(sum(d.leads) filter (where d.insight_date > b.as_of - 6 and d.insight_date <= b.as_of - 3), 0) as leads_prior,
    coalesce(sum(d.clicks) filter (where d.insight_date > b.as_of - 6 and d.insight_date <= b.as_of - 3), 0) as clicks_prior,
    coalesce(sum(d.impressions) filter (where d.insight_date > b.as_of - 6 and d.insight_date <= b.as_of - 3), 0) as impressions_prior,
    coalesce(sum(d.reach) filter (where d.insight_date > b.as_of - 6 and d.insight_date <= b.as_of - 3), 0) as reach_prior,
    coalesce(sum(d.spend) filter (where d.insight_date > b.as_of - 7 and d.insight_date <= b.as_of), 0) as spend_7,
    coalesce(sum(d.leads) filter (where d.insight_date > b.as_of - 7 and d.insight_date <= b.as_of), 0) as leads_7
  from public.meta_ad_insights_daily d
  join bounds b on b.account_id = d.account_id and b.ad_id = d.ad_id
  group by d.account_id, d.ad_id, b.as_of
),
rates as (
  select
    r.*,
    case when r.leads_3 > 0 then r.spend_3 / r.leads_3 end as cpl_3d,
    case when r.leads_prior > 0 then r.spend_prior / r.leads_prior end as cpl_prior,
    case when r.leads_7 > 0 then r.spend_7 / r.leads_7 end as cpl_7d,
    case when r.impressions_3 > 0 then r.clicks_3::numeric / r.impressions_3 end as ctr_3d,
    case when r.impressions_prior > 0 then r.clicks_prior::numeric / r.impressions_prior end as ctr_prior,
    case when r.reach_3 > 0 then r.impressions_3::numeric / r.reach_3 end as frequency_3d,
    case when r.reach_prior > 0 then r.impressions_prior::numeric / r.reach_prior end as frequency_prior
  from rolled r
),
status_now as (
  select account_id, object_id, effective_status, delivering, observed_at,
    row_number() over (partition by account_id, object_id order by observed_at desc, id desc) as rn
  from public.meta_status_history
  where object_type = 'ad'
)
select
  r.account_id,
  r.ad_id,
  r.campaign_id,
  r.ad_name,
  r.as_of as as_of_date,
  r.days_3,
  r.cpl_3d,
  r.cpl_prior,
  r.cpl_7d,
  case when r.cpl_7d > 0 and r.cpl_3d is not null then ((r.cpl_3d - r.cpl_7d) / r.cpl_7d) * 100 end as cpl_change_pct,
  r.ctr_3d,
  r.ctr_prior,
  r.frequency_3d,
  r.frequency_prior,
  r.spend_without_leads_days,
  s1.delivering as delivering,
  s2.delivering as previous_delivering,
  s1.observed_at as status_observed_at,
  (s1.delivering is distinct from s2.delivering) as delivering_changed,
  (
    r.days_3 >= 3
    and r.frequency_3d is not null and r.frequency_prior is not null and r.frequency_3d > r.frequency_prior
    and r.ctr_3d is not null and r.ctr_prior is not null and r.ctr_3d < r.ctr_prior
    and r.cpl_3d is not null and r.cpl_prior is not null and r.cpl_3d > r.cpl_prior
  ) as creative_fatigue
from rates r
left join status_now s1 on s1.account_id = r.account_id and s1.object_id = r.ad_id and s1.rn = 1
left join status_now s2 on s2.account_id = r.account_id and s2.object_id = r.ad_id and s2.rn = 2;

do $views$
declare
  view_name text;
begin
  foreach view_name in array array['meta_campaign_quality', 'meta_ad_quality', 'meta_ad_signals']
  loop
    execute format('revoke all on table public.%I from public, anon', view_name);
    execute format('grant select on table public.%I to authenticated, service_role', view_name);
  end loop;
end
$views$;
