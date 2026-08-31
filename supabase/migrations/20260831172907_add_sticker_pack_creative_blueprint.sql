alter table public.sticker_packs add column if not exists creative_blueprint jsonb not null default '{}'::jsonb;
