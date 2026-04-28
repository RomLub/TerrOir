-- =============================================================================
-- TerrOir — Phase B : ajout colonne updated_by sur gms_prices (traçabilité éditoriale)
-- =============================================================================
-- Phase B (interface admin /admin/gms-prices) : track quel admin a modifié
-- chaque référence. Décision A4 : pas d'instrumentation audit_logs (forensique
-- réservé auth/paiements/RGPD), colonne ciblée à la place.
--
-- ON DELETE SET NULL : si l'admin auteur est supprimé (cas rare — admin_users
-- peut techniquement être nettoyé), l'historique de modification reste lisible
-- avec updated_by=NULL. Préserve la donnée éditoriale sans bloquer une suppression.
--
-- Nullable + sans default : les lignes seedées Phase A (admin_users absent au
-- moment du seed) restent updated_by=NULL, sémantiquement correct ("auteur
-- inconnu / seed initial"). Les writes admin Phase B+ remplissent la colonne.
--
-- Pas de policy modifiée : la table reste en service_role only pour les
-- writes (cf. migration Phase A, pas de policy INSERT/UPDATE/DELETE).
-- =============================================================================

begin;

alter table public.gms_prices
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

commit;
