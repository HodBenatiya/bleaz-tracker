-- Hourly schedule for the Meta ads sync. Run this AFTER:
-- 1. schema_meta_ads.sql
-- 2. the edge function meta-ads-sync is deployed
-- 3. the vault secret meta_sync_secret exists and matches the function secret META_SYNC_SECRET
--
-- Enable pg_cron and pg_net in Supabase: Database → Extensions.
-- Re-running this file only replaces the scheduler job. It does not delete ad data.
--
-- Create the vault secret yourself (paste the same value as META_SYNC_SECRET):
-- select vault.create_secret('PASTE_META_SYNC_SECRET', 'meta_sync_secret', 'Hourly Meta ads sync');

do $outer$
declare
  existing bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'Enable the pg_cron extension (Database → Extensions) and run this file again';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'Enable the pg_net extension (Database → Extensions) and run this file again';
  end if;

  select jobid into existing from cron.job where jobname = 'meta-ads-hourly';
  if existing is not null then
    perform cron.unschedule(existing);
  end if;

  perform cron.schedule(
    'meta-ads-hourly',
    '5 * * * *',
    $cmd$
    select net.http_post(
      url := 'https://jiqhnonfqmcvdmkjbdds.supabase.co/functions/v1/meta-ads-sync',
      body := '{"backfill_days":3}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'meta_sync_secret' limit 1)
      ),
      timeout_milliseconds := 120000
    );
    $cmd$
  );
end
$outer$;
