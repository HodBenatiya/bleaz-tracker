-- Meta ads cost tables for the marketing screen.
-- Additive only. Does not change reports, candidates, positions, or login.
-- Any signed-in CRM user can read. Insight rows are written only by the
-- service role (the hourly edge function). Campaign mapping is edited in the
-- CRM, so signed-in users can insert and delete those rows.
--
-- Run this file in the Supabase SQL editor before schema_meta_ads_cron.sql.
-- Do not run schema.sql, schema_v2.sql, or schema_wa.sql.

-- ── accounts (config, not tokens) ───────────────────────────────────────────

create table if not exists public.meta_ad_accounts (
  account_id text primary key,
  name text not null,
  currency text not null,
  timezone text not null,
  token_env text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.meta_ad_accounts (account_id, name, currency, timezone, token_env, enabled)
values
  ('act_1001470104897244', 'nona-jobs', 'USD', 'America/Los_Angeles', 'META_TOKEN_NONA', true),
  ('act_353015671171644', 'nona-jobs empty', 'USD', 'America/Los_Angeles', 'META_TOKEN_NONA', false)
on conflict (account_id) do nothing;

-- BLEAZ has no account id in the repo (the old sync kept it in the browser).
-- After you know the id, either set the META_BLEAZ_ACCOUNT_ID secret or run:
-- insert into public.meta_ad_accounts (account_id, name, currency, timezone, token_env, enabled)
-- values ('act_PASTE_ID', 'BLEAZ', 'ILS', 'Asia/Jerusalem', 'META_TOKEN_BLEAZ', true)
-- on conflict (account_id) do nothing;

-- ── daily facts and the live "today" snapshot ───────────────────────────────

create table if not exists public.meta_campaign_daily (
  account_id text not null,
  campaign_id text not null,
  insight_date date not null,
  campaign_name text not null,
  currency text not null,
  spend numeric not null default 0,
  impressions integer not null default 0,
  clicks integer not null default 0,
  results integer not null default 0,
  result_action text not null default '',
  synced_at timestamptz not null default now(),
  primary key (account_id, campaign_id, insight_date)
);

create index if not exists meta_campaign_daily_date_idx
  on public.meta_campaign_daily (insight_date);

create table if not exists public.meta_campaign_today (
  account_id text not null,
  campaign_id text not null,
  snapshot_date date not null,
  campaign_name text not null,
  currency text not null,
  spend numeric not null default 0,
  impressions integer not null default 0,
  clicks integer not null default 0,
  results integer not null default 0,
  result_action text not null default '',
  synced_at timestamptz not null default now(),
  primary key (account_id, campaign_id)
);

create table if not exists public.meta_campaigns (
  account_id text not null,
  campaign_id text not null,
  campaign_name text not null,
  currency text not null default '',
  effective_status text not null default '',
  updated_at timestamptz not null default now(),
  primary key (account_id, campaign_id)
);

-- ── which campaign pays for which job ───────────────────────────────────────

create table if not exists public.meta_campaign_positions (
  account_id text not null,
  campaign_id text not null,
  position_id text not null,
  created_at timestamptz not null default now(),
  primary key (account_id, campaign_id, position_id)
);

-- ── display rate and sync bookkeeping ───────────────────────────────────────

create table if not exists public.meta_ads_settings (
  id text primary key,
  usd_to_ils numeric,
  updated_at timestamptz not null default now()
);

insert into public.meta_ads_settings (id, usd_to_ils)
values ('default', null)
on conflict (id) do nothing;

create table if not exists public.meta_sync_state (
  id text primary key,
  oldest_date date,
  updated_at timestamptz not null default now()
);

insert into public.meta_sync_state (id)
values ('default')
on conflict (id) do nothing;

create table if not exists public.meta_sync_log (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  accounts integer not null default 0,
  rows_daily integer not null default 0,
  rows_today integer not null default 0,
  message text not null default ''
);

-- ── locks: signed-in read, service-role write, mapping from the CRM ────────

do $rls$
declare
  tbl text;
begin
  foreach tbl in array array[
    'meta_ad_accounts',
    'meta_campaign_daily',
    'meta_campaign_today',
    'meta_campaigns',
    'meta_campaign_positions',
    'meta_ads_settings',
    'meta_sync_state',
    'meta_sync_log'
  ]
  loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on table public.%I from public, anon', tbl);
    execute format('grant select on table public.%I to authenticated', tbl);
    execute format('grant all on table public.%I to service_role', tbl);
  end loop;
end
$rls$;

grant usage, select on sequence public.meta_sync_log_id_seq to service_role;

do $pol$
declare
  tbl text;
begin
  foreach tbl in array array[
    'meta_ad_accounts',
    'meta_campaign_daily',
    'meta_campaign_today',
    'meta_campaigns',
    'meta_sync_state',
    'meta_sync_log'
  ]
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = tbl and policyname = tbl || '_select'
    ) then
      execute format(
        'create policy %I on public.%I for select to authenticated using (true)',
        tbl || '_select',
        tbl
      );
    end if;
  end loop;
end
$pol$;

grant insert, update, delete on table public.meta_campaign_positions to authenticated;

do $map$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'meta_campaign_positions' and policyname = 'meta_campaign_positions_all'
  ) then
    create policy meta_campaign_positions_all
      on public.meta_campaign_positions
      for all to authenticated
      using (true)
      with check (true);
  end if;
end
$map$;

grant update on table public.meta_ads_settings to authenticated;

do $fx$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'meta_ads_settings' and policyname = 'meta_ads_settings_select'
  ) then
    create policy meta_ads_settings_select
      on public.meta_ads_settings
      for select to authenticated
      using (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'meta_ads_settings' and policyname = 'meta_ads_settings_update'
  ) then
    create policy meta_ads_settings_update
      on public.meta_ads_settings
      for update to authenticated
      using (true)
      with check (true);
  end if;
end
$fx$;
