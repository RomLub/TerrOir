-- =============================================================================
-- T-109 : auto-invalidation des invitations producer actives sur nouvel INSERT
-- =============================================================================
-- Contexte : la route /api/admin/producers/invite revoque déjà côté applicatif
-- les invitations actives du même email (UPDATE expires_at=now()) avant l'INSERT
-- du nouveau token, et émet 1 audit_log invitation_revoked par row revoquée.
-- Race documentée dans le code (commentaire L177) : 2 POST concurrents peuvent
-- chacun voir l'autre comme actif et se rater mutuellement. Pas critique en
-- pratique (admin humain) mais on durcit l'invariant côté DB pour atomicité.
--
-- Trigger AFTER INSERT (vs BEFORE) : on a besoin du NEW.id pour exclure la
-- nouvelle row de l'UPDATE. AFTER INSERT est le pattern standard pour les
-- invariants cross-row post-mutation.
--
-- Match case-insensitive (lower) : aligné sur la logique ilike applicative et
-- les autres tables où l'email sert de clé fonctionnelle (producer_interests).
--
-- SECURITY DEFINER + SET search_path : aligné sur le pattern audit M-1
-- perf_search_producers (rpc_lock_search_path_invoker_functions, 20260505154054).
--
-- Pas d'UNIQUE PARTIAL INDEX : PostgreSQL exige des prédicats IMMUTABLE dans un
-- index partial — `now()` ne l'est pas, et un fallback `WHERE used_at IS NULL`
-- bloquerait l'INSERT en présence d'expired_orphan (état au 2026-05-06 : 8 rows).
-- Le trigger seul porte l'invariant.

CREATE OR REPLACE FUNCTION public.invalidate_active_invitations_for_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.producer_invitations
  SET expires_at = now()
  WHERE lower(email) = lower(NEW.email)
    AND used_at IS NULL
    AND expires_at > now()
    AND id <> NEW.id;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.invalidate_active_invitations_for_email() IS
  'T-109 — Auto-invalidate active producer invitations matching NEW.email on INSERT. Filet atomique (race-safe) en complément de la logique applicative dans /api/admin/producers/invite.';

DROP TRIGGER IF EXISTS trg_invalidate_active_invitations
  ON public.producer_invitations;

CREATE TRIGGER trg_invalidate_active_invitations
  AFTER INSERT ON public.producer_invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.invalidate_active_invitations_for_email();

COMMENT ON TRIGGER trg_invalidate_active_invitations ON public.producer_invitations IS
  'T-109 — Garantit qu''un email n''a jamais 2 invitations producer actives simultanément. Race-safe (vs logique applicative seule).';
