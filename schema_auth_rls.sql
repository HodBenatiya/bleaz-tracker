-- Lock CRM tables and files to logged-in users.
-- Idempotent. Run in the Supabase SQL editor AFTER the login code is deployed.
-- Do not run this before that deploy: the live site and webhooks still use the anon key.

-- ── tables ──────────────────────────────────────────────────────────────────

do $$
declare
  tbl text;
  pol record;
begin
  foreach tbl in array array['reports', 'positions', 'pipeline_companies', 'tasks', 'candidates', 'wa_inbox']
  loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on table public.%I from anon', tbl);
    execute format('grant select, insert, update, delete on table public.%I to authenticated, service_role', tbl);
    for pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = tbl
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, tbl);
    end loop;
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      tbl || '_authenticated_all',
      tbl
    );
  end loop;
end $$;

-- ── storage ─────────────────────────────────────────────────────────────────

update storage.buckets set public = false where id in ('wa-media', 'cvs');

insert into storage.buckets (id, name, public)
values ('wa-media', 'wa-media', false)
on conflict (id) do update set public = false;

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

create policy "cvs authenticated read"
  on storage.objects for select to authenticated
  using (bucket_id = 'cvs');

create policy "cvs authenticated write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'cvs');

create policy "cvs authenticated update"
  on storage.objects for update to authenticated
  using (bucket_id = 'cvs');
