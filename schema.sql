-- ═══════════════════════════════════════════════
-- BLEAZ Tracker — Supabase Schema
-- הרץ את הקוד הזה ב-Supabase SQL Editor
-- ═══════════════════════════════════════════════

-- 1. טבלת דיווחים יומיים
create table if not exists reports (
  id         text primary key,
  date       text not null,
  data       jsonb not null,
  updated_at timestamptz default now()
);

-- 2. טבלת משרות שמורות
create table if not exists positions (
  id   text primary key,
  data jsonb not null
);

-- 3. טבלת פייפליין לקוחות
create table if not exists pipeline_companies (
  id   text primary key,
  data jsonb not null
);

-- 4. טבלת משימות
create table if not exists tasks (
  id   text primary key,
  data jsonb not null
);

-- ═══════════════════════════════════════════════
-- ביטול RLS (הכלי פנימי — לא צריך אבטחה מורכבת)
-- ═══════════════════════════════════════════════
alter table reports          disable row level security;
alter table positions        disable row level security;
alter table pipeline_companies disable row level security;
alter table tasks            disable row level security;

-- ═══════════════════════════════════════════════
-- הפעלת Realtime (סנכרון בזמן אמת בין הוד לצחי)
-- ═══════════════════════════════════════════════
alter publication supabase_realtime add table reports;
alter publication supabase_realtime add table positions;
alter publication supabase_realtime add table pipeline_companies;
alter publication supabase_realtime add table tasks;
