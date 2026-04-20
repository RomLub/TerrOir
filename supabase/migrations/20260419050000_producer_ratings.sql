-- =============================================================================
-- TerrOir — cache des notes producteurs
-- =============================================================================
-- Ces colonnes sont tenues à jour par l'API /api/admin/reviews/[id]/moderate
-- à chaque publication/rejet d'avis, pour éviter un recalcul agrégé à
-- l'affichage (page producteur, résultats search).
-- =============================================================================

alter table public.producers
  add column note_moyenne double precision not null default 0,
  add column nb_avis      int              not null default 0;
