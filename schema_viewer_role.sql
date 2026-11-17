-- Viewer role for natalie@nona-jobs.com.
-- Additive. Does not drop tables, columns, or CRM rows.
-- Does not modify schema.sql, schema_v2.sql, or schema_wa.sql.
-- Safe to run more than once.
--
-- APPLY (project jiqhnonfqmcvdmkjbdds)
-- 1. Deploy the frontend in this change first. Until this file runs, her
--    session can still read and write through PostgREST; the UI lock is not enough.
-- 2. Supabase → SQL editor → paste this whole file → Run.
-- 3. Check: select email, role from auth.users u
--    left join public.user_roles r on r.user_id = u.id
--    order by email;
--    natalie@nona-jobs.com must be 'viewer'. Every other existing user must be 'admin'.
--
-- ROLLBACK
-- Run schema_viewer_role_rollback.sql. It restores the previous
-- authenticated policies and drops only objects this file creates.
--
-- WHAT REMAINS POSSIBLE
-- A viewer can still page anything the screens show, 50 rows per call, through
-- public.viewer_read_page. A script using her access token can walk those pages
-- slowly. Each call is written to public.viewer_access_log. File bytes, wa_inbox,
-- token_env, sync logs, sync state, status history, and every write are denied.
-- The anon key without her session is unchanged: service-role jobs (meta-ads-sync,
-- pg_cron, WAHA ingest) bypass RLS, and the existing anon wa-media policies stay
-- so an ingest fallback that has no user JWT still works.

-- ── roles ───────────────────────────────────────────────────────────────────
-- Created before is_admin() so the SQL function body can be validated.

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'viewer')),
  created_at timestamptz not null default now()
);

comment on table public.user_roles is
  'admin keeps today''s full CRM access. viewer is read-only and cannot export files.';

alter table public.user_roles enable row level security;

revoke all on table public.user_roles from public, anon, authenticated;
grant select on table public.user_roles to authenticated;
grant all on table public.user_roles to service_role;

drop policy if exists user_roles_select_self on public.user_roles;
create policy user_roles_select_self
  on public.user_roles
  for select
  to authenticated
  using (user_id = auth.uid());

-- ── role helpers ────────────────────────────────────────────────────────────

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when exists (
      select 1 from public.user_roles r
      where r.user_id = auth.uid() and r.role = 'viewer'
    ) then false
    when exists (
      select 1 from public.user_roles r
      where r.user_id = auth.uid() and r.role = 'admin'
    ) then true
    when exists (
      select 1 from auth.users u
      where u.id = auth.uid()
        and lower(u.email) = 'natalie@nona-jobs.com'
    ) then false
    else true
  end;
$$;

create or replace function public.is_viewer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and not public.is_admin();
$$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_viewer() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_viewer() to authenticated;

-- Existing accounts: admin, except Natalie. Re-running does not promote a
-- user who was later set to viewer, and it does pin Natalie back to viewer.
insert into public.user_roles (user_id, role)
select u.id, 'admin'
from auth.users u
where lower(coalesce(u.email, '')) <> 'natalie@nona-jobs.com'
on conflict (user_id) do nothing;

insert into public.user_roles (user_id, role)
select u.id, 'viewer'
from auth.users u
where lower(u.email) = 'natalie@nona-jobs.com'
on conflict (user_id) do update set role = 'viewer';

create or replace function public.assign_default_user_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_roles (user_id, role)
  values (
    new.id,
    case
      when lower(coalesce(new.email, '')) = 'natalie@nona-jobs.com' then 'viewer'
      else 'admin'
    end
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.assign_default_user_role() from public, anon, authenticated;

do $$
begin
  drop trigger if exists assign_default_user_role on auth.users;
  create trigger assign_default_user_role
    after insert on auth.users
    for each row execute function public.assign_default_user_role();
exception
  when insufficient_privilege or undefined_table then
    raise notice 'user role trigger not installed: %', sqlerrm;
end $$;

-- ── writes and direct reads ─────────────────────────────────────────────────
-- Policies are OR-ed. The old FOR ALL / FOR SELECT policies use (true), so a
-- viewer would still match them. Point every policy on these tables at
-- is_admin(). Service role and pg_cron bypass RLS and are not affected.
-- Missing policies are created so a partial earlier install still locks down.

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'reports', 'positions', 'pipeline_companies', 'tasks', 'candidates'
  ]
  loop
    if to_regclass('public.' || tbl) is null then
      continue;
    end if;
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = tbl
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
        tbl || '_authenticated_all',
        tbl
      );
    end if;
  end loop;
end $$;

do $$
declare
  pol record;
begin
  for pol in
    select tablename, policyname, cmd
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'reports', 'positions', 'pipeline_companies', 'tasks', 'candidates', 'wa_inbox',
        'meta_ad_accounts', 'meta_campaign_daily', 'meta_campaign_today', 'meta_campaigns',
        'meta_campaign_positions', 'meta_ads_settings', 'meta_sync_state', 'meta_sync_log',
        'meta_adsets', 'meta_ads', 'meta_ad_insights_daily', 'meta_ad_placement_insights_daily',
        'meta_campaign_region_insights_daily', 'meta_status_history'
      ])
  loop
    if pol.cmd = 'SELECT' or pol.cmd = 'DELETE' then
      execute format(
        'alter policy %I on public.%I using (public.is_admin())',
        pol.policyname, pol.tablename
      );
    elsif pol.cmd = 'INSERT' then
      execute format(
        'alter policy %I on public.%I with check (public.is_admin())',
        pol.policyname, pol.tablename
      );
    else
      execute format(
        'alter policy %I on public.%I using (public.is_admin()) with check (public.is_admin())',
        pol.policyname, pol.tablename
      );
    end if;
  end loop;
end $$;

-- wa_inbox stays closed to viewers. Drop a legacy policy that also covered
-- anon (schema_wa.sql). Ingest uses the service role, which bypasses RLS.
do $$
declare
  pol record;
begin
  if to_regclass('public.wa_inbox') is null then
    return;
  end if;
  for pol in
    select policyname, roles
    from pg_policies
    where schemaname = 'public' and tablename = 'wa_inbox'
  loop
    if 'anon' = any (pol.roles) then
      execute format('drop policy if exists %I on public.wa_inbox', pol.policyname);
    end if;
  end loop;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'wa_inbox'
  ) then
    create policy wa_inbox_admin_all
      on public.wa_inbox
      for all to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end $$;

-- ── storage: viewers get nothing ────────────────────────────────────────────
-- Anon wa-media policies stay so a no-JWT ingest fallback still works.
-- Authenticated read/write requires admin. service_role bypasses RLS.

do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (
        policyname ilike '%wa media%'
        or policyname ilike '%wa-media%'
        or policyname ilike '%cvs%'
        or coalesce(qual, '') ilike '%wa-media%'
        or coalesce(qual, '') ilike '%cvs%'
        or coalesce(with_check, '') ilike '%wa-media%'
        or coalesce(with_check, '') ilike '%cvs%'
      )
  loop
    execute format('drop policy if exists %I on storage.objects', pol.policyname);
  end loop;
end $$;

create policy "wa media anon upload"
  on storage.objects for insert to anon
  with check (bucket_id = 'wa-media');

create policy "wa media anon update"
  on storage.objects for update to anon
  using (bucket_id = 'wa-media')
  with check (bucket_id = 'wa-media');

create policy "wa media anon read"
  on storage.objects for select to anon
  using (bucket_id = 'wa-media');

create policy "wa media admin read"
  on storage.objects for select to authenticated
  using (bucket_id = 'wa-media' and public.is_admin());

create policy "wa media admin insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'wa-media' and public.is_admin());

create policy "wa media admin update"
  on storage.objects for update to authenticated
  using (bucket_id = 'wa-media' and public.is_admin())
  with check (bucket_id = 'wa-media' and public.is_admin());

create policy "cvs admin select"
  on storage.objects for select to authenticated
  using (bucket_id = 'cvs' and public.is_admin());

create policy "cvs admin insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'cvs' and public.is_admin());

create policy "cvs admin update"
  on storage.objects for update to authenticated
  using (bucket_id = 'cvs' and public.is_admin())
  with check (bucket_id = 'cvs' and public.is_admin());

create policy "cvs admin delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'cvs' and public.is_admin());

-- ── redact file pointers inside jsonb the screens still show ───────────────

create or replace function public.viewer_redact_json(value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  key text;
  val jsonb;
  next jsonb;
  out jsonb;
  elem jsonb;
  arr jsonb;
  stripped text;
begin
  if value is null or jsonb_typeof(value) = 'null' then
    return 'null'::jsonb;
  end if;
  if jsonb_typeof(value) = 'array' then
    arr := '[]'::jsonb;
    for elem in select jsonb_array_elements(value)
    loop
      arr := arr || jsonb_build_array(public.viewer_redact_json(elem));
    end loop;
    return arr;
  end if;
  if jsonb_typeof(value) = 'string' then
    stripped := value #>> '{}';
    if stripped ~* '^(cvs:|wa-media:)'
       or stripped ~* '/storage/v1/object/'
       or stripped ~* '/api/wa-media\?'
    then
      return 'null'::jsonb;
    end if;
    return value;
  end if;
  if jsonb_typeof(value) <> 'object' then
    return value;
  end if;
  out := '{}'::jsonb;
  for key, val in select * from jsonb_each(value)
  loop
    if key in (
      'clientToken', 'cvUrl', 'fileUrl', 'filePath', 'downloadUrl',
      'token_env', 'accessToken', 'access_token', 'signedUrl'
    ) then
      continue;
    end if;
    next := public.viewer_redact_json(val);
    if next = 'null'::jsonb and jsonb_typeof(val) = 'string' then
      continue;
    end if;
    out := out || jsonb_build_object(key, next);
  end loop;
  return out;
end;
$$;

revoke all on function public.viewer_redact_json(jsonb) from public, anon, authenticated;

-- ── paged reads + access log ────────────────────────────────────────────────
-- Sensitive and not returned: token_env, wa_inbox, meta_sync_log,
-- meta_sync_state, meta_status_history, user_roles, viewer_access_log.

create table if not exists public.viewer_access_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  requested_at timestamptz not null default now(),
  table_name text not null,
  row_limit integer not null,
  row_offset integer not null,
  filter jsonb not null default '{}'::jsonb
);

comment on table public.viewer_access_log is
  'One row per successful viewer_read_page call. Viewers cannot read this table.';

create index if not exists viewer_access_log_user_idx
  on public.viewer_access_log (user_id, requested_at desc);

alter table public.viewer_access_log enable row level security;

revoke all on table public.viewer_access_log from public, anon, authenticated;
grant all on table public.viewer_access_log to service_role;

create or replace function public.viewer_read_page(
  p_table text,
  p_limit integer default 50,
  p_offset integer default 0,
  p_filter jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed text[] := array[
    'reports',
    'positions',
    'pipeline_companies',
    'tasks',
    'candidates',
    'meta_campaign_daily',
    'meta_campaign_today',
    'meta_campaigns',
    'meta_campaign_positions',
    'meta_ad_accounts',
    'meta_ads_settings',
    'meta_ads',
    'meta_ad_placement_insights_daily'
  ];
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  off integer := least(greatest(coalesce(p_offset, 0), 0), 1000000);
  v_gte date := null;
  v_lte date := null;
  v_day date := null;
  result jsonb := '[]'::jsonb;
  safe_filter jsonb := '{}'::jsonb;
begin
  if not public.is_viewer() then
    raise exception 'viewer_read_page is limited to the viewer role'
      using errcode = '42501';
  end if;
  if p_table is null or not (p_table = any (v_allowed)) then
    raise exception 'viewer table denied'
      using errcode = '42501';
  end if;

  if coalesce(p_filter->>'insight_date_gte', '') ~ '^\d{4}-\d{2}-\d{2}$' then
    v_gte := (p_filter->>'insight_date_gte')::date;
    safe_filter := safe_filter || jsonb_build_object('insight_date_gte', p_filter->>'insight_date_gte');
  end if;
  if coalesce(p_filter->>'insight_date_lte', '') ~ '^\d{4}-\d{2}-\d{2}$' then
    v_lte := (p_filter->>'insight_date_lte')::date;
    safe_filter := safe_filter || jsonb_build_object('insight_date_lte', p_filter->>'insight_date_lte');
  end if;
  if coalesce(p_filter->>'snapshot_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then
    v_day := (p_filter->>'snapshot_date')::date;
    safe_filter := safe_filter || jsonb_build_object('snapshot_date', p_filter->>'snapshot_date');
  end if;

  if p_table = 'reports' then
    select coalesce(jsonb_agg((to_jsonb(paged) - 'ord') order by paged.ord), '[]'::jsonb)
      into result
    from (
      select row_number() over () as ord, src.*
      from (
        select id, date, public.viewer_redact_json(data) as data, updated_at
        from public.reports
        order by date desc, id desc
        limit lim offset off
      ) src
    ) paged;
  elsif p_table = 'positions' then
    select coalesce(jsonb_agg((to_jsonb(paged) - 'ord') order by paged.ord), '[]'::jsonb)
      into result
    from (
      select row_number() over () as ord, src.*
      from (
        select id, public.viewer_redact_json(data) as data
        from public.positions
        order by id
        limit lim offset off
      ) src
    ) paged;
  elsif p_table = 'pipeline_companies' then
    select coalesce(jsonb_agg((to_jsonb(paged) - 'ord') order by paged.ord), '[]'::jsonb)
      into result
    from (
      select row_number() over () as ord, src.*
      from (
        select id, public.viewer_redact_json(data) as data
        from public.pipeline_companies
        order by id
        limit lim offset off
      ) src
    ) paged;
  elsif p_table = 'tasks' then
    select coalesce(jsonb_agg((to_jsonb(paged) - 'ord') order by paged.ord), '[]'::jsonb)
      into result
    from (
      select row_number() over () as ord, src.*
      from (
        select id, public.viewer_redact_json(data) as data
        from public.tasks
        order by id
        limit lim offset off
      ) src
    ) paged;
  elsif p_table = 'candidates' then
    begin
      select coalesce(jsonb_agg((to_jsonb(paged) - 'ord') order by paged.ord), '[]'::jsonb)
        into result
      from (
        select row_number() over () as ord, src.*
        from (
          select id,
                 public.viewer_redact_json(data) as data,
                 updated_at,
                 meta_account_id,
                 meta_campaign_id,
                 meta_adset_id,
                 meta_ad_id
          from public.candidates
          order by updated_at desc nulls last, id desc
          limit lim offset off
        ) src
      ) paged;
    exception
      when undefined_column then
        select coalesce(jsonb_agg((to_jsonb(paged) - 'ord') order by paged.ord), '[]'::jsonb)
          into result
        from (
          select row_number() over () as ord, src.*
          from (
            select id, public.viewer_redact_json(data) as data, updated_at
            from public.candidates
            order by updated_at desc nulls last, id desc
            limit lim offset off
          ) src
        ) paged;
    end;
  elsif p_table = 'meta_campaign_daily' then
    select coalesce(jsonb_agg((to_jsonb(paged) - 'ord') order by paged.ord), '[]'::jsonb)
      into result
    from (
      select row_number() over () as ord, src.*
      from (
        select account_id, campaign_id, campaign_name, insight_date, spend, currency, results
        from public.meta_campaign_daily
        where (v_gte is null or insight_date >= v_gte)
          and (v_lte is null or insight_date <= v_lte)
        order by insight_date, account_id, campaign_id
        limit lim offset off
      ) src
    ) paged;
  elsif p_table = 'meta_campaign_today' then
    select coalesce(jsonb_agg((to_jsonb(paged) - 'ord') order by paged.ord), '[]'::jsonb)
      into result
    from (
      select row_number() over () as ord, src.*
      from (
        select account_id, campaign_id, campaign_name, snapshot_date, spend, currency, results
        from public.meta_campaign_today
        where v_day is null or snapshot_date = v_day
        order by account_id, campaign_id
        limit lim offset off
      ) src
    ) paged;
  elsif p_table = 'meta_campaigns' then
    begin
      select coalesce(jsonb_agg((to_jsonb(paged) - 'ord') order by paged.ord), '[]'::jsonb)
        into result
      from (
        select row_number() over () as ord, src.*
        from (
          select account_id, campaign_id, campaign_name, currency, effective_status,
                 delivering, active_ads, active_adsets
          from public.meta_campaigns
          order by account_id, campaign_id
          limit lim offset off
        ) src
      ) paged;
    exception
      when undefined_column then
        select coalesce(jsonb_agg((to_jsonb(paged) - 'ord') order by paged.ord), '[]'::jsonb)
          into result
        from (
          select row_number() over () as ord, src.*
          from (
            select account_id, campaign_id, campaign_name, currency, effective_status
            from public.meta_campaigns
            order by account_id, campaign_id
            limit lim offset off
          ) src
        ) paged;
    end;
  elsif p_table = 'meta_campaign_positions' then
    select coalesce(jsonb_agg((to_jsonb(paged) - 'ord') order by paged.ord), '[]'::jsonb)
      into result
    from (
      select row_number() over () as ord, src.*
      from (
        select account_id, campaign_id, position_id
        from public.meta_campaign_positions
        order by account_id, campaign_id, position_id
        limit lim offset off
      ) src
    ) paged;
  elsif p_table = 'meta_ad_accounts' then
    -- token_env is not selected.
    select coalesce(jsonb_agg((to_jsonb(paged) - 'ord') order by paged.ord), '[]'::jsonb)
      into result
    from (
      select row_number() over () as ord, src.*
      from (
        select account_id, name, currency, timezone, enabled
        from public.meta_ad_accounts
        order by account_id
        limit lim offset off
      ) src
    ) paged;
  elsif p_table = 'meta_ads_settings' then
    select coalesce(jsonb_agg((to_jsonb(paged) - 'ord') order by paged.ord), '[]'::jsonb)
      into result
    from (
      select row_number() over () as ord, src.*
      from (
        select id, usd_to_ils
        from public.meta_ads_settings
        order by id
        limit lim offset off
      ) src
    ) paged;
  elsif p_table = 'meta_ads' then
    select coalesce(jsonb_agg((to_jsonb(paged) - 'ord') order by paged.ord), '[]'::jsonb)
      into result
    from (
      select row_number() over () as ord, src.*
      from (
        select account_id, ad_id, adset_id, campaign_id, name
        from public.meta_ads
        order by account_id, ad_id
        limit lim offset off
      ) src
    ) paged;
  elsif p_table = 'meta_ad_placement_insights_daily' then
    select coalesce(jsonb_agg((to_jsonb(paged) - 'ord') order by paged.ord), '[]'::jsonb)
      into result
    from (
      select row_number() over () as ord, src.*
      from (
        select publisher_platform, platform_position, spend, currency, leads, insight_date
        from public.meta_ad_placement_insights_daily
        where (v_gte is null or insight_date >= v_gte)
          and (v_lte is null or insight_date <= v_lte)
        order by insight_date, publisher_platform, platform_position
        limit lim offset off
      ) src
    ) paged;
  else
    raise exception 'viewer table denied'
      using errcode = '42501';
  end if;

  insert into public.viewer_access_log (user_id, table_name, row_limit, row_offset, filter)
  values (auth.uid(), p_table, lim, off, safe_filter);

  return coalesce(result, '[]'::jsonb);
end;
$$;

revoke all on function public.viewer_read_page(text, integer, integer, jsonb) from public, anon;
grant execute on function public.viewer_read_page(text, integer, integer, jsonb) to authenticated;

comment on function public.viewer_read_page(text, integer, integer, jsonb) is
  'Viewer reads, at most 50 rows. Admins keep using the tables directly.';
