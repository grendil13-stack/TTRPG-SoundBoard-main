-- Run in Supabase SQL editor (or migration) before relying on scene SFX pins.
alter table public.scenes
add column if not exists pinned_sfx jsonb default '[]'::jsonb;
