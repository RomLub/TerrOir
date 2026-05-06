-- =============================================================================
-- TerrOir — T-292 : CHECK constraint declaration_indicateurs_wording_version
-- =============================================================================
-- Defense-in-depth côté DB pour la valeur stockée par T-241 (cf.
-- migration 20260504100000_t241_declaration_veracite_persistance.sql et
-- lib/producers/declaration-veracite.ts).
--
-- Sans contrainte DB, la valeur `declaration_indicateurs_wording_version` repose
-- sur la sécurité applicative de la constante DECLARATION_VERACITE_WORDING_VERSION
-- côté code (`lib/producers/declaration-veracite.ts`). Si un dev tape une typo en
-- bumpant la version (`v1.1` → `v.1.1`, `v11`, `1.1` sans préfixe `v`, etc.), la
-- valeur fautive arrive en prod sans signal jusqu'à la prochaine extraction
-- DGCCRF qui découvrirait l'incohérence.
--
-- La contrainte CHECK ci-dessous bloque toute valeur hors whitelist au niveau
-- DB. Whitelist initiale = wordings effectivement archivés dans la map
-- DECLARATION_VERACITE_WORDINGS :
--   - 'v1.0' : valeur courante en place (DECLARATION_VERACITE_WORDING_VERSION).
--   - 'v1.1' : placeholder déjà préparé pour le bump futur (cf. T-293 runbook
--             bump v1.0 → v1.1, T-282 procédure gouvernance wording).
--
-- Le NULL reste autorisé : producteurs pré-T-241 (jamais de coche archivée)
-- et producteurs qui ont vidé leurs 3 enums score-carbone sans avoir coché à
-- la base — sémantique « pas de déclaration à ce jour » légitime.
--
-- Procédure de bump v1.X → v1.(X+1) (cohérente T-282) :
--   1. Ajouter la nouvelle entrée dans DECLARATION_VERACITE_WORDINGS (code).
--   2. Bumper DECLARATION_VERACITE_WORDING_VERSION (code).
--   3. Livrer une nouvelle migration T-XXX qui DROP+ADD cette constraint avec
--      la liste étendue (DROP IF EXISTS + ADD est conforme T-297 idempotence).
--   4. Apply prod, smoke test, déploiement code.
-- Ne PAS retirer une ancienne valeur de la whitelist : les producteurs déjà
-- certifiés en `v1.0` doivent pouvoir réécrire la même valeur si la RPC
-- update_producer_onboarding ré-évalue snapshot identique → no-op transactionnel.
--
-- Pattern idempotent (cf. T-297 convention) : DROP CONSTRAINT IF EXISTS avant
-- ADD CONSTRAINT pour permettre rejeu (staging reset, hot-fix, etc.).
-- =============================================================================

alter table public.producers
  drop constraint if exists declaration_indicateurs_wording_version_check;

alter table public.producers
  add constraint declaration_indicateurs_wording_version_check
  check (
    declaration_indicateurs_wording_version is null
    or declaration_indicateurs_wording_version in ('v1.0', 'v1.1')
  );

comment on constraint declaration_indicateurs_wording_version_check
  on public.producers is
  'T-292 : whitelist des versions de wording certifié (DECLARATION_VERACITE_WORDINGS). '
  'Bump v1.X → v1.(X+1) : nouvelle migration T-XXX qui DROP+ADD avec liste étendue. '
  'Ne PAS retirer une ancienne valeur (les producteurs certifiés sur cette version '
  'doivent rester réécrivables en no-op transactionnel). Cf. docs/conventions/'
  'wording-veracite-governance-2026-05-06.md (T-282).';
