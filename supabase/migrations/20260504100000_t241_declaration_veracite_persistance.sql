-- =============================================================================
-- TerrOir — Chantier T-241 : persistance déclaration sur l'honneur producteur
-- =============================================================================
-- Ajoute 3 colonnes à `public.producers` pour archiver l'engagement déclaratif
-- du producteur sur les 3 enums score-carbone (mode_elevage, alimentation,
-- densite_animale). Avant T-241, la case « Je certifie… » de l'onboarding était
-- validée Zod mais non persistée — pas de trace datée en cas de contrôle DGCCRF.
--
-- declaration_indicateurs_veracite_at      : horodatage de la coche/re-coche.
-- declaration_indicateurs_snapshot         : JSON figé des 3 valeurs déclarées
--                                            au moment de la coche (preuve de
--                                            ce sur quoi le producteur s'est
--                                            engagé, indépendamment des
--                                            modifications ultérieures).
-- declaration_indicateurs_wording_version  : version du libellé certifié
--                                            (cf. lib/producers/declaration-
--                                            veracite.ts — DECLARATION_VERACITE
--                                            _WORDING_VERSION = "v1.0").
--
-- Toutes nullable : producteurs existants restent NULL (pas de backfill — la
-- prod n'est pas ouverte). Les nouvelles écritures sont gérées par la server
-- action complete-onboarding via le helper computeDeclarationVeraciteUpdate().
-- =============================================================================

alter table public.producers
  add column declaration_indicateurs_veracite_at timestamptz null,
  add column declaration_indicateurs_snapshot jsonb null,
  add column declaration_indicateurs_wording_version text null;
