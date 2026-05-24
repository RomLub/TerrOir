-- ADR-0012 — Refonte créneaux : deux modes d'ouverture.
--
-- Additive / dormante : ajoute une colonne `mode` sur slot_rules pour persister
-- le choix du producteur entre :
--   'libre' = un seul créneau couvrant toute la plage (slot_duration_minutes =
--             amplitude horaire ⇒ generate.ts produit 1 slot/jour),
--             capacity_per_slot = nb de clients max sur la plage.
--   'rdv'   = découpage en tranches de slot_duration_minutes (comportement
--             historique), capacity_per_slot = nb de clients par tranche.
--
-- Défaut 'rdv' : les règles existantes gardent un rendu strictement identique.
-- La source de vérité du mode est cette colonne (pas une déduction
-- durée==amplitude, ambiguë au cas-limite). Cf. ADR-0012.

alter table public.slot_rules
  add column if not exists mode text not null default 'rdv';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'slot_rules_mode_valid'
  ) then
    alter table public.slot_rules
      add constraint slot_rules_mode_valid check (mode in ('libre', 'rdv'));
  end if;
end $$;
