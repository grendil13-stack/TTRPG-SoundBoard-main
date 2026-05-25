-- Run in Supabase SQL editor: records when a user accepted Terms of Service at signup.
alter table public.profiles
  add column if not exists tos_agreed_at timestamptz;

comment on column public.profiles.tos_agreed_at is
  'UTC timestamp when the user agreed to Terms of Service and Privacy Policy at account creation.';
