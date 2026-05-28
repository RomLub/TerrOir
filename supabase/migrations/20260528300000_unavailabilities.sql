-- =============================================================================
-- TerrOir — Indisponibilités producteur (option B)
-- =============================================================================
-- Chantier 2026-05-28 : remplacement du concept legacy « Poser des vacances »
-- (qui posait `slots.excluded_at` sur les instances slot existantes — réactif,
-- pas proactif) par une entité dédiée `unavailabilities` indépendante des
-- créneaux.
--
-- Source de vérité : un (producer_id, date) dans unavailabilities = jour
-- systématiquement fermé, indépendant des slot_rules existantes ET futures.
-- excluded_at reste un artefact bas niveau, posé/retiré automatiquement par
-- les server actions du flow unavailabilities (cf. lib/unavailabilities/*).
--
-- Défense en profondeur :
--   * Génération (lib/slots/generate.ts) : skip les jours indisponibles à la
--     matérialisation des slots.
--   * Réservation (RPC create_order_with_items) : refuse l'order si le slot
--     tombe sur un jour indisponible (cf. migration suivante).
--
-- Scope colonnes (column-grants) :
--   * id, producer_id, date : lecture publique (anon + authenticated) → le
--     calendrier consumer doit savoir qu'une date est fermée.
--   * raison, created_at, created_by, updated_at : owner-only strict — peut
--     contenir du perso ("rdv médical"). Lecture via RLS owner ou
--     service_role admin uniquement, jamais via anon/authenticated.
--
-- Idempotent (forward-only). Dormant en PR #1 : aucune ligne tant que l'UI
-- (PR #2) ne pose pas d'indisponibilité.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Table unavailabilities
-- -----------------------------------------------------------------------------
create table if not exists public.unavailabilities (
  id          uuid primary key default gen_random_uuid(),
  producer_id uuid not null references public.producers(id) on delete cascade,
  date        date not null,
  raison      text,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  constraint unavailabilities_producer_date_unique unique (producer_id, date),
  constraint unavailabilities_raison_max_280
    check (raison is null or char_length(raison) <= 280)
);

-- Index lookup rapide pour la garde génération (fetch des indispos sur
-- horizon) et pour les server actions (group par producer_id + date).
create index if not exists unavailabilities_producer_date_idx
  on public.unavailabilities (producer_id, date);

-- -----------------------------------------------------------------------------
-- 2. Trigger updated_at (fonction dédiée, pas de helper global dans le repo)
-- -----------------------------------------------------------------------------
create or replace function public.unavailabilities_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists unavailabilities_set_updated_at on public.unavailabilities;
create trigger unavailabilities_set_updated_at
  before update on public.unavailabilities
  for each row execute function public.unavailabilities_set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. RLS
-- -----------------------------------------------------------------------------
alter table public.unavailabilities enable row level security;

-- Owner all : le producteur gère ses indispos (CRUD complet via service_role
-- côté server action, mais aussi via PostgREST direct si jamais consommé).
drop policy if exists "unavailabilities owner all" on public.unavailabilities;
create policy "unavailabilities owner all"
  on public.unavailabilities for all
  using (public.owns_producer(producer_id))
  with check (public.owns_producer(producer_id));

-- Admin all : helper is_admin() (cf. initial_schema).
drop policy if exists "unavailabilities admin all" on public.unavailabilities;
create policy "unavailabilities admin all"
  on public.unavailabilities for all
  using (public.is_admin())
  with check (public.is_admin());

-- Lecture publique : anon + authenticated peuvent SELECT les indispos des
-- producteurs en statut 'public'. Requis pour que le calendrier consumer
-- affiche les dates fermées. Les GRANTs column-level (point 4) limitent les
-- colonnes effectivement lisibles à (id, producer_id, date) — raison reste
-- muette même pour cette policy.
drop policy if exists "unavailabilities public read when producer public"
  on public.unavailabilities;
create policy "unavailabilities public read when producer public"
  on public.unavailabilities for select
  using (
    exists (
      select 1 from public.producers p
      where p.id = unavailabilities.producer_id and p.statut = 'public'
    )
  );

-- -----------------------------------------------------------------------------
-- 4. Grants column-level (pattern liste blanche, identique à producers)
-- -----------------------------------------------------------------------------
-- IMPORTANT : Supabase applique des default privileges au schema public qui
-- donnent SELECT/INSERT/UPDATE/DELETE table-level à anon/authenticated sur
-- TOUTE nouvelle table (cf. pg_default_acl). Pour activer le pattern liste
-- blanche, il faut explicitement REVOKE le SELECT table-level puis GRANT
-- SELECT colonne par colonne (cf. migration 20260507A00000 sur producers).
-- INSERT/UPDATE/DELETE restent disponibles, filtrés par RLS owner.
--
-- Résultat : raison + created_at + created_by + updated_at restent muets
-- pour anon/authenticated → owner-only via RLS owner, ou admin via
-- service_role.
revoke select on public.unavailabilities from anon;
revoke select on public.unavailabilities from authenticated;
grant select (id, producer_id, date) on public.unavailabilities to anon, authenticated;

commit;
