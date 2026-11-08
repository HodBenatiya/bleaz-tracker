-- Private bucket for WhatsApp media. Run in the Supabase SQL editor.
-- The API prefers SUPABASE_SERVICE_ROLE_KEY. Without it, these policies
-- let the anon key upload and sign URLs. The browser still loads files
-- only through /api/wa-media, never with the WAHA key.

insert into storage.buckets (id, name, public)
values ('wa-media', 'wa-media', false)
on conflict (id) do update set public = false;

drop policy if exists "wa media anon upload" on storage.objects;
create policy "wa media anon upload"
  on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'wa-media');

drop policy if exists "wa media anon update" on storage.objects;
create policy "wa media anon update"
  on storage.objects for update to anon, authenticated
  using (bucket_id = 'wa-media');

drop policy if exists "wa media anon read" on storage.objects;
create policy "wa media anon read"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'wa-media');
