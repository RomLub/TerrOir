-- =============================================================================
-- TerrOir — Plafond de capacité des créneaux (max 2 places / 15 min)
-- =============================================================================
-- Décision Romain 2026-05-28 : `capacity_per_slot <= ceil(durée_min / 15) * 2`
-- en garde dure SQL sur slot_rules + slots. Valeur point de départ, sera
-- réajustée avec données terrain. Miroir applicatif :
-- lib/slots/capacity-limit.ts (helper + Zod refine).
--
-- ⚠️ BREAKING — applicable APRÈS merge du code applicatif qui valide cette
-- contrainte au niveau Zod + server actions (cf. CLAUDE.md §8). Le clamp
-- des données existantes + le CHECK doivent vivre dans la même transaction
-- pour qu'aucune ligne ne soit en violation au moment où le CHECK s'active.
--
-- Audit pré-migration (2026-05-28) : 5 configs en violation, toutes sur
-- producteurs factices, ZÉRO commande active (pending/confirmed/ready/
-- completed) impactée. Liste vérifiée via MCP :
--   - slot_rules rdv 30min cap=10 → 4  (Les Vergers de l'Huisne, x2 rules)
--   - slot_rules rdv 30min cap=10 → 4  (Ferme du Perche Sarthois)
--   - slot_rules rdv 30min cap=8  → 4  (Maraîchage des Alpes Mancelles)
--   - slot_rules rdv 30min cap=5  → 4  (Les Vergers de l'Huisne)
--   - slot adhoc libre 60min cap=15 → 8 (La Ferme des Fourchettes)
--
-- Séquence imposée :
--   1. UPDATE clamp slot_rules mode='rdv' (durée = slot_duration_minutes)
--   2. UPDATE clamp slot_rules mode='libre' (durée = end_time - start_time)
--   3. UPDATE clamp slots (durée = ends_at - starts_at, couvre matérialisés
--      ET ad-hoc)
--   4. Sanity check : aucune ligne ne doit violer le CHECK après clamp
--   5. ADD CHECK slot_rules (mode='rdv' uniquement — pour 'libre', le CHECK
--      sur slots couvre l'invariant via les slots matérialisés)
--   6. ADD CHECK slots (couvre rdv ET libre via durée timestamptz)
-- =============================================================================

begin;

-- 1. Clamp slot_rules mode 'rdv' (durée = slot_duration_minutes)
update public.slot_rules
set capacity_per_slot = (ceil(slot_duration_minutes::numeric / 15) * 2)::smallint
where mode = 'rdv'
  and capacity_per_slot > ceil(slot_duration_minutes::numeric / 15) * 2;

-- 2. Clamp slot_rules mode 'libre' (durée = amplitude en minutes)
update public.slot_rules
set capacity_per_slot = (
  ceil(
    (extract(epoch from (end_time - start_time)) / 60.0) / 15.0
  ) * 2
)::smallint
where mode = 'libre'
  and capacity_per_slot > ceil(
    (extract(epoch from (end_time - start_time)) / 60.0) / 15.0
  ) * 2;

-- 3. Clamp slots (durée dérivée des timestamps, couvre matérialisés + ad-hoc)
update public.slots
set capacity_per_slot = (
  ceil(extract(epoch from (ends_at - starts_at)) / 900.0) * 2
)::smallint
where capacity_per_slot > ceil(extract(epoch from (ends_at - starts_at)) / 900.0) * 2;

-- 4. Sanity check transactionnel : aucune ligne ne doit violer le CHECK après clamp
do $$
declare
  v_rule_rdv_violations int;
  v_rule_libre_violations int;
  v_slot_violations int;
begin
  select count(*) into v_rule_rdv_violations
  from public.slot_rules
  where mode = 'rdv'
    and capacity_per_slot > ceil(slot_duration_minutes::numeric / 15) * 2;
  if v_rule_rdv_violations > 0 then
    raise exception 'slot_rules rdv encore en violation après clamp: %', v_rule_rdv_violations;
  end if;

  select count(*) into v_rule_libre_violations
  from public.slot_rules
  where mode = 'libre'
    and capacity_per_slot > ceil(
      (extract(epoch from (end_time - start_time)) / 60.0) / 15.0
    ) * 2;
  if v_rule_libre_violations > 0 then
    raise exception 'slot_rules libre encore en violation après clamp: %', v_rule_libre_violations;
  end if;

  select count(*) into v_slot_violations
  from public.slots
  where capacity_per_slot > ceil(extract(epoch from (ends_at - starts_at)) / 900.0) * 2;
  if v_slot_violations > 0 then
    raise exception 'slots encore en violation après clamp: %', v_slot_violations;
  end if;
end $$;

-- 5. ADD CHECK slot_rules (mode='rdv' uniquement — voir doc en tête)
alter table public.slot_rules
  drop constraint if exists slot_rules_capacity_max_check;
alter table public.slot_rules
  add constraint slot_rules_capacity_max_check
  check (
    mode <> 'rdv'
    or capacity_per_slot <= ceil(slot_duration_minutes::numeric / 15) * 2
  );

-- 6. ADD CHECK slots (couvre rdv ET libre via durée timestamptz : 900 sec =
--    15 min, expression immutable car interval - interval est déterministe)
alter table public.slots
  drop constraint if exists slots_capacity_max_check;
alter table public.slots
  add constraint slots_capacity_max_check
  check (
    capacity_per_slot <= ceil(extract(epoch from (ends_at - starts_at)) / 900.0) * 2
  );

commit;
