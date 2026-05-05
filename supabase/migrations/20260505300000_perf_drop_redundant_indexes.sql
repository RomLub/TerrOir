-- =============================================================================
-- Audit perf-postgres-2026-05-05 — finding C-2
-- =============================================================================
-- Apply effectué le 2026-05-05 via MCP apply_migration, version_id 20260505133039.
-- Reconstitué pour cohérence repo↔prod (pattern documenté du chantier RLS+Auth :
-- les version_ids MCP diffèrent des préfixes locaux mais le contenu SQL est verbatim).
--
-- DROP des 4 indexes redondants exacts qui doublonnent un UNIQUE canonique.
-- Aucun gain en read (le canonique seul sert), mais write-amplification +25%
-- sur les 4 tables concernées + 120 kB RAM/disque gaspillés.
--
-- Canoniques conservés :
--   slots_producer_starts_at_unique          (UNIQUE, 6820 scans)
--   producer_invitations_token_key           (UNIQUE)
--   disputes_stripe_dispute_id_key           (UNIQUE)
--   refund_incidents_order_id_kind_key       (UNIQUE composite préfixée par order_id)
-- =============================================================================

DROP INDEX IF EXISTS public.slots_producer_starts_at_idx;
DROP INDEX IF EXISTS public.producer_invitations_token_idx;
DROP INDEX IF EXISTS public.disputes_stripe_dispute_id_idx;
DROP INDEX IF EXISTS public.refund_incidents_order_id_idx;
