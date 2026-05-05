-- =============================================================================
-- TerrOir — Audit RLS 2026-05-05 / Lots 1+2 : durcissement ACL fonctions
-- =============================================================================
-- Findings traités : CRITICAL-1, CRITICAL-2, MEDIUM-6, LOW-3.
-- Sévérité : CRITICAL (RPCs sensibles publiquement appelables).
-- Référence : docs/audits/audit-rls-2026-05-05.md sections C-1, C-2, M-6, L-3.
--
-- Contexte : `CREATE FUNCTION` accorde par défaut `EXECUTE` au pseudo-rôle
-- PUBLIC. Les migrations historiques posaient ensuite `GRANT EXECUTE TO
-- service_role` ou `authenticated` mais n'ont jamais révoqué le grant PUBLIC.
-- Conséquence audit live : tout client (anon ou authenticated) peut appeler
-- via PostgREST :
--   - revive_order_with_stock_check(uuid)            → corruption stock + état
--                                                       d'une commande tierce.
--   - record_refund_attempt(uuid, text, ...)         → empoisonnement source-
--                                                       of-truth du cron retry.
-- Les autres fonctions soit ont une garde interne `auth.uid() = ...` (create_
-- order_with_items, delete_user_account), soit sont des trigger functions non
-- exposables via PostgREST (compute_order_commission, set_order_code, ...) —
-- l'ACL PUBLIC est inoffensive en pratique mais doit être nettoyée pour
-- défense en profondeur (audit M-6, L-3).
--
-- Stratégie :
--   1. REVOKE EXECUTE ... FROM PUBLIC (et anon/authenticated explicites pour
--      annuler les éventuels grants additifs hérités) sur toutes les fonctions
--      du schema public.
--   2. GRANT EXECUTE explicite aux rôles strictement nécessaires :
--      - is_admin / owns_producer  : appelées depuis policies RLS scoped `to
--                                    public` → callable par anon + auth + sr.
--      - search_producers          : RPC publique (page /carte, /producteurs)
--                                    → anon + authenticated + service_role.
--      - create_order_with_items   : checkout consumer authentifié, garde
--                                    interne auth.uid() = p_consumer_id.
--                                    → authenticated + service_role.
--      - delete_user_account       : RGPD self-service authentifié, garde
--                                    interne auth.uid() = p_user_id.
--                                    → authenticated + service_role.
--      - revive_order_with_stock_check : webhook Stripe payment_succeeded.
--                                        → service_role uniquement.
--      - record_refund_attempt     : cron retry-failed-refunds + 3 paths
--                                    refund (admin/timeout/revival).
--                                    → service_role uniquement.
--      - Trigger functions (compute_order_commission, set_order_code,
--        set_updated_at, slot_rules_set_updated_at, enforce_user_exclusive,
--        generate_order_code, restore_product_stock_on_order_cancel) :
--        appelées par le trigger system comme owner postgres → aucun GRANT
--        externe nécessaire.
--
-- Note : supabase_auth_admin conserve son GRANT ALL hérité de la migration
-- 20260421200000_grant_auth_admin_on_public.sql. Cette migration ne le touche
-- pas (le grant explicite n'est pas affecté par REVOKE FROM PUBLIC).
--
-- Idempotence : REVOKE / GRANT idempotents en Postgres. Re-run safe.
--
-- Rollback : `GRANT EXECUTE ON FUNCTION public.<name>(...) TO PUBLIC;` pour
-- chaque fonction restaurerait l'état antérieur. Non recommandé (réintroduit
-- la faille CRITICAL-1/-2).
--
-- Tests : aucun test Vitest n'invoque ces fonctions en mode anon. Aucun test
-- d'intégration SQL contre une vraie instance (cf. TODO T-296 audit). Risque
-- de régression : nul si l'archi documentée est respectée (RPCs cron/webhook
-- exclusivement service_role). E2E Playwright à valider après apply.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. REVOKE PUBLIC EXECUTE sur toutes les fonctions du schema public
-- -----------------------------------------------------------------------------
revoke execute on function public.compute_order_commission()
  from public, anon, authenticated;

revoke execute on function public.create_order_with_items(
  uuid, uuid, uuid, date, time, text, jsonb
) from public, anon;

revoke execute on function public.delete_user_account(uuid)
  from public, anon;

revoke execute on function public.enforce_user_exclusive()
  from public, anon, authenticated;

revoke execute on function public.generate_order_code()
  from public, anon, authenticated;

revoke execute on function public.is_admin()
  from public;

revoke execute on function public.owns_producer(uuid)
  from public;

revoke execute on function public.record_refund_attempt(
  uuid, text, text, uuid, text, text, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated;

revoke execute on function public.restore_product_stock_on_order_cancel()
  from public, anon, authenticated;

revoke execute on function public.revive_order_with_stock_check(uuid)
  from public, anon, authenticated;

revoke execute on function public.search_producers(
  double precision, double precision, double precision, text[], text[]
) from public;

revoke execute on function public.set_order_code()
  from public, anon, authenticated;

revoke execute on function public.set_updated_at()
  from public, anon, authenticated;

revoke execute on function public.slot_rules_set_updated_at()
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. GRANT EXECUTE strict aux rôles légitimes
-- -----------------------------------------------------------------------------

-- Helpers RLS : invocables depuis policies `to public` → anon + auth + sr.
-- Quand auth.uid() est NULL (anon), retournent false → policy refuse sans
-- erreur d'EXECUTE manquant.
grant execute on function public.is_admin()
  to anon, authenticated, service_role;

grant execute on function public.owns_producer(uuid)
  to anon, authenticated, service_role;

-- RPC publique (page /carte, /producteurs)
grant execute on function public.search_producers(
  double precision, double precision, double precision, text[], text[]
) to anon, authenticated, service_role;

-- RPC consumer authentifiées (garde interne auth.uid() = ...)
grant execute on function public.create_order_with_items(
  uuid, uuid, uuid, date, time, text, jsonb
) to authenticated, service_role;

grant execute on function public.delete_user_account(uuid)
  to authenticated, service_role;

-- RPC backend exclusivement (webhook Stripe / cron retry)
grant execute on function public.revive_order_with_stock_check(uuid)
  to service_role;

grant execute on function public.record_refund_attempt(
  uuid, text, text, uuid, text, text, text, text, text, text, text, text, timestamptz
) to service_role;

-- Trigger functions : aucun GRANT externe nécessaire. Le trigger system
-- exécute la fonction comme owner postgres lors du fire — l'ACL EXECUTE
-- public a été révoquée pour la propreté (LOW-3, M-6).

commit;
