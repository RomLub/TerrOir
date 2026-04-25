-- =============================================================================
-- TerrOir — producer_interests : colonne prenom (split nom complet)
-- =============================================================================
-- Contexte (chantier "Vision funnel producteur", scope 2026-04-26, Phase 2) :
-- le formulaire public /devenir-producteur passe d'un seul champ "Nom et prénom"
-- combiné à deux champs séparés (prénom + nom). Cette séparation permet :
--   1) de personnaliser proprement les communications (Bonjour <prenom>),
--   2) de pré-remplir l'étape "infos producteur" du wizard onboarding sans
--      heuristique de split, en sourçant directement depuis le lead matching
--      l'email du producteur invité.
--
-- Pas de backfill : un split heuristique sur "nom" combiné est trop fragile
-- (ex: "de la Tour", "Marie-Claire Dupont"). Les anciens leads gardent
-- prenom = NULL et l'admin LeadsTable affiche `"${prenom ?? ''} ${nom}".trim()`.
-- Les nouveaux leads (formulaire public + invitation_directe) auront prenom
-- rempli quand l'info est disponible.
--
-- Idempotence : `add column if not exists` permet de relancer sans erreur.
-- =============================================================================

begin;

alter table public.producer_interests
  add column if not exists prenom text;

commit;
