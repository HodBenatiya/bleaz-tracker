-- תיבת וואטסאפ. הודעות של מועמד נשמרות בתוך candidates.data.waMessages.
-- כאן נשמרים רק לידים שעדיין לא שויכו, וסטטוס הסשן (wa_session).
-- הריצו ב-Supabase SQL Editor. אין כאן נתוני מועמדים.

create table if not exists wa_inbox (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz default now()
);

-- The anon key can already SELECT. INSERT still fails with
-- 42501 "new row violates row-level security policy" while RLS is enabled
-- and there is no policy. Re-run this whole file on the live project.
grant select, insert, update, delete on table public.wa_inbox to anon, authenticated, service_role;

alter table public.wa_inbox disable row level security;

drop policy if exists wa_inbox_internal_all on public.wa_inbox;
create policy wa_inbox_internal_all
  on public.wa_inbox
  for all
  to anon, authenticated
  using (true)
  with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'wa_inbox'
  ) then
    alter publication supabase_realtime add table wa_inbox;
  end if;
end $$;
