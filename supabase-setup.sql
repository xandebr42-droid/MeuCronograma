-- Meu Cronograma Acadêmico — banco individual por aluno
-- Execute no SQL Editor do Supabase.

create table if not exists public.user_app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_app_state enable row level security;

drop policy if exists "read own academic state" on public.user_app_state;
create policy "read own academic state"
on public.user_app_state
for select
using (auth.uid() = user_id);

drop policy if exists "insert own academic state" on public.user_app_state;
create policy "insert own academic state"
on public.user_app_state
for insert
with check (auth.uid() = user_id);

drop policy if exists "update own academic state" on public.user_app_state;
create policy "update own academic state"
on public.user_app_state
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "delete own academic state" on public.user_app_state;
create policy "delete own academic state"
on public.user_app_state
for delete
using (auth.uid() = user_id);

create or replace function public.set_user_app_state_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_app_state_updated_at on public.user_app_state;
create trigger set_user_app_state_updated_at
before update on public.user_app_state
for each row execute function public.set_user_app_state_updated_at();
