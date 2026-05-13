-- =============================================================================
-- PR3 admin invitations — ajout colonne revoked_at (admin peut révoquer)
-- =============================================================================
-- Contexte AUDIT_ADMIN § 6 P1 #6 : pas de listing admin des invitations
-- sortantes ni d'action revoke explicite. La table n'a pas de colonne
-- `status` (états computed via used_at + expires_at). Pour différencier
-- "expirée naturellement" et "révoquée explicitement par admin", on ajoute
-- une colonne dédiée + un CHECK constraint qui interdit l'état incohérent
-- "consumed ET revoked" (impossible métier).
--
-- Précédence des statuts computed (référence canonique) :
--   - sent     = used_at IS NULL AND expires_at >= now() AND revoked_at IS NULL
--   - consumed = used_at IS NOT NULL
--   - expired  = used_at IS NULL AND expires_at < now() AND revoked_at IS NULL
--   - revoked  = revoked_at IS NOT NULL AND used_at IS NULL
--
-- L'API POST /api/admin/invitations/[id]/revoke retourne 409 Conflict si
-- l'admin tente de revoke une invitation déjà consumed (defense en
-- profondeur côté applicatif). Le CHECK constraint DB est la 2e ligne.
-- =============================================================================

ALTER TABLE public.producer_invitations
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ NULL;

-- CHECK constraint exclusivité used_at / revoked_at. Idempotent :
-- DROP IF EXISTS avant ADD pour permettre re-apply.
ALTER TABLE public.producer_invitations
  DROP CONSTRAINT IF EXISTS producer_invitations_revoke_consume_exclusive;

ALTER TABLE public.producer_invitations
  ADD CONSTRAINT producer_invitations_revoke_consume_exclusive
  CHECK (NOT (used_at IS NOT NULL AND revoked_at IS NOT NULL));

-- Index partiel sur revoked_at pour optimiser le filter "revoquées" côté
-- listing admin (volume attendu faible mais cohérent avec pattern existant
-- d'index partiels — cf. disputes_status_open_idx).
CREATE INDEX IF NOT EXISTS producer_invitations_revoked_at_idx
  ON public.producer_invitations (revoked_at DESC)
  WHERE revoked_at IS NOT NULL;
