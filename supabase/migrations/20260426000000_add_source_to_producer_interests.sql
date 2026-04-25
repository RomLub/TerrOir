-- =============================================================================
-- TerrOir — producer_interests : colonne source pour tracer l'origine du lead
-- =============================================================================
-- Contexte (chantier "Vision funnel producteur", scope 2026-04-24, Phase 1) :
-- l'admin doit pouvoir distinguer les leads venus du formulaire public
-- /devenir-producteur (auto-prospection consumer) des leads créés à partir
-- d'une invitation directe par l'admin (cas où l'admin connaît déjà le
-- producer hors-plateforme et envoie l'invitation sans passage par le
-- formulaire). Cette traçabilité permet d'analyser le funnel d'acquisition
-- et de différencier l'UX des relances.
--
-- Backfill implicite via DEFAULT 'formulaire_public' : tous les leads
-- existants viennent du formulaire public (la table n'avait que ce point
-- d'entrée jusqu'ici). Les nouveaux leads créés par
-- app/api/admin/producers/invite/route.tsx (commit suivant du même chantier)
-- passeront source='invitation_directe' explicitement.
--
-- Idempotence : `add column if not exists` permet de relancer la migration
-- sans erreur si elle a déjà été appliquée (ex : rollback partiel).
-- =============================================================================

begin;

alter table public.producer_interests
  add column if not exists source text not null
    default 'formulaire_public'
    check (source in ('formulaire_public', 'invitation_directe'));

commit;
