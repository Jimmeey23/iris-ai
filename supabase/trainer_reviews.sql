-- Trainer profile review storage.
-- Stores instructor assessments directly for Trainer Profiles without creating tickets.
-- Safe to re-run.

create table if not exists public.trainer_reviews (
  id text primary key,
  source text not null,
  source_ref text not null unique,
  trainer text not null,
  template text not null,
  studio text,
  class_type text,
  review_period text,
  scores jsonb not null default '[]'::jsonb,
  feedback text,
  focus_points text,
  goals text,
  raw_text text,
  total_weightage numeric not null default 0,
  total_score numeric not null default 0,
  score_percent numeric not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trainer_reviews_trainer_idx
on public.trainer_reviews (trainer, created_at desc);

create index if not exists trainer_reviews_source_ref_idx
on public.trainer_reviews (source_ref);

create or replace function public.set_trainer_reviews_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trainer_reviews_set_updated_at on public.trainer_reviews;
create trigger trainer_reviews_set_updated_at
before update on public.trainer_reviews
for each row execute function public.set_trainer_reviews_updated_at();

alter table public.trainer_reviews enable row level security;

drop policy if exists "Trainer reviews are readable by authenticated users" on public.trainer_reviews;
create policy "Trainer reviews are readable by authenticated users"
on public.trainer_reviews for select
to authenticated
using (true);

drop policy if exists "Admins can manage trainer reviews" on public.trainer_reviews;
create policy "Admins can manage trainer reviews"
on public.trainer_reviews for all
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

notify pgrst, 'reload schema';
