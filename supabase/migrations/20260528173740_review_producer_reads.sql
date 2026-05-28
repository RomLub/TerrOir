-- =============================================================================
-- TerrOir - Etat de lecture producteur pour les avis
-- =============================================================================
-- Objectif : distinguer "a repondre" de "non lu" dans l'espace producteur.
--
-- La date de lecture n'est PAS ajoutee directement a public.reviews : les
-- avis publies sont lisibles publiquement via RLS, alors que l'etat de lecture
-- du producteur est une information privee. Table separee = zero fuite publique.
--
-- Forward-only / idempotent : CREATE TABLE IF NOT EXISTS, trigger/policies
-- recrees proprement.
-- =============================================================================

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reviews_id_producer_id_key'
      and conrelid = 'public.reviews'::regclass
  ) then
    alter table public.reviews
      add constraint reviews_id_producer_id_key unique (id, producer_id);
  end if;
end $$;

create table if not exists public.review_producer_reads (
  review_id uuid primary key references public.reviews(id) on delete cascade,
  producer_id uuid not null references public.producers(id) on delete cascade,
  read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists review_producer_reads_producer_id_idx
  on public.review_producer_reads (producer_id, read_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'review_producer_reads_review_producer_fkey'
      and conrelid = 'public.review_producer_reads'::regclass
  ) then
    alter table public.review_producer_reads
      add constraint review_producer_reads_review_producer_fkey
      foreign key (review_id, producer_id)
      references public.reviews(id, producer_id)
      on delete cascade;
  end if;
end $$;

comment on table public.review_producer_reads is
  'Etat de lecture prive cote producteur pour les avis. Une row signifie que le producteur a ouvert la conversation au moins une fois.';

comment on column public.review_producer_reads.read_at is
  'Derniere ouverture de la conversation avis par le producteur. Sert au badge non lu dans l espace producteur.';

drop trigger if exists review_producer_reads_set_updated_at
  on public.review_producer_reads;

create trigger review_producer_reads_set_updated_at
  before update on public.review_producer_reads
  for each row
  execute function public.set_updated_at();

alter table public.review_producer_reads enable row level security;

revoke all on public.review_producer_reads from anon;
revoke all on public.review_producer_reads from authenticated;
grant select, insert, update on public.review_producer_reads to authenticated;
grant all on public.review_producer_reads to service_role;

drop policy if exists "review_producer_reads producer read own"
  on public.review_producer_reads;

create policy "review_producer_reads producer read own"
  on public.review_producer_reads
  for select
  to authenticated
  using (public.owns_producer(producer_id));

drop policy if exists "review_producer_reads producer insert own"
  on public.review_producer_reads;

create policy "review_producer_reads producer insert own"
  on public.review_producer_reads
  for insert
  to authenticated
  with check (public.owns_producer(producer_id));

drop policy if exists "review_producer_reads producer update own"
  on public.review_producer_reads;

create policy "review_producer_reads producer update own"
  on public.review_producer_reads
  for update
  to authenticated
  using (public.owns_producer(producer_id))
  with check (public.owns_producer(producer_id));
