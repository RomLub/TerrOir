-- =============================================================================
-- TerrOir — table product_stock_alerts (alerte dispo produit)
-- =============================================================================
-- Feature : un consumer (anonyme ou connecté) laisse son email pour être
-- prévenu au retour en stock d'un produit indisponible (stock_disponible=0
-- AND stock_illimite=false). Le producer voit dans son dashboard combien
-- de personnes attendent chaque produit (signal demande).
--
-- Architecture (cf. arbitrages PUSH 1) :
--   - Double opt-in : INSERT crée row avec confirm_token. Email confirm
--     envoyé. Consumer clique → UPDATE confirmed_at = now().
--   - Notification : quand le producer met à jour stock_disponible
--     manuellement (route PATCH PUSH 5a), un hook applicatif sélectionne
--     les alertes éligibles (confirmed_at NOT NULL, notified_at IS NULL,
--     unsubscribed_at IS NULL) et envoie un email back-in-stock.
--   - Unsubscribe : lien permanent dans tous les emails (UPDATE
--     unsubscribed_at = now() via unsubscribe_token).
--   - Purge RGPD (cron daily) :
--     * notified_at < now() - 90 days → DELETE (donnée perso non conservée)
--     * confirmed_at IS NULL AND created_at < now() - 7 days → DELETE
--       (alerte abandonnée, double opt-in non complété)
--
-- RLS : table en service-role only (pas de policy applicative). Tous les
-- writes/reads passent via les helpers lib/stock-alerts/*.ts qui utilisent
-- createSupabaseAdminClient. Cohérent avec audit_logs (zéro policy INSERT/
-- UPDATE/DELETE, écritures forgeables sinon). Pour product_stock_alerts on
-- pousse plus loin : zéro policy SELECT non plus, car le dashboard producer
-- lit via helper applicatif service-role (pas de SELECT direct côté client).
--
-- ON DELETE :
--   - product_id CASCADE : si le produit est supprimé, les alertes n'ont
--     plus de cible → DELETE.
--   - consumer_id SET NULL : si l'utilisateur supprime son compte (RGPD
--     self-service), l'alerte reste lisible le temps que le cron purge
--     RGPD passe (sémantique : on sait que quelqu'un attend ce produit
--     mais l'identifiant utilisateur est effacé conformément au droit à
--     l'effacement). L'email reste car il est nécessaire pour notifier
--     ou pour permettre un unsubscribe via token — il sera purgé par le
--     cron 90 jours après notification ou 7 jours sans confirmation.
--
-- Tokens stockés (pas HMAC déterministe comme lib/rgpd/opt-out-token.ts) :
--   - Permet la régénération sur ré-abonnement (cas user resub après
--     unsubscribe : on resette unsubscribed_at + regen confirm_token,
--     l'ancien token devient invalide).
--   - confirm_token : random 32 chars URL-safe, expiration applicative
--     7 jours (vérifiée via created_at, nettoyée par cron purge).
--   - unsubscribe_token : random 32 chars URL-safe, pas d'expiration
--     (lien permanent dans tous les emails — convention RGPD universelle).
-- =============================================================================

begin;

create table if not exists public.product_stock_alerts (
  id                   uuid primary key default gen_random_uuid(),
  product_id           uuid not null references public.products(id) on delete cascade,
  email                text not null,
  consumer_id          uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  confirmed_at         timestamptz,
  notified_at          timestamptz,
  unsubscribed_at      timestamptz,
  confirm_token        text not null unique,
  unsubscribe_token    text not null unique,
  unique (product_id, email)
);

-- Index partiel pour la query "alertes actives par produit" (helpers
-- notify-back-in-stock + fetch-producer-alerts) : confirmées, jamais
-- notifiées, non désabonnées.
create index if not exists idx_product_stock_alerts_active_by_product
  on public.product_stock_alerts (product_id)
  where notified_at is null
    and confirmed_at is not null
    and unsubscribed_at is null;

-- Index pour le rate limit applicatif (count alertes par email sur la
-- dernière heure dans le helper de la route POST /api/stock-alerts).
create index if not exists idx_product_stock_alerts_email_created
  on public.product_stock_alerts (email, created_at desc);

alter table public.product_stock_alerts enable row level security;

-- Pas de policy : table accessible uniquement via service-role (helpers
-- applicatifs lib/stock-alerts/*). Convention plus stricte qu'audit_logs
-- (qui expose une policy SELECT admin). Si besoin d'admin read forensique
-- ultérieurement, ajouter une policy ciblée.

commit;
