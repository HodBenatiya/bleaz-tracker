-- תיבת וואטסאפ. הודעות של מועמד נשמרות בתוך candidates.data.waMessages.
-- כאן נשמרים רק לידים שעדיין לא שויכו, וסטטוס הסשן (wa_session).
-- הריצו ב-Supabase SQL Editor. אין כאן נתוני מועמדים.

create table if not exists wa_inbox (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz default now()
);

alter table wa_inbox disable row level security;

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
