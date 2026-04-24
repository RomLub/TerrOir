-- =============================================================================
-- TerrOir — Stripe Customer MVP : ajout users.stripe_customer_id
-- =============================================================================
-- Prépare le chantier Stripe Customer (décision produit 22/04/2026) : chaque
-- consumer qui paye aura un Stripe Customer associé pour mémoriser ses CB et
-- éviter la ressaisie à chaque commande (circuit court = commandes récurrentes).
--
-- Nullable : colonne remplie à la volée par getOrCreateStripeCustomer (Phase 2),
-- au premier paiement ou à l'ajout manuel d'une CB via /compte/paiements. Les
-- users historiques sans activité de paiement restent à NULL.
--
-- Index partiel : uniquement sur les lignes où stripe_customer_id IS NOT NULL,
-- taille minimale. Utile pour la lookup inverse (webhooks customer.*, debug,
-- RGPD cleanup si on devait retrouver un user par son customer_id).
--
-- RLS : inchangée. Les policies existantes sur public.users (self read/insert/
-- update) sont row-based, elles couvrent automatiquement la nouvelle colonne.
-- =============================================================================

begin;

alter table public.users
  add column if not exists stripe_customer_id text;

create index if not exists idx_users_stripe_customer_id
  on public.users (stripe_customer_id)
  where stripe_customer_id is not null;

commit;
