-- =============================================================================
-- TerrOir — réparation des IDs Stripe dans public.payouts
-- =============================================================================
-- Contexte : la colonne initiale stripe_payout_id stockait en réalité
-- l'identifiant d'un Stripe Transfer (plateforme → Connect account), pas
-- celui d'un Payout bancaire.
--
--   stripe_payout_id (ancien)  →  stripe_transfer_id    (id du Transfer)
--   stripe_payout_id (nouveau) →  nullable, rempli par le webhook
--                                 payout.paid (id du Payout bancaire)
-- =============================================================================

alter table public.payouts
  rename column stripe_payout_id to stripe_transfer_id;

alter table public.payouts
  add column stripe_payout_id text;

create index payouts_stripe_transfer_id_idx on public.payouts (stripe_transfer_id);
create index payouts_stripe_payout_id_idx   on public.payouts (stripe_payout_id);
