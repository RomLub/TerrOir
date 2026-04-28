-- =============================================================================
-- TerrOir — table webhook_events_processed (dédup applicative webhooks Stripe)
-- =============================================================================
-- Contexte (mini-chantier T-103 "Dédup webhook notifications", 2026-04-29) :
-- Stripe peut rejouer un même event vers /api/stripe/webhook (auto-retry sur
-- 5xx, replay manuel Dashboard, network glitch). Aujourd'hui le handler
-- (app/api/stripe/webhook/route.tsx) ne se base QUE sur la vérif de signature
-- via stripe.webhooks.constructEvent — aucun check event_id. Un rejouage
-- déclenche donc un second tour d'effets de bord :
--   - payment_intent.succeeded     → double email + SMS producer, double
--                                     audit log order_payment_succeeded,
--                                     RPC revive_order_with_stock_check
--                                     rejouée (déjà idempotente côté DB
--                                     mais re-décrément possible).
--   - payment_intent.payment_failed → double UPDATE cancellation_reason,
--                                     double audit log.
--   - account.updated              → double sync flags + double audit log.
--   - payout.paid                  → double UPDATE payouts.statut.
--
-- Pattern : INSERT EXCLUSIF sur PK event_id. Si l'INSERT réussit, on est
-- le premier traitement de cet event → on continue le handler. Si l'INSERT
-- viole la PK (SQLSTATE 23505), c'est un rejouage → ack 200 immédiat sans
-- effets de bord. Aligné lib/producer-interests/upsert-interest.ts (catch
-- 23505 → branche dédup) et lib/stock-alerts/create-alert.ts.
--
-- Choix PK simple event_id (pas composite event_id + event_type) : les IDs
-- d'event Stripe sont globalement uniques (préfixe evt_xxx, espace global).
-- Le champ event_type sert uniquement à la traçabilité forensique et aux
-- métriques par type d'event (pas à la dédup elle-même).
--
-- RLS : service-role only (pas de policy). Cohérent avec audit_logs et
-- product_stock_alerts (tables backend manipulées via helpers admin
-- exclusivement). Les anon/authenticated n'ont aucun usage sur cette table.
--
-- Pas de purge automatique dans ce chantier. À traiter en chantier dédié
-- futur si volume devient significatif (Stripe → ~10k events/an à volume
-- modéré, négligeable). Index processed_at posé pour faciliter la purge
-- ultérieure (DELETE WHERE processed_at < now() - interval).
-- =============================================================================

begin;

create table if not exists public.webhook_events_processed (
  event_id     text primary key,
  event_type   text not null,
  processed_at timestamptz not null default now()
);

create index if not exists idx_webhook_events_processed_processed_at
  on public.webhook_events_processed (processed_at);

alter table public.webhook_events_processed enable row level security;

-- Pas de policy : table accessible uniquement via service-role (helper
-- lib/webhook-events/check-or-mark-processed.ts). Convention identique
-- à product_stock_alerts.

commit;
