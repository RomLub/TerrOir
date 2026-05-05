-- =============================================================================
-- TerrOir — Audit RLS 2026-05-05 / Lot 7 : durcissement defense-in-depth
-- =============================================================================
-- Findings traités :
--   - MEDIUM-1 : FORCE ROW LEVEL SECURITY sur tables sensibles
--   - MEDIUM-5 : drop "disputes_service_role_all" redondante (hors-repo)
--
-- Findings DOC-only ou en arbitrage (NON traités SQL ici) :
--   - MEDIUM-2 (admin policies missing sur orders/payouts/products/...) :
--     décision projet "tout admin via service_role" → DOCUMENTATION dans
--     docs/fixes/fix-rls-2026-05-05.md.
--   - MEDIUM-4 (rate-limit DB producer_interests) : ARBITRAGE EN ATTENTE
--     (quel seuil ? quel mécanisme ? cf. fin du fix doc).
--
-- Sévérité : MEDIUM (defense-in-depth, pas de faille active).
-- Référence : docs/audits/audit-rls-2026-05-05.md sections M-1, M-5.
--
-- Contexte MEDIUM-1 :
-- Postgres bypass RLS automatiquement pour le `table owner` (postgres). En
-- forçant via `ALTER TABLE ... FORCE ROW LEVEL SECURITY`, même une session
-- connectée comme `postgres` (SQL Editor Dashboard, scripts de maintenance)
-- doit explicitement SET ROLE pour bypass. Le rôle `service_role` conserve
-- son attribut BYPASSRLS natif → pas d'impact runtime sur l'app (les helpers
-- backend continuent à fonctionner). C'est uniquement la session interactive
-- `postgres` (rare, contrôlée) qui sera contrainte.
--
-- Tables ciblées (sensibilité forensique / paiements / secrets) :
--   - audit_logs                   forensique RGPD/PCI
--   - disputes                     chargebacks Stripe
--   - refund_incidents             source-of-truth refund retry
--   - refund_incident_attempts     historique tentatives refund
--   - payouts                      virements producteurs
--   - email_change_otp_codes       OTP éphémères (secrets hashés)
--   - email_change_undo_tokens     undo tokens (secrets hashés)
--   - webhook_events_processed     dédup events Stripe
--   - product_stock_alerts         emails consumers + tokens
--
-- Tables NON forcées :
--   - users / admin_users           ne contient pas de secrets
--   - producers / products / slots  données catalogue, owner-readable de droit
--   - orders / order_items          parties-readable, pas de secret
--   - reviews / notifications       contenu non confidentiel
--   - producer_interests / invitations  données prospect non-PII strict
--   - gms_prices / gms_prices_history   référentiel public
--   - product_categories / animals / cuts  référentiel public
--   - slot_rules                    business config catalogue
--
-- Contexte MEDIUM-5 :
-- L'audit live a découvert une policy `disputes_service_role_all` posée hors
-- repo (probablement via Dashboard) sur public.disputes pour `service_role`
-- avec qual=true / with_check=true. Redondante : `service_role` bypass RLS
-- nativement (BYPASSRLS), aucun effet runtime. Conservée, elle suggère à tort
-- qu'une policy est nécessaire pour service_role — risque de copy-paste sur
-- d'autres tables. Drop nettoie le modèle.
--
-- Idempotence : ALTER TABLE ... FORCE / NO FORCE est idempotent (no-op si
-- l'état est déjà celui demandé). DROP POLICY IF EXISTS idempotent.
--
-- Rollback :
--   - `ALTER TABLE <name> NO FORCE ROW LEVEL SECURITY;` pour défaire le force.
--   - Pour restaurer "disputes_service_role_all" :
--     `CREATE POLICY "disputes_service_role_all" ON public.disputes FOR ALL
--      TO service_role USING (true) WITH CHECK (true);` — déconseillé.
--
-- Tests : aucun test ne se connecte directement comme `postgres` (les tests
-- Vitest passent via le client supabase typé). Risque de régression : nul
-- en runtime app. Impact uniquement sur sessions SQL Editor Dashboard pour
-- ces 9 tables — l'admin doit faire `SET ROLE service_role` explicitement
-- pour SELECT/UPDATE bypass.
-- =============================================================================

begin;

-- 1. FORCE RLS sur tables sensibles -------------------------------------------
alter table public.audit_logs                force row level security;
alter table public.disputes                  force row level security;
alter table public.refund_incidents          force row level security;
alter table public.refund_incident_attempts  force row level security;
alter table public.payouts                   force row level security;
alter table public.email_change_otp_codes    force row level security;
alter table public.email_change_undo_tokens  force row level security;
alter table public.webhook_events_processed  force row level security;
alter table public.product_stock_alerts      force row level security;

-- 2. Drop policy redondante (hors-repo, ajoutée via Dashboard) ----------------
drop policy if exists "disputes_service_role_all" on public.disputes;

commit;
