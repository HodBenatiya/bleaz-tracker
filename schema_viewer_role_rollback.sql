-- Undo schema_viewer_role.sql.
-- Run this whole file in the Supabase SQL editor. Do not run it unless you
-- mean to remove the viewer role.
--
-- Restores signed-in users to the previous "any authenticated user can do
-- everything" policies. Drops only objects the viewer migration created:
-- user_roles, viewer_access_log, and the helper functions.
-- Does not delete reports, candidates, positions, or any other CRM row.
-- Does not touch schema.sql, schema_v2.sql, or schema_wa.sql.
--
-- Anon access is not recreated. Production storage has these six policies,
-- all for authenticated, and none for anon. WAHA ingest uses the service role.

-- ── tables: put the old open policies back ──────────────────────────────────

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
      execute format('alter policy %I on public.%I using (true)', pol.policyname, pol.tablename);
    elsif pol.cmd = 'INSERT' then
      execute format('alter policy %I on public.%I with check (true)', pol.policyname, pol.tablename);
    else
      execute format(
        'alter policy %I on public.%I using (true) with check (true)',
        pol.policyname, pol.tablename
      );
    end if;
  end loop;
end $$;

-- ── storage: the six policies production has today, none for anon ───────────

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

create policy "wa media authenticated read"
  on storage.objects for select to authenticated
  using (bucket_id = 'wa-media');

create policy "wa media authenticated write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'wa-media');

create policy "cvs_authenticated_select"
  on storage.objects for select to authenticated
  using (bucket_id = 'cvs');

create policy "cvs_authenticated_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'cvs');

create policy "cvs_authenticated_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'cvs')
  with check (bucket_id = 'cvs');

create policy "cvs_authenticated_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'cvs');

-- ── drop only what the viewer migration added ───────────────────────────────

drop trigger if exists assign_default_user_role on auth.users;

drop function if exists public.viewer_read_page(text, integer, integer, jsonb);
drop function if exists public.viewer_redact_json(jsonb);
drop function if exists public.assign_default_user_role();
drop function if exists public.is_viewer();
drop function if exists public.is_admin();

drop table if exists public.viewer_access_log;
drop table if exists public.user_roles;
