-- =============================================================================
-- TerrOir — Refonte créneaux : slot_rules + slots matérialisés
-- =============================================================================
-- Phase 1 du chantier "Créneaux personnalisables" (décision produit 2026-04-22).
--
-- Avant : public.slots = plages hebdomadaires récurrentes manuelles
--   (jour_semaine, heure_debut, heure_fin) — un objet DB par plage, pas de
--   capacité ni de durée de créneau.
--
-- Après :
--   * public.slot_rules = règles génératrices. Le producteur configure
--     days_of_week, amplitude start/end, slot_duration_minutes,
--     capacity_per_slot, periodicity_weeks.
--   * public.slots = instances matérialisées générées depuis les rules
--     (rule_id, starts_at, ends_at, capacity_per_slot).
--
-- orders.slot_id reste valide : slots.id uuid pk inchangé. Les orders
-- existantes gardent leur snapshot date_retrait/heure_retrait (dénormalisé
-- depuis l'initial schema), donc survivent même si des slots historiques
-- sont supprimés par cascade rule_id on delete.
--
-- Pré-requis pour apply : public.slots doit être vide (truncate manuel en
-- prod/pré-prod — pas de data migration). Les `alter column set not null`
-- sur les nouvelles colonnes échoueraient sinon.
--
-- Le renommage slots.actif → slots.active est DIFFÉRÉ à la Phase 6 : la RPC
-- create_order_with_items référence `actif = true` (cf migration 20260419
-- 040000 + 20260422000000), renommer maintenant casserait la RPC entre
-- phases. Phase 6 bundle le rename + la réécriture RPC (ajout check capacity).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. public.slot_rules
-- -----------------------------------------------------------------------------
create table if not exists public.slot_rules (
  id                    uuid primary key default gen_random_uuid(),
  producer_id           uuid not null references public.producers(id) on delete cascade,
  days_of_week          smallint[] not null,
  periodicity_weeks     smallint not null default 1,
  start_time            time not null,
  end_time              time not null,
  slot_duration_minutes smallint not null,
  capacity_per_slot     smallint not null,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Contraintes nommées (Postgres ne supporte pas `add constraint if not exists`).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'slot_rules_days_of_week_range') then
    alter table public.slot_rules
      add constraint slot_rules_days_of_week_range
      check (
        array_length(days_of_week, 1) >= 1
        and days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'slot_rules_periodicity_weeks_min') then
    alter table public.slot_rules
      add constraint slot_rules_periodicity_weeks_min
      check (periodicity_weeks >= 1);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'slot_rules_time_window') then
    alter table public.slot_rules
      add constraint slot_rules_time_window
      check (end_time > start_time);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'slot_rules_duration_min') then
    alter table public.slot_rules
      add constraint slot_rules_duration_min
      check (slot_duration_minutes >= 5);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'slot_rules_capacity_min') then
    alter table public.slot_rules
      add constraint slot_rules_capacity_min
      check (capacity_per_slot >= 1);
  end if;
end
$$;

create index if not exists slot_rules_producer_id_idx
  on public.slot_rules (producer_id);

-- Trigger updated_at. Pas de helper global existant → fonction locale dédiée.
create or replace function public.slot_rules_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists slot_rules_set_updated_at on public.slot_rules;
create trigger slot_rules_set_updated_at
  before update on public.slot_rules
  for each row execute function public.slot_rules_set_updated_at();

alter table public.slot_rules enable row level security;

-- RLS slot_rules ---------------------------------------------------------------
-- Lecture publique gatée sur producers.statut = 'public' (aligne sur la
-- policy actuelle de slots, cf migration 20260422000000).
drop policy if exists "slot_rules public read when producer public" on public.slot_rules;
create policy "slot_rules public read when producer public"
  on public.slot_rules for select
  using (
    exists (
      select 1 from public.producers p
      where p.id = slot_rules.producer_id and p.statut = 'public'
    )
  );

-- Owner CRUD via owns_producer (aligne sur slots/products).
drop policy if exists "slot_rules owner all" on public.slot_rules;
create policy "slot_rules owner all"
  on public.slot_rules for all
  using (public.owns_producer(producer_id))
  with check (public.owns_producer(producer_id));

-- Admin all (pattern is_admin() de migration 20260421500000).
drop policy if exists "slot_rules admin all" on public.slot_rules;
create policy "slot_rules admin all"
  on public.slot_rules for all
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- 2. public.slots — refonte : plages hebdo → instances matérialisées
-- -----------------------------------------------------------------------------
-- Pré-requis : table vide avant apply (truncate manuel). Les alter column set
-- not null échoueraient sur une DB avec slots legacy.

-- Drop des anciennes colonnes (plages hebdo). Les check constraints associés
-- (jour_semaine between 0 and 6) sont auto-droppés par cascade de drop column.
alter table public.slots drop column if exists jour_semaine;
alter table public.slots drop column if exists heure_debut;
alter table public.slots drop column if exists heure_fin;

-- Ajout des nouvelles colonnes (nullable d'abord pour idempotence sur re-run).
alter table public.slots
  add column if not exists rule_id uuid
    references public.slot_rules(id) on delete cascade;

alter table public.slots
  add column if not exists starts_at timestamptz;

alter table public.slots
  add column if not exists ends_at timestamptz;

alter table public.slots
  add column if not exists capacity_per_slot smallint;

alter table public.slots
  add column if not exists created_at timestamptz not null default now();

-- Promotion en not null. Safe car table vide (cf pré-requis).
alter table public.slots alter column rule_id set not null;
alter table public.slots alter column starts_at set not null;
alter table public.slots alter column ends_at set not null;
alter table public.slots alter column capacity_per_slot set not null;

-- Contraintes nommées.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'slots_time_window') then
    alter table public.slots
      add constraint slots_time_window
      check (ends_at > starts_at);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'slots_capacity_min') then
    alter table public.slots
      add constraint slots_capacity_min
      check (capacity_per_slot >= 1);
  end if;

  -- Unicité (producer_id, starts_at) : empêche la matérialisation de doublons
  -- quand deux rules d'un même producer couvrent le même instant.
  if not exists (select 1 from pg_constraint where conname = 'slots_producer_starts_at_unique') then
    alter table public.slots
      add constraint slots_producer_starts_at_unique
      unique (producer_id, starts_at);
  end if;
end
$$;

-- Index : remplace producer_id-only par (producer_id, starts_at) (lookup
-- consumer par fenêtre de date) + rule_id dédié (régénération).
drop index if exists public.slots_producer_id_idx;

create index if not exists slots_producer_starts_at_idx
  on public.slots (producer_id, starts_at);

create index if not exists slots_rule_id_idx
  on public.slots (rule_id);

-- slots.actif : conservé tel quel (renommage → active différé Phase 6 avec
-- la réécriture de create_order_with_items).

-- Les policies existantes sur slots ("slots public read when producer public"
-- + "slots owner all") n'utilisent que producer_id → aucune adaptation
-- nécessaire. La FK orders.slot_id reste valide (slots.id inchangé).

commit;
