-- =============================================================================
-- Audit perf-postgres-2026-05-05 — finding C-4 — fix régression ACL
-- =============================================================================
-- Apply effectué le 2026-05-05 via MCP apply_migration, version_id 20260505134430.
-- Reconstitué pour cohérence repo↔prod.
--
-- Le chantier audit-rls-lot_1_2 (migration 20260505112936_audit_rls_lot_1_2_harden_security_definer_acls)
-- avait révoqué EXECUTE FROM PUBLIC sur search_producers. Le DROP+CREATE FUNCTION
-- des deux migrations précédentes (20260505300400 + 20260505300500) a recréé
-- le grant par défaut Postgres `=X/postgres` (PUBLIC).
--
-- Cette migration restaure l'état hardenisé : EXECUTE uniquement aux rôles
-- explicites Supabase (anon, authenticated, service_role).
--
-- LEÇON APPRISE (à appliquer dans les futurs chantiers) : tout DROP+CREATE
-- FUNCTION sur une fonction existante qui avait un REVOKE FROM PUBLIC doit être
-- suivi d'un REVOKE FROM PUBLIC explicite. Préférer CREATE OR REPLACE quand la
-- signature ne change pas (préserve l'ACL).
-- =============================================================================

revoke execute on function public.search_producers(
  double precision, double precision, double precision, text[], text[]
) from public;

-- Re-grants idempotents (déjà posés par 20260505300500 mais répétés ici pour
-- l'auto-documentation).
grant execute on function public.search_producers(
  double precision, double precision, double precision, text[], text[]
) to anon, authenticated, service_role;
