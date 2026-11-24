-- ============================================================================
-- CashTrace — Supabase PostgreSQL Schema & Row-Level Security (RLS)
-- Supported Taiwan Dollar (TWD) denominations ONLY: 100, 500, 1000, 2000
-- ============================================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- 1. Banknotes table
create table if not exists public.banknotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  serial_number text not null,
  denomination integer not null check (denomination in (100, 500, 1000, 2000)),
  status text not null default 'HELD' check (status in ('HELD', 'SPENT')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Normalize serial numbers (uppercase, trimmed, no spaces)
  constraint banknotes_serial_nonempty check (char_length(trim(serial_number)) >= 4),
  -- Prevent duplicate serial numbers per user
  constraint banknotes_user_serial_unique unique (user_id, serial_number)
);

-- 2. Indexes for fast search by serial number and status calculation
create index if not exists idx_banknotes_user_status
  on public.banknotes (user_id, status);

create index if not exists idx_banknotes_user_serial
  on public.banknotes (user_id, serial_number);

-- 3. Trigger to auto-normalize serial_number to UPPERCASE and update updated_at
create or replace function public.handle_banknote_before_write()
returns trigger
language plpgsql
as $$
begin
  new.serial_number := upper(regexp_replace(trim(new.serial_number), '\s+', '', 'g'));
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_banknotes_before_write on public.banknotes;
create trigger trg_banknotes_before_write
before insert or update on public.banknotes
for each row
execute function public.handle_banknote_before_write();

-- 4. Enable Row Level Security (RLS)
alter table public.banknotes enable row level security;

-- Users can only view their own banknotes
drop policy if exists "Users can select own banknotes" on public.banknotes;
create policy "Users can select own banknotes"
  on public.banknotes
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Users can only insert their own banknotes
drop policy if exists "Users can insert own banknotes" on public.banknotes;
create policy "Users can insert own banknotes"
  on public.banknotes
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Users can only update their own banknotes (e.g. HELD <-> SPENT)
drop policy if exists "Users can update own banknotes" on public.banknotes;
create policy "Users can update own banknotes"
  on public.banknotes
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Users can only delete their own banknotes
drop policy if exists "Users can delete own banknotes" on public.banknotes;
create policy "Users can delete own banknotes"
  on public.banknotes
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- 5. Enable Realtime replication so mobile and desktop sync instantaneously
alter publication supabase_realtime add table public.banknotes;
