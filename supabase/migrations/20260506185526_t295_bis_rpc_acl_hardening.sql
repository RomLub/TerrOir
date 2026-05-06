-- =============================================================================
-- TerrOir — T-295-bis : durcissement ACL des 4 RPC findings annexes T-295
-- =============================================================================
-- Audit transverse T-295 a livre l'audit de la RPC update_producer_onboarding
-- (4/4 conforme) + inventaire des 17 fonctions SECURITY DEFINER posees dans
-- schema public. 4 findings annexes non-bloquants Live mais a durcir pour
-- coherence stricte avec la doctrine pre-Live :
--
--   1. invalidate_active_invitations_for_email (T-109) — trigger function
--      avec ACL '=X/postgres' standalone (PUBLIC EXECUTE). Leak inoffensif
--      en pratique (PostgREST n'expose pas les triggers comme RPC), mais
--      propre a revoquer pour coherence avec L-3 du 2026-05-05.
--
--   2. producers_block_owner_admin_columns (T-218 + T-218-bis) — trigger
--      function, meme finding que (1).
--
--   3. bump_geocode_cache (T-219) — RPC SECURITY DEFINER avec anon +
--      authenticated EXECUTE explicites. Call site applicatif (lib/geo/
--      geocode-cache.ts via /api/geocode/route.ts) passe par service_role
--      server-side. Aucun client legitime ne l'appelle direct via PostgREST.
--      Risque : un attaquant authentifie peut bumper hit_count sur n'importe
--      quel CP pour brouiller les metriques.
--
--   4. upsert_geocode_cache (T-219) — meme pattern que (3) mais plus
--      critique : un attaquant peut INSERT coords arbitraires pour un CP
--      donne (cache poisoning). Le DistanceWidget consumer afficherait des
--      distances fausses. Cluster T-227 (re-identification adresse).
--
-- Pattern T-297 idempotence : REVOKE / GRANT sont idempotents par nature
-- (executer la migration deux fois ne change rien apres la premiere
-- application). Pas de DROP IF EXISTS necessaire.
--
-- Doctrine pre-Live formalisee dans T-295 doc, section "Doctrine pre-Live" :
--   - Toute RPC SECURITY DEFINER ecrivant dans tables sensibles : REVOKE
--     EXECUTE FROM PUBLIC + anon + authenticated, GRANT EXECUTE TO
--     service_role exclusivement.
--   - Helpers RLS (is_admin, owns_producer, etc.) gardent anon+authenticated
--     EXECUTE car invoques par les policies elles-memes — hors scope T-295-bis.
--   - Trigger functions REVOKE PUBLIC EXECUTE meme si risque pratique nul
--     (defense-in-depth + coherence audit).
--
-- Tests post-apply : 5 smoke tests via MCP execute_sql (anon ×2 +
-- authenticated ×2 + service_role ×2 sur bump/upsert + indirect via
-- triggers existants pour les 2 trigger functions).
--
-- Rollback :
--   GRANT EXECUTE ON FUNCTION public.bump_geocode_cache(character varying)
--     TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.upsert_geocode_cache(...) TO anon,
--     authenticated;
--   GRANT EXECUTE ON FUNCTION public.invalidate_active_invitations_for_email()
--     TO PUBLIC, anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.producers_block_owner_admin_columns()
--     TO PUBLIC, anon, authenticated;
-- =============================================================================

-- 1. Trigger function invalidate_active_invitations_for_email (T-109)
revoke execute on function public.invalidate_active_invitations_for_email()
  from public, anon, authenticated;

-- 2. Trigger function producers_block_owner_admin_columns (T-218 + T-218-bis)
revoke execute on function public.producers_block_owner_admin_columns()
  from public, anon, authenticated;

-- 3. RPC bump_geocode_cache (T-219) : verrouille service_role only
revoke execute on function public.bump_geocode_cache(character varying)
  from public, anon, authenticated;
grant execute on function public.bump_geocode_cache(character varying)
  to service_role;

-- 4. RPC upsert_geocode_cache (T-219) : verrouille service_role only
revoke execute on function public.upsert_geocode_cache(
  character varying, numeric, numeric, character varying
) from public, anon, authenticated;
grant execute on function public.upsert_geocode_cache(
  character varying, numeric, numeric, character varying
) to service_role;

-- Note : pas de GRANT explicite sur les 2 trigger functions. Le trigger
-- engine Postgres bypass les ACL EXECUTE des fonctions trigger (le binding
-- pg_trigger -> pg_proc reste fonctionnel apres REVOKE). Les triggers
-- continuent a se declencher normalement sur INSERT producer_invitations
-- (T-109) et UPDATE producers (T-218 + T-218-bis).
