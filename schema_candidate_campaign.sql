-- Link a candidate to the Meta campaign they came from.
-- Additive only. Nullable columns. Does not rewrite the data jsonb and does not
-- touch schema.sql, schema_v2.sql, or schema_wa.sql.
--
-- candidates already has row level security for signed-in users only
-- (schema_auth_rls.sql). These columns sit on that table, so the same policy
-- covers them. Nothing is granted to anon.
--
-- The CRM also stores metaAccountId and metaCampaignId inside data.
-- The columns are a copy, filled the next time someone saves the candidate.
-- Safe to run more than once.

alter table public.candidates
  add column if not exists meta_account_id text,
  add column if not exists meta_campaign_id text;

comment on column public.candidates.meta_account_id is
  'Meta ad account (act_…) when מקור הגעה is a campaign. Null for organic or older rows.';

comment on column public.candidates.meta_campaign_id is
  'Meta campaign id when מקור הגעה is a campaign. Null for organic or older rows.';

create index if not exists candidates_meta_campaign_idx
  on public.candidates (meta_account_id, meta_campaign_id);
