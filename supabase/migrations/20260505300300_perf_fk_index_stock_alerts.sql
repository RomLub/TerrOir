-- =============================================================================
-- Audit perf-postgres-2026-05-05 — finding M-1
-- =============================================================================
-- Apply effectué le 2026-05-05 via MCP execute_sql (CONCURRENTLY).
-- Version_id MCP : non tracé (CONCURRENTLY). Reconstitué pour cohérence repo↔prod.
--
-- NB : prod créé avec CONCURRENTLY ; ici CREATE INDEX simple pour db reset local
-- (résultat structurellement identique).
--
-- FK product_stock_alerts.consumer_id → auth.users sans index : un DELETE
-- cascade RGPD ferait un seq scan pour vérifier la contrainte. Index posé
-- maintenant car la feature stock-alerts consumer-facing est imminente.
--
-- Les 2 autres FK non indexées (producer_invitations.created_by,
-- gms_prices.updated_by) restent backlog — ROI faible (admin-only).
-- =============================================================================

CREATE INDEX IF NOT EXISTS product_stock_alerts_consumer_id_idx
  ON public.product_stock_alerts (consumer_id);
