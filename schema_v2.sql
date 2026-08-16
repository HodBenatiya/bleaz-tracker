-- הרץ את זה ב-Supabase SQL Editor
-- מוסיף טבלת מועמדים למערכת

create table if not exists candidates (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz default now()
);

alter table candidates disable row level security;

alter publication supabase_realtime add table candidates;
