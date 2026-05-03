-- =============================================================================
-- TerrOir — Chantier T-200 : score carbone & bien-être animal
-- =============================================================================
-- Ajoute 3 colonnes catégorielles nullable sur public.producers, alimentées par
-- l'onboarding producteur (StepInfos) et exposées sur la fiche publique via
-- ScoreCarbonBlock / DistanceWidget. Valeurs alignées sur
-- lib/producers/score-carbone-enums.ts (source unique TS + SQL).
--
-- mode_elevage    : conduite d'élevage (plein air → bâtiment fermé).
-- alimentation    : provenance dominante de l'alimentation des animaux.
-- densite_animale : chargement à l'hectare (extensive → intensive).
-- =============================================================================

begin;

alter table public.producers
  add column mode_elevage text
    check (mode_elevage in ('plein_air', 'semi_plein_air', 'batiment_ouvert', 'batiment_ferme')),
  add column alimentation text
    check (alimentation in ('pature_dominante', 'mixte', 'aliments_achetes')),
  add column densite_animale text
    check (densite_animale in ('extensive', 'standard', 'intensive'));

commit;
