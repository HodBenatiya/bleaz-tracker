-- Replace the hourly Meta sync with a 30-minute today refresh and a nightly close.
-- Run after schema_meta_insights.sql and after the edge function is deployed.
-- Re-running only replaces scheduler jobs. It does not delete ad data.
-- Cron times are UTC. 2,32 * * * * is every 30 minutes.
-- 15 0 * * * is 00:15 UTC, about 02:15 Israel in winter and 03:15 in summer.
-- The vault secret meta_sync_secret must already match META_SYNC_SECRET.

do $outer$
declare
  existing bigint;
  job_name text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'Enable the pg_cron extension (Database → Extensions) and run this file again';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'Enable the pg_net extension (Database → Extensions) and run this file again';
  end if;

  foreach job_name in array array['meta-ads-hourly', 'meta-ads-today', 'meta-ads-close']
  loop
    select jobid into existing from cron.job where jobname = job_name;
    if existing is not null then
      perform cron.unschedule(existing);
    end if;
  end loop;

  perform cron.schedule(
    'meta-ads-today',
    '2,32 * * * *',
    $cmd$
    select net.http_post(
      url := 'https://jiqhnonfqmcvdmkjbdds.supabase.co/functions/v1/meta-ads-sync',
      body := '{"mode":"today"}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'meta_sync_secret' limit 1)
      ),
      timeout_milliseconds := 120000
    );
    $cmd$
  );

  perform cron.schedule(
    'meta-ads-close',
    '15 0 * * *',
    $cmd$
    select net.http_post(
      url := 'https://jiqhnonfqmcvdmkjbdds.supabase.co/functions/v1/meta-ads-sync',
      body := '{"mode":"close"}'::jsonb,
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
