-- Private `cvs` bucket for candidate CVs. Idempotent. Safe to re-run.
-- Does not change table RLS. Logged-in users only.

insert into storage.buckets (id, name, public)
values ('cvs', 'cvs', false)
on conflict (id) do nothing;

drop policy if exists "cvs authenticated read" on storage.objects;
drop policy if exists "cvs authenticated write" on storage.objects;
drop policy if exists "cvs authenticated update" on storage.objects;
drop policy if exists "cvs authenticated delete" on storage.objects;
drop policy if exists "cvs_authenticated_select" on storage.objects;
drop policy if exists "cvs_authenticated_insert" on storage.objects;
drop policy if exists "cvs_authenticated_update" on storage.objects;
drop policy if exists "cvs_authenticated_delete" on storage.objects;

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
