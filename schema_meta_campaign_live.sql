-- Whether a campaign is delivering right now.
-- Additive. Nullable, so older rows stay "unknown" until the next hourly sync.
-- Does not rewrite spend rows and does not touch schema.sql / schema_v2.sql / schema_wa.sql.
-- Safe to run more than once. The existing meta_campaigns read policy covers the new columns.

alter table public.meta_campaigns
  add column if not exists delivering boolean,
  add column if not exists active_ads integer,
  add column if not exists active_adsets integer;

comment on column public.meta_campaigns.delivering is
  'True when at least one ad is effectively ACTIVE. False when the sync checked and none are. Null until that check has run.';

comment on column public.meta_campaigns.active_ads is
  'How many ads on this campaign were effectively ACTIVE at the last sync.';

comment on column public.meta_campaigns.active_adsets is
  'How many ad sets on this campaign were effectively ACTIVE at the last sync.';
