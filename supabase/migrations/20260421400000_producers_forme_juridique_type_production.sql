-- =============================================================================
-- TerrOir — colonnes forme_juridique et type_production
-- =============================================================================
-- Utilisées par le formulaire d'onboarding producteur multi-étapes (Chantier 2,
-- Phase 3). Toutes nullable pour ne pas casser les producers existants (seeds,
-- producteurs activés avant introduction de ces champs).
--
-- forme_juridique : inclut GAEC/EARL/EI/SCEA pour exploitations agricoles
--                   classiques + SAS/SARL pour les transformateurs
--                   (boulangeries, laiteries, etc. souvent en société
--                   commerciale).
--
-- type_production : valeurs canoniques lowercase sans accents (« maraichage »
--                   pas « maraîchage ») pour éviter tout problème d'encodage.
--                   Inclut arboriculture et apiculture, déjà présents dans les
--                   seeds — pas de sens à les mettre dans « autre ».
--
-- type_production_precision : free text affiché uniquement quand
--                             type_production = 'autre'.
--
-- Idempotent : IF NOT EXISTS sur chaque colonne.
-- =============================================================================

begin;

alter table public.producers
  add column if not exists forme_juridique text
    check (forme_juridique in ('gaec', 'earl', 'ei', 'scea', 'sas', 'sarl', 'autre')),
  add column if not exists type_production text
    check (type_production in ('maraichage', 'elevage', 'laiterie', 'boulangerie', 'vin', 'arboriculture', 'apiculture', 'autre')),
  add column if not exists type_production_precision text;

commit;
