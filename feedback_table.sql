-- Run this in the Supabase SQL editor (Dashboard → SQL).
-- Enables anonymous + signed-in inserts for the in-app Feedback modal.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  message text not null,
  email text,
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  page_url text
);

create index if not exists feedback_created_at_idx on public.feedback (created_at desc);

alter table public.feedback enable row level security;

drop policy if exists "feedback_insert_anon_or_auth" on public.feedback;
create policy "feedback_insert_anon_or_auth"
  on public.feedback
  for insert
  to anon, authenticated
  with check (true);
