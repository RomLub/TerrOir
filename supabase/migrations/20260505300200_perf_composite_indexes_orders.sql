-- =============================================================================
-- Audit perf-postgres-2026-05-05 — finding H-2
-- =============================================================================
-- Apply effectué le 2026-05-05 via MCP execute_sql (CONCURRENTLY, donc non
-- éligible au wrapper apply_migration qui ouvre une transaction).
-- Version_id MCP : non tracé (CONCURRENTLY ne s'enregistre pas dans
-- supabase_migrations.schema_migrations). Reconstitué pour cohérence repo↔prod.
--
-- NB : la version prod a été créée avec CREATE INDEX CONCURRENTLY (zéro lock
-- sur les writes pendant la création). En local (db reset sur DB vide), on
-- utilise CREATE INDEX simple (résultat structurellement identique, plus rapide
-- sans le coût du double-pass de CONCURRENTLY).
--
-- Indexes composites pour les filtres récurrents sur orders :
--  1. orders_producer_statut_date_idx : couvre dashboard (count today, next pickup)
--                                        + page producer commandes + cron reminder
--  2. orders_slot_statut_idx (partial) : couvre cart/validate (slot_id IN ... AND statut IN ...)
-- =============================================================================

CREATE INDEX IF NOT EXISTS orders_producer_statut_date_idx
  ON public.orders (producer_id, statut, date_retrait DESC);

CREATE INDEX IF NOT EXISTS orders_slot_statut_idx
  ON public.orders (slot_id, statut)
  WHERE statut IN ('pending','confirmed','ready');
