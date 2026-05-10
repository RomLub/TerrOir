-- =============================================================================
-- F-004 (audit pré-launch 2026-05-10) — orders.transfer_id pour clawback
-- =============================================================================
-- Ajoute orders.transfer_id (nullable) qui sera renseigné par le cron
-- weekly-payout au moment où la batch d'orders d'un producer est aggrégée
-- en un Transfer Stripe Connect (lib/stripe/payouts.tsx).
--
-- Modèle Separate Charges & Transfers : les Transfers hebdo sont
-- INDÉPENDANTS des refunds/disputes ultérieurs. Si une order completed
-- (transfer payouté) tombe en dispute lost OU refund post-completion,
-- TerrOir doit appeler stripe.transfers.createReversal(transfer_id, ...)
-- pour récupérer le montant côté Connect account du producer.
--
-- Sans cette colonne, le helper reverseTransferIfNeeded (commit suivant)
-- devrait reconstituer le mapping order → payout via la date civile Paris
-- (previousWeekRange logic) — fragile, dépend de la TZ logic, casse en
-- prod si une retro-correction TZ change la semaine d'aggregation.
--
-- Contraintes :
--   - nullable : les orders pre-completion (pending/confirmed/cancelled)
--     n'ont pas encore de transfer associé. Seules les orders completed
--     puis aggregées en payout reçoivent un transfer_id.
--   - pas de FK vers payouts.stripe_transfer_id : le Transfer Stripe ID
--     reste la clé canonique (un transfer est unique côté Stripe API).
--   - index partiel WHERE NOT NULL pour les lookups inverse (peu de rows
--     avec transfer_id rempli, l'index reste léger).
--
-- Backfill : pas appliqué par cette migration (les orders completed déjà
-- payoutées en mode Test sont rares pré-launch). Si besoin post-Live, un
-- script one-shot peut faire join orders ↔ payouts via date civile + producer.
--
-- Cf. CLAUDE.md doctrine migrations idempotentes (forward-only).
-- =============================================================================

alter table public.orders
  add column if not exists transfer_id text;

create index if not exists orders_transfer_id_idx
  on public.orders (transfer_id)
  where transfer_id is not null;

comment on column public.orders.transfer_id is
  'Stripe Transfer ID (tr_xxx) renseigné par le cron weekly-payout au moment de l''agrégation. Permet le clawback transfers.createReversal sur dispute lost / refund post-completion (F-004 audit pré-launch 2026-05-10).';
