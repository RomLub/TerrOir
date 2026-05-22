# Audit factuel — Flow Stripe Connect TerrOir

Date : 2026-05-13
Lecture seule. Aucune recommandation, aucune décision. Toutes les
affirmations sont sourcées dans le code (chemin + ligne) ou la base
de données (via MCP Supabase, sondages `information_schema`).

---

## 1. Type de charge Stripe Connect

**Modèle utilisé : Separate Charges & Transfers** (chargements sur la
plateforme + transferts différés vers les comptes Connect des
producteurs).

Preuves dans le code :

- `app/api/stripe/create-payment-intent/route.ts:158-160` — commentaire
  inline du PR :
  > « Separate charges & transfers: le paiement arrive en totalité sur
  > le compte plateforme TerrOir. Le virement net vers le producteur
  > (montant_total − 6%) est déclenché plus tard par
  > /api/cron/weekly-payout. »
- `lib/stripe/reverse-transfer.ts:12-15` — commentaire architectural :
  > « Architecture Stripe Connect TerrOir = Separate Charges & Transfers :
  > les Transfers hebdo (cron weekly-payout) vers comptes Connect des
  > producers sont INDÉPENDANTS des refunds/disputes ultérieurs sur les
  > charges originales. »

**Type d'account Connect côté provisioning : Express** (via controller
properties, pas le legacy `type:"express"`).

- `app/api/stripe/connect/onboard/route.ts:83-96` : `stripe.accounts.create()`
  avec `controller.stripe_dashboard.type = "express"`,
  `controller.fees.payer = "application"`,
  `controller.losses.payments = "application"`,
  `controller.requirement_collection = "stripe"`,
  `capabilities: { card_payments: { requested: true }, transfers: { requested: true } }`.

---

## 2. Création du PaymentIntent — paramètres exacts

Fichier canonique : `app/api/stripe/create-payment-intent/route.ts`.

Appel `stripe.paymentIntents.create()` en `app/api/stripe/create-payment-intent/route.ts:181-198` :

```ts
pi = await stripe.paymentIntents.create(
  {
    amount,                              // eurosToCents(order.montant_total)
    currency: "eur",
    customer: customerId,                // getOrCreateStripeCustomer(...)
    automatic_payment_methods: {
      enabled: true,
      allow_redirects: "never",
    },
    ...(setupFutureUsage && { setup_future_usage: setupFutureUsage }),
    metadata: {
      order_id: order.id,
      producer_id: order.producer_id,
      consumer_id: order.consumer_id ?? "",
    },
  },
  { idempotencyKey: `pi_create_${order.id}` },
);
```

Paramètres Connect-related absents (non trouvables dans le code) :

| Paramètre Stripe          | Présent ? | Preuve                                                                    |
|---------------------------|-----------|---------------------------------------------------------------------------|
| `transfer_data`           | NON       | `Grep` `transfer_data` sur `lib/` et `app/` → aucun match                 |
| `application_fee_amount`  | NON       | `Grep` `application_fee_amount` sur `lib/` et `app/` → aucun match       |
| `on_behalf_of`            | NON       | `Grep` `on_behalf_of` sur `lib/` et `app/` → aucun match                 |
| `stripeAccount` (header)  | NON       | aucune option `{ stripeAccount: ... }` passée à `stripe.paymentIntents.create` |

Le PaymentIntent est créé sur le compte plateforme TerrOir, sans aucun
routing Connect côté charge. Le SDK est instancié sans `stripeAccount`
default (`lib/stripe/server.ts:38-41`).

Notes complémentaires :

- `metadata.order_id` est obligatoire — sert au matching des webhooks
  (`lib/stripe/handle-payment-succeeded.ts:91-94` lit
  `paymentIntent.metadata?.order_id`).
- `automatic_payment_methods.allow_redirects: "never"` filtre les
  méthodes redirect-based (SEPA Debit redirect, Bancontact…) pour
  préserver le flow single-page (`route.ts:163-174`).
- Idempotency key `pi_create_${order.id}` (`route.ts:197`).
- Guard pré-PI : `producers.stripe_charges_enabled` (`route.ts:92-103`).

---

## 3. Flow du transfer (plateforme → Connect producteur)

Modèle : **transfer manuel hebdomadaire**, jamais à la confirmation
du PaymentIntent.

### 3.1 Trigger

Cron Vercel : `app/api/cron/weekly-payout/route.tsx`, schedule
`vercel.json:21-23` :

```json
{ "path": "/api/cron/weekly-payout", "schedule": "0 8 * * 1" }
```

→ Lundi 08:00 UTC (≈ 09:00–10:00 Paris).

### 3.2 Logique

Helper : `lib/stripe/payouts.tsx` (fonction `processWeeklyPayouts`,
`payouts.tsx:133-584`).

Algorithme :

1. Calcul de la fenêtre `previousWeekRange()` Lundi 00:00 → Dimanche
   23:59:59.999 Europe/Paris (`payouts.tsx:40-55`).
2. SELECT des `orders` `statut='completed'` avec `completed_at` dans la
   fenêtre (`payouts.tsx:147-160`).
3. Agrégation par `producer_id`, sommes en cents via `sumCents()`
   (`payouts.tsx:171-205`).
4. Pour chaque producer :
   - Check idempotence `payouts` row `(producer_id, periode_debut)`
     (`payouts.tsx:211-218`).
   - Si nouvelle row → `INSERT payouts statut='processing'` avant
     transfer (séquence T-414, `payouts.tsx:376-389`).
   - `stripe.transfers.create()` en `payouts.tsx:303-311` (resume) et
     `payouts.tsx:403-411` (nominal) :
     ```ts
     await stripe.transfers.create(
       {
         amount: montantNetCents,     // montant_total − 6%
         currency: "eur",
         destination: producer.stripe_account_id,
         metadata: { producer_id, periode_debut, periode_fin },
       },
       { idempotencyKey: `transfer_${producerId}_${periodeDebut}` },
     );
     ```
   - `UPDATE payouts SET statut='paid', stripe_transfer_id=...`
     (`payouts.tsx:527-531`).
   - `UPDATE orders SET transfer_id = transfer.id` sur les orders
     aggrégées (`markOrdersTransferred`, `payouts.tsx:116-131` +
     `payouts.tsx:328-333` / `payouts.tsx:547-552`).
5. Audit log `stripe_transfer_initiated` (`payouts.tsx:337-353` resume,
   `payouts.tsx:557-574` nominal).

### 3.3 Guard pré-transfer

`producers.stripe_payouts_enabled` doit être `true`
(`payouts.tsx:277-288`). Sinon row payout est skip avec
`error: "Producer Stripe account not ready for payouts"`.

### 3.4 Échec synchrone (Stripe Connect Express n'émet pas
`transfer.failed`)

`payouts.tsx:401-525` :
- UPDATE payouts `statut='failed'`, `error_msg=msg`.
- Audit log `stripe_transfer_failed` (`source: "sync_transfer_create"`).
- Notification placeholder + email URGENT admin via Resend
  (template `admin_transfer_failed`).

---

## 4. Flow du payout (Connect → IBAN producteur)

### 4.1 Schedule configuré

**Non trouvable dans le code.** Aucun appel `stripe.accounts.update(...
{ settings: { payouts: { schedule: ... } }})` ni
`payout_schedule.interval` dans le repo (Grep `payout_schedule|schedule_interval`
sur tout le repo → no matches, confirmé via Grep ci-dessus).

`app/api/stripe/connect/onboard/route.ts:83-96` crée l'account avec les
capabilities `card_payments` + `transfers` mais sans configurer un
schedule personnalisé. Par défaut Stripe applique le schedule standard
du compte selon le pays / industrie (le code ne le surcharge pas).

### 4.2 Émission

Le payout est déclenché par Stripe automatiquement selon le schedule
par défaut du compte Connect. Côté TerrOir, ce flow est uniquement
**observé** via webhook (cf. section 7, événement `payout.paid`).

### 4.3 Observation du payout dans le code

- `lib/stripe/handle-payout-paid.ts:50-155` — handler webhook
  `payout.paid` : match sur `payout.source_transaction =
  payouts.stripe_transfer_id` (stratégie a), fallback `event.account ->
  producers.stripe_account_id -> payouts récents` (stratégie b, T-402),
  UPDATE `payouts.statut='paid'` + `stripe_payout_id`, audit log
  `stripe_payout_paid`.
- `lib/stripe/handle-payout-failed.tsx:40-208` — handler webhook
  `payout.failed` : 2 stratégies de match similaires (a) `metadata.payout_id`,
  (b) fallback event.account. UPDATE `payouts.statut='failed'` +
  `error_msg`, audit log `stripe_payout_failed`, email URGENT admin
  Resend (`admin_payout_failed`).

---

## 5. Flow des refunds

### 5.1 Émetteurs de refund

Appels `stripe.refunds.create()` recensés :

| Fichier                                          | Path / contexte                                          | Idempotency key                       |
|--------------------------------------------------|----------------------------------------------------------|---------------------------------------|
| `app/api/stripe/refund/route.tsx:322-332`        | Admin (toujours) ou producer (si ≤ cap `producerRefundCap`, default 500€) | `refund_${order.id}_admin`            |
| `lib/refunds/execute-refund.ts:99-...`           | Helper réutilisé par flow `admin_approved_pending`        | `idempotencyKey` reçu en input        |
| `lib/stripe/handle-payment-succeeded.ts:240-251` | Webhook PI succeeded — résurrection 3DS bloquée (stock/slot) | `refund_${orderId}_revival`           |
| `lib/stripe/handle-early-fraud-warning.tsx:184-...` | Webhook `radar.early_fraud_warning.created` | (paramètres : `reason:"fraudulent"`)  |
| `app/api/orders/[id]/cancel/route.tsx`           | Cancel post-paiement                                      | (présent — grep `stripe.refunds.create` ligne identifiée) |
| `app/api/cron/order-timeout/route.tsx`           | Cron timeout (jour 9h)                                    | (présent — grep ligne identifiée)     |

### 5.2 `reverse_transfer` paramètre Stripe natif

**Non utilisé.** `Grep "reverse_transfer"` sur le repo → aucun match.
Aucun `stripe.refunds.create({...,  reverse_transfer: true})`.

### 5.3 Clawback côté Connect — mécanisme propre TerrOir

Helper : `lib/stripe/reverse-transfer.ts` (`reverseTransferIfNeeded`).

- Lookup `orders.transfer_id` (`reverse-transfer.ts:70-74`).
- Si NULL → `noop_no_transfer_id` (`reverse-transfer.ts:92-98`)
  (order pre-completion, pas encore payouté).
- Si renseigné → `stripe.transfers.createReversal()`
  (`reverse-transfer.ts:108-120`) avec `amount` en cents,
  `metadata: { order_id, producer_id, source }`,
  `idempotencyKey: reversal_${orderId}_${source}`.
- Audit log `stripe_transfer_reversed` (succès) ou
  `stripe_transfer_reversal_failed` (échec).

Doctrine d'ordonnancement : reversal **AVANT** refund Stripe
(`route.tsx:267-308`, commentaire « Option A, atomicité d'échec »). Si
le reversal échoue (`kind='failed'`) sur path admin/producer, le refund
est BLOQUÉ (HTTP 502) + `sendOpsAlert`.

### 5.4 Cron retry

`app/api/cron/retry-failed-refunds/route.ts` — schedule
`vercel.json:25-27` : `0 4 * * *` (4h UTC, daily). Lit
`refund_incidents` `status IN ('pending','retrying')` avec
`retry_count < max_retries`, FIFO via `first_failed_event_at`, batch 1000,
concurrency Stripe cap 10. Pour chaque incident : `retryIncident()`
(`lib/refund-incidents/retry-incident.ts`).

### 5.5 Workflow producer self-refund au-delà du cap

`app/api/stripe/refund/route.tsx:149-251` : si `refundedByProducer` ET
`attempted > producerRefundCap()` (default 500€, env
`PRODUCER_REFUND_CAP_EUR`) → INSERT `pending_refunds` row + email admin
`admin_producer_refund_pending`. Réponse HTTP 202. L'admin tranche via
`/admin/refunds/pending` (helper `executeRefundFlow` avec `emittedBy='admin_approved_pending'`).

### 5.6 Côté producteur quand un refund est exécuté

3 cas selon `orders.transfer_id` :

1. `transfer_id IS NULL` (order non encore payoutée — `pending` ou
   cancelled pré-completion) : pas de reversal nécessaire, le producteur
   n'a jamais reçu les fonds. Le `stripe.refunds.create()` rend le
   montant au consommateur depuis la balance plateforme TerrOir.
2. `transfer_id` renseigné, `payouts.statut='paid'` mais payout Stripe
   pas encore exécuté : `stripe.transfers.createReversal()` débite le
   Connect account du producer (avant qu'il ne touche son IBAN).
3. `transfer_id` renseigné, payout déjà exécuté côté banque (Connect
   account vidé) : `transfers.createReversal()` peut échouer
   (`kind='failed'`), TerrOir absorbe 100% de la perte commerciale
   (commentaire `reverse-transfer.ts:12-18`) :
   > « TerrOir absorbe 100% perte commerciale (le producer a déjà
   > encaissé son net 94%, TerrOir paie 100% de remboursement). »

---

## 6. Rôle métier de `pickup_validated`

### 6.1 Émission

Helper : `lib/audit-logs/log-pickup-event.ts` — type
`pickup_validated` (`log-pickup-event.ts:32`).

Cluster pickup_* (5 events) : `pickup_preview_ok`,
`pickup_preview_invalid`, `pickup_validated`, `pickup_attempt_invalid`,
`pickup_attempt_rate_limited` (`log-pickup-event.ts:30-36`).

### 6.2 Côté DB — émission dans la même transaction que la transition

Le code TS appelle la RPC `complete_pickup_by_producer`
(`lib/orders/pickup-validation.ts:282-285`). Le commentaire en
`pickup-validation.ts:277-285` précise :

> « F-001 P0-TA : transition confirmed → completed via RPC SECDEF
> complete_pickup_by_producer (auth dispatch interne owner > admin >
> service_role + assertTransition + UPDATE atomique race-safe + audit
> log `pickup_validated` cluster pickup_* dans la même transaction). »

L'audit log est donc émis SQL-side dans la RPC `complete_pickup_by_producer`
(non lu en détail ici, mais la transition est `confirmed → completed`,
cf. `lib/orders/stateMachine.ts:26-31`).

### 6.3 Side-effects Stripe au moment de `pickup_validated`

**Aucun side-effect Stripe synchrone.** Le code TS de
`validatePickup` (`pickup-validation.ts:244-356`) ne touche pas l'API
Stripe : pas de `stripe.transfers.create`, pas de `stripe.payouts.*`,
pas de mise à jour de PI.

### 6.4 Rôle indirect dans le flow d'argent

La transition `confirmed → completed` posée par la RPC est la
**condition unique** pour qu'une order soit retenue par le cron
`weekly-payout` (`payouts.tsx:152-154` filtre
`statut='completed' AND completed_at IN [start..end]`).

Donc : `pickup_validated` est purement informatif côté audit log, mais
il est l'**enabler implicite** du transfer hebdo (sans `completed_at`,
l'order n'entre jamais dans la fenêtre du cron).

---

## 7. Webhooks Stripe et leurs handlers

Fichier handler racine : `app/api/stripe/webhook/route.tsx`.

Dispatch switch en `route.tsx:160-365`. Liste exhaustive des `event.type`
explicitement gérés :

| Event type                                | Handler / extracteur                                                                | Effets de bord principaux                                                                       |
|-------------------------------------------|--------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| `payment_intent.succeeded`                | `lib/stripe/handle-payment-succeeded.ts` + `lib/stripe/handle-payment-succeeded-notify.tsx` | RPC `revive_order_with_stock_check` (résurrection 3DS) ; audit log ; email + SMS producer ; refund si revival bloqué |
| `payment_intent.payment_failed`           | `lib/stripe/handle-payment-failed.ts`                                                | UPDATE order `closure_reason='payment_failed'`, transition cancelled, revalidate stats          |
| `account.updated`                         | `lib/stripe/sync-account-flags.tsx` + audit log `stripe_account_updated`             | UPDATE `producers.stripe_charges_enabled` / `stripe_payouts_enabled`                            |
| `payout.paid`                             | `lib/stripe/handle-payout-paid.ts`                                                   | UPDATE `payouts.statut='paid'` + `stripe_payout_id` ; audit log                                 |
| `charge.dispute.created`                  | `lib/stripe/handle-dispute-created.tsx`                                              | INSERT `disputes` + notifications + email URGENT admin                                          |
| `charge.dispute.updated`                  | `lib/stripe/handle-dispute-updated.ts`                                               | UPDATE `disputes.status`, audit log (pas d'email)                                               |
| `charge.dispute.closed`                   | `lib/stripe/handle-dispute-closed.tsx`                                               | UPDATE `disputes.status` + `closed_at` ; email résolution admin                                 |
| `payout.failed`                           | `lib/stripe/handle-payout-failed.tsx`                                                | UPDATE `payouts.statut='failed'` + `error_msg` ; audit ; email URGENT admin                     |
| `radar.early_fraud_warning.created`       | `lib/stripe/handle-early-fraud-warning.tsx`                                          | `stripe.refunds.create({reason:"fraudulent"})` pré-emptif + UPDATE order                        |
| `charge.refunded`                         | `lib/stripe/handle-charge-refunded.ts`                                               | Audit log forensique `stripe_charge_refunded_settled` (pas d'UPDATE business)                   |
| `account.application.deauthorized`        | `lib/stripe/handle-account-deauthorized.tsx`                                         | Reset flags producer + `statut='suspended'` + email URGENT admin                                |
| `charge.dispute.funds_withdrawn`          | inline `route.tsx:308-337`                                                           | Audit log `stripe_dispute_funds_withdrawn` (forensique uniquement)                              |
| `charge.dispute.funds_reinstated`         | inline `route.tsx:308-337`                                                           | Audit log `stripe_dispute_funds_reinstated` (forensique uniquement)                             |
| `default` (autres)                        | `route.tsx:356-365`                                                                  | `console.log [STRIPE_WEBHOOK_UNHANDLED]` ; pas d'effet de bord                                  |

Dédup : 14 event types dans le `DEDUP_TARGETS` (`route.tsx:103-136`)
via `webhook_events_processed` (PK = event_id).

Auth/protection : signature HMAC obligatoire (`route.tsx:85-92`),
IP allowlist en soft-warn (`route.tsx:65-70`), rate-limit IP-keyed
100/min (`route.tsx:42-57`).

Notable absent (par décision documentée en `route.tsx:115-119`) :
`transfer.failed` — Stripe Connect Express ne l'émet pas. L'échec
transfer est géré synchrone côté `lib/stripe/payouts.tsx:401-525`.

---

## 8. Schéma des tables money-flow

Source : `mcp__supabase__execute_sql` sur `information_schema.columns`
+ `pg_constraint`.

### 8.1 `orders` (colonnes liées au paiement)

| Colonne                     | Type                          | Nullable | Default            |
|-----------------------------|-------------------------------|----------|--------------------|
| `id`                        | uuid                          | NO       | `gen_random_uuid()`|
| `consumer_id`               | uuid                          | YES      | -                  |
| `producer_id`               | uuid                          | YES      | -                  |
| `statut`                    | text                          | YES      | `'pending'`        |
| `code_commande`             | text                          | YES      | -                  |
| `slot_id`                   | uuid                          | YES      | -                  |
| `date_retrait`              | date                          | YES      | -                  |
| `heure_retrait`             | time                          | YES      | -                  |
| `montant_total`             | numeric                       | YES      | -                  |
| `commission_terroir`        | numeric                       | YES      | -                  |
| `montant_net_producteur`    | numeric                       | YES      | -                  |
| `stripe_payment_intent_id`  | text                          | YES      | -                  |
| `transfer_id`               | text                          | YES      | -                  |
| `created_at`                | timestamptz                   | YES      | `now()`            |
| `confirmed_at`              | timestamptz                   | YES      | -                  |
| `completed_at`              | timestamptz                   | YES      | -                  |
| `cancelled_at`              | timestamptz                   | YES      | -                  |
| `closure_reason`            | text                          | YES      | -                  |
| `cgv_accepted_at`           | timestamptz                   | YES      | -                  |
| `cgv_version`               | varchar                       | YES      | -                  |
| `notes_client`              | text                          | YES      | -                  |

Contraintes :
- `orders_statut_check` : `statut IN ('pending','confirmed','completed','cancelled','refunded')`.
- `orders_code_commande_format_check` : `code_commande ~ '^TRR-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5,7}$'`.
- `orders_code_commande_key` : UNIQUE.

### 8.2 `payouts`

| Colonne                | Type        | Nullable | Default           |
|------------------------|-------------|----------|-------------------|
| `id`                   | uuid        | NO       | `gen_random_uuid()` |
| `producer_id`          | uuid        | YES      | -                 |
| `periode_debut`        | date        | YES      | -                 |
| `periode_fin`          | date        | YES      | -                 |
| `montant_brut`         | numeric     | YES      | -                 |
| `commission`           | numeric     | YES      | -                 |
| `montant_net`          | numeric     | YES      | -                 |
| `stripe_transfer_id`   | text        | YES      | -                 |
| `stripe_payout_id`     | text        | YES      | -                 |
| `statut`               | text        | YES      | `'pending'`       |
| `error_msg`            | text        | YES      | -                 |
| `created_at`           | timestamptz | YES      | `now()`           |
| `updated_at`           | timestamptz | NO       | `now()`           |

Contraintes :
- `payouts_statut_check` : `statut IN ('pending','processing','paid','failed')`.

### 8.3 `pending_refunds`

| Colonne            | Type                  | Nullable |
|--------------------|-----------------------|----------|
| `id`               | uuid                  | NO       |
| `order_id`         | uuid                  | NO       |
| `producer_id`      | uuid                  | NO       |
| `amount_eur`       | numeric               | NO       |
| `reason`           | text                  | YES      |
| `status`           | enum `pending_refund_status` | NO |
| `requested_at`     | timestamptz           | NO       |
| `decided_at`       | timestamptz           | YES      |
| `decided_by`       | uuid                  | YES      |
| `decision_reason`  | text                  | YES      |
| `created_at`       | timestamptz           | NO       |
| `updated_at`       | timestamptz           | NO       |

Enum `pending_refund_status` (introspect via `pg_enum`) :
`{pending, approved, denied, expired}`.

Contraintes : `pending_refunds_amount_eur_check` : `amount_eur > 0`.

### 8.4 `refund_incidents`

| Colonne                  | Type        | Nullable |
|--------------------------|-------------|----------|
| `id`                     | uuid        | NO       |
| `order_id`               | uuid        | NO       |
| `kind`                   | text        | NO       |
| `payment_intent_id`      | text        | NO       |
| `consumer_id`            | uuid        | YES      |
| `status`                 | text        | NO       |
| `retry_count`            | integer     | NO       |
| `max_retries`            | integer     | NO       |
| `last_error_code`        | text        | YES      |
| `last_error_message`     | text        | YES      |
| `blocked_reason`         | text        | YES      |
| `resolution_note`        | text        | YES      |
| `first_failed_event_at`  | timestamptz | NO       |
| `resolved_at`            | timestamptz | YES      |
| `created_at`             | timestamptz | NO       |
| `updated_at`             | timestamptz | NO       |

Contraintes :
- `refund_incidents_kind_check` : `kind IN ('revival','admin','timeout','manual_cancel')`.
- `refund_incidents_status_check` : `status IN ('pending','retrying','succeeded','exhausted','manually_resolved','aborted')`.
- `refund_incidents_order_id_kind_key` : UNIQUE `(order_id, kind)`.

### 8.5 `refund_incident_attempts`

| Colonne                | Type        | Nullable |
|------------------------|-------------|----------|
| `id`                   | uuid        | NO       |
| `refund_incident_id`   | uuid        | NO       |
| `attempt_number`       | integer     | NO       |
| `outcome`              | text        | NO       |
| `stripe_error_code`    | text        | YES      |
| `stripe_error_type`    | text        | YES      |
| `stripe_error_message` | text        | YES      |
| `stripe_request_id`    | text        | YES      |
| `stripe_refund_id`     | text        | YES      |
| `attempted_at`         | timestamptz | NO       |

### 8.6 `disputes`

| Colonne              | Type        | Nullable |
|----------------------|-------------|----------|
| `id`                 | uuid        | NO       |
| `order_id`           | uuid        | NO       |
| `stripe_dispute_id`  | text        | NO       |
| `stripe_charge_id`   | text        | YES      |
| `status`             | text        | NO       |
| `reason`             | text        | YES      |
| `amount`             | numeric     | NO       |
| `currency`           | text        | NO       |
| `evidence_due_by`    | timestamptz | YES      |
| `metadata`           | jsonb       | NO       |
| `created_at`         | timestamptz | NO       |
| `updated_at`         | timestamptz | NO       |
| `closed_at`          | timestamptz | YES      |

Contraintes :
- `disputes_status_check` : `status IN ('needs_response','under_review','won','lost','warning_closed','warning_needs_response','warning_under_review')`.
- `disputes_stripe_dispute_id_key` : UNIQUE.

---

## 9. CGV — ce qui est écrit sur le timing de paiement

Page CGV consumer : `app/(public)/cgv/page.tsx`. Version courante :
`LEGAL_VERSIONS.CGV = "1.0"` (`lib/legal/versions.ts:21`). Bandeau
placeholder global indique « CGV en cours de finalisation … contenu
définitif sera validé par un juriste avant le lancement officiel »
(`cgv/page.tsx:84-92`).

### 9.1 Débit consumer

Article 5.3 — `cgv/page.tsx:393-399` :

> « Le débit du compte de l'Acheteur intervient au moment de la
> validation de la Commande. »

### 9.2 Distribution des fonds

Article 5.4 — `cgv/page.tsx:401-417` :

> « Conformément au modèle d'intermédiation Stripe Connect :
> - L'Acheteur paie le montant total de la Commande
> - Stripe distribue les fonds : la commission TerrOir est prélevée,
>   le solde est versé au Producer
> - Le Producer perçoit son paiement selon le calendrier prévu par
>   Stripe Connect »

### 9.3 Calendrier de paiement producteur

Aucune mention explicite d'un calendrier « hebdomadaire lundi » dans
`cgv/page.tsx` (grep `hebdo|hebdomadaire|weekly|lundi|virement` sur
`app/(public)/cgv/page.tsx` → no matches).

Idem pour `app/(public)/devenir-producteur/page.tsx` (grep sur la même
liste de termes → no matches).

### 9.4 CGV producteur dédiée

**Non trouvable dans le code.** Aucun fichier `app/(producer)/cgv*`,
`docs/legal/`, `app/(public)/cgv-producteur*`. La seule page CGV est
B2C (article 2.3 : « Les CGV ne s'appliquent qu'aux ventes B2C…
auprès de personnes physiques majeures »).

### 9.5 Wording certifié

`lib/producers/declaration-veracite.ts` (mentionné dans CLAUDE.md
comme « wording certifié DGCCRF, immutable strict ») contient une
déclaration sur l'honneur producteur, pas un contrat sur le timing de
paiement.

---

## 10. Synthèse factuelle (5 lignes max)

1. Modèle = Separate Charges & Transfers : PI sur la plateforme sans
   `transfer_data` / `application_fee_amount` / `on_behalf_of`.
2. Transfer plateforme → Connect = cron Vercel `weekly-payout`
   (lundi 08:00 UTC) qui agrège les `orders.statut='completed'` de la
   semaine précédente Europe/Paris.
3. Payout Connect → IBAN = schedule par défaut Stripe (aucune config
   custom dans le code) ; observé via webhooks `payout.paid` /
   `payout.failed`.
4. Refund = `stripe.refunds.create()` (sans `reverse_transfer`) +
   clawback séparé `stripe.transfers.createReversal()` quand
   `orders.transfer_id` est renseigné.
5. `pickup_validated` = audit log côté RPC `complete_pickup_by_producer`
   sans side-effect Stripe direct ; il pose `statut='completed'` +
   `completed_at`, qui sont la condition d'entrée des orders dans le
   cron `weekly-payout`.
