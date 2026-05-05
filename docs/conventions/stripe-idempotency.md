# Stripe — conventions idempotency-key

> Document fixé par l'audit Stripe phase A finding L-6 (2026-05-05) puis renforcé par M-2 (idempotency manquant sur path `revival`).

## Pourquoi

Stripe accepte un header `Idempotency-Key` sur la plupart de ses POST (PaymentIntents, Refunds, Transfers, Customers, AccountLinks…). Si une requête est rejouée avec la même clé sous 24h, Stripe renvoie la **même réponse que la 1ère fois** au lieu de créer un 2e objet. C'est notre première ligne de défense contre :

- Double-clic UI consumer.
- Retry automatique Vercel/Next.js sur timeout réseau.
- Rejouage webhook (combiné avec la dédup applicative `webhook_events_processed`, défense en profondeur).
- Race conditions entre 2 process serveurs (rare mais possible sur cron + handler webhook).

Sans clé d'idempotence, un retry HTTP (transparent côté client) crée 2 PaymentIntents distincts → 2 fois 4€ Stripe fee, 2 emails consumer, divergence DB/Stripe.

## Règle générale

> **Toute key doit contenir l'ID stable de l'objet métier (UUID DB) + un suffixe contextuel si plusieurs paths émettent sur le même objet.**

Format canonique : `<verb>_<entityId>[_<context>]`

Exemples valides :
- `pi_create_<orderId>` — un seul path crée un PI par order, pas de suffixe nécessaire.
- `refund_<orderId>_admin` — multi-path, suffixe = qui émet.
- `transfer_<producerId>_<weekStart>` — un transfer par producer par semaine, dimension temporelle dans la clé.

> **Jamais d'UUID v4 généré inline (ex. `crypto.randomUUID()` ou `uuid.v4()`).** Une clé générée à chaque appel ne permet PAS de dédupliquer un retry — le 2e appel a une clé différente, Stripe re-crée l'objet.

## Inventaire des conventions actuelles

| Fichier | Operation Stripe | Idempotency-Key | Discriminator |
|---|---|---|---|
| `lib/stripe/customer.ts` | `customers.create` | `customer_create_${userId}` | userId DB stable |
| `app/api/stripe/create-payment-intent/route.ts` | `paymentIntents.create` | `pi_create_${order.id}` | orderId UUID |
| `app/api/stripe/refund/route.tsx` | `refunds.create` (admin path) | `refund_${order.id}_admin` | suffixe `_admin` (idem si producer émet — V1.x peut introduire `_producer`) |
| `app/api/cron/order-timeout/route.tsx` | `refunds.create` (timeout path) | `refund_${order.id}_timeout` | suffixe `_timeout` |
| `app/api/cron/retry-failed-refunds/route.ts` | `refunds.create` (retry path) | (à confirmer côté retryIncident) | TBD |
| `lib/stripe/handle-payment-succeeded.ts` | `refunds.create` (revival path) | `refund_${orderId}_revival` | suffixe `_revival` (audit M-2 fix 2026-05-05) |
| `lib/stripe/payouts.ts` | `transfers.create` | `transfer_${producerId}_${weekStart}` | dimension temporelle |

> **Pourquoi des suffixes par path sur les refunds** : trois paths peuvent émettre un refund sur la même `order.id` (admin, timeout, revival). Sans suffixe, le 2e path qui tente refund recevrait la même réponse Stripe que le 1er — masquant un éventuel échec, ou à l'inverse rejouant un refund déjà fait. Le suffixe garantit que chaque path a son propre namespace d'idempotence.

## Ce qu'il NE FAUT PAS faire

❌ Générer une UUID inline :

```ts
// MAUVAIS — chaque retry échappe à la dédup Stripe
await stripe.refunds.create(
  { payment_intent: pi },
  { idempotencyKey: crypto.randomUUID() },
);
```

❌ Utiliser un timestamp :

```ts
// MAUVAIS — chaque retry a un timestamp différent
{ idempotencyKey: `refund_${Date.now()}` }
```

❌ Réutiliser la même clé sur 2 opérations différentes :

```ts
// MAUVAIS — le 2e appel reçoit la réponse du 1er, le PI n'est jamais créé
await stripe.paymentIntents.create({ ... }, { idempotencyKey: `op_${orderId}` });
await stripe.refunds.create({ ... }, { idempotencyKey: `op_${orderId}` });
```

## Ce qu'il FAUT faire

✅ Toujours dériver de l'ID DB stable + suffixe contextuel :

```ts
// BON
await stripe.refunds.create(
  { payment_intent: order.stripe_payment_intent_id },
  { idempotencyKey: `refund_${order.id}_admin` },
);
```

✅ Documenter la convention en commentaire inline (voir T-404, T-408, T-414 dans le code) avec référence au discriminator pour aider les futurs paths à choisir un suffixe non-collision.

## Window d'unicité Stripe

Stripe garde l'idempotency-key **24h**. Au-delà, la clé est libérée et un même payload avec la même clé crée un nouvel objet. Pour les opérations rares (transfer hebdo) c'est OK ; pour les retries cron qui peuvent attendre >24h, il faut prévoir un fail-safe applicatif (DB lookup `payouts.statut='paid'` avant retry, etc.).

## Liens

- [Stripe doc — idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- Audit RPC §L-2 : mention initiale du contrat (avril 2026).
- Audit Stripe phase A (2026-05-05) : §M-2 (revival path manquant) + §L-6 (cette doc).
- Fix phase 1 — `docs/fixes/fix-stripe-phase-1-2026-05-05.md`.
