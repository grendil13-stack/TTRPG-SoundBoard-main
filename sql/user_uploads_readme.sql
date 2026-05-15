-- Reference shapes expected by src/app.js for user uploads.
-- Adjust column names in the app if your schema differs.

-- Table user_audio (private uploads metadata)
-- Suggested columns:
--   id uuid primary key default gen_random_uuid(),
--   user_id uuid not null references auth.users(id) on delete cascade,
--   title text not null,
--   filename text not null,
--   storage_path text not null,  -- path within bucket user-uploads, e.g. uuid/music/123_file.mp3
--   file_size_bytes bigint not null,
--   audio_type text not null check (audio_type in ('music','ambient','sfx')),
--   mood_tags jsonb default '[]'::jsonb,
--   created_at timestamptz default now()

-- View user_storage_summary
-- The app reads one row per user and uses the first numeric field found among:
--   used_bytes, used_bytes_total, total_bytes, bytes_used, sum_file_size
-- Example:
--   create or replace view user_storage_summary as
--   select user_id, coalesce(sum(file_size_bytes),0)::bigint as used_bytes
--   from user_audio
--   group by user_id;

-- Storage bucket: user-uploads (private)
-- Path pattern: {user_id}/{audio_type}/{unique_filename}
