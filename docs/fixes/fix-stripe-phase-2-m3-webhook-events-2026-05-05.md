# Fix Stripe phase 2 M-3 — webhook events utiles non abonnés (2026-05-05)

> Source audit : [`docs/audits/audit-stripe-2026-05-05.md`](../audits/audit-stripe-2026-05-05.md) §M-3.
> Périmètre phase 2 = subscribe les 3 webhook events à ROI positif identifiés
> dans l'audit (`radar.early_fraud_warning.created`, `charge.refunded`,
> `account.application.deauthorized`). Phase 3 (Connect v2 H-2, dynamic
> payment methods M-1, SDK + apiVersion bump H-1+H-3) déjà bouclée commit
> précédent.

## Synthèse

| Lot | Event Stripe | Fichiers principaux | Tests vitest |
|---|---|---|---|
| LOT 1 | `radar.early_fraud_warning.created` | `lib/stripe/handle-early-fraud-warning.tsx` + template `admin-early-fraud-warning.tsx` | 5/5 nouveau |
| LOT 2 | `charge.refunded` | `lib/stripe/handle-charge-refunded.ts` | 3/3 nouveau |
| LOT 3 | `account.application.deauthorized` | `lib/stripe/handle-account-deauthorized.tsx` + template `admin-account-deauthorized.tsx` | 3/3 nouveau |
| Switch + DEDUP | `app/api/stripe/webhook/route.tsx` (3 cases + 3 entrées DEDUP_TARGETS) | tests/app/api/stripe/webhook/route.test.tsx (mise à jour 1 test) | 15/15 |
| Audit logs | `lib/audit-logs/log-payment-event.ts` (3 nouveaux event_types) | n/a | n/a |
| LOT 5 E2E | `tests/e2e/stripe-webhooks-m3.spec.ts` | (Playwright, voir §E2E) | 2 actifs + 1 skip |

## Évolution vitest

| Avant | Après | Delta |
|---|---|---|
| 1662 tests / 143 fichiers | **1673 tests** / 144 fichiers | **+11 tests** |

Tous verts. Détail des +11 :
- Lot 1 : 5 tests (nominal refunded, no_order_match, already_refunded idempotent, refund_failed avec classification, fallback charge.retrieve quand PI absent).
- Lot 2 : 3 tests (path nominal logged + order_match, no_order_match orphelin, refund partiel amount_refunded < amount).
- Lot 3 : 3 tests (deauthorized nominal flags reset + suspended + email URGENT, no_producer_match, eventAccount manquant defensif).

## Évolution E2E Playwright

| Avant | Après | Delta |
|---|---|---|
| 1 spec stripe (smoke phase 3 SDK 22 + dahlia) | **2 specs stripe** (smoke phase 3 + webhooks-m3) | **+1 spec, +2 tests actifs** |

Cas EFW non couvert E2E (skip explicite). Justification : Stripe ne déclenche
pas EFW spontanément en test mode (signal Visa/MC réel uniquement). Couverture
unitaire suffisante (5 cases côté vitest dont les paths nominal/idempotent/
refund_failed).

---

## Détail par lot

### LOT 1 — Handler `radar.early_fraud_warning.created`

**Nouveau fichier** : `lib/stripe/handle-early-fraud-warning.tsx`.

Logique :
1. Lookup PaymentIntent associé via `efw.payment_intent` (priorité) ou
   `efw.charge` (fallback `stripe.charges.retrieve`).
2. Lookup `orders.id` via `stripe_payment_intent_id`.
3. Si `order.statut === 'refunded'` → idempotent, audit log seul (pas de
   2e refund).
4. Sinon : `stripe.refunds.create` avec `idempotencyKey: refund_${orderId}_efw`
   (cohérent conventions L-6 admin/timeout/revival).
5. UPDATE order `statut='refunded'`, `closure_reason='efw_preemptive'`,
   `cancelled_at=now()`.
6. Audit log forensique `stripe_early_fraud_warning_received` avec metadata
   étendue (efw_id, charge_id, payment_intent_id, order_id, fraud_type,
   actionable, order_match, refund_action, refund_id).
7. `waitUntil(sendTemplate(... admin EFW alert))` via SUPPORT_EMAIL.

**Cas d'erreur refund** : récupéré via `classifyRefundError` + `recordRefundAttempt`
(`kind='admin'` faute de kind dédié EFW en V1) pour cohérence avec le pattern
T-102.2.b. Audit log avec `refund_action: 'failed'`, `refund_error_category`.

**Logs greppables** : `[STRIPE_EFW_RECEIVED]`, `[STRIPE_EFW_NO_ORDER]`,
`[STRIPE_EFW_ALREADY_REFUNDED]`, `[STRIPE_EFW_REFUND_FAILED]`,
`[STRIPE_EFW_CHARGE_FETCH_ERR]`, `[STRIPE_EFW_UPDATE_ERR]`, `[STRIPE_EFW_NO_PI]`.

**Nouveau template** : `lib/resend/templates/admin-early-fraud-warning.tsx`
(subject `[TerrOir Admin] ⚠️ Early Fraud Warning — refund pré-emptif émis`,
encart fraud_type + actionable + montant + refund_id + lien Dashboard
Stripe Radar).

### LOT 2 — Handler `charge.refunded`

**Nouveau fichier** : `lib/stripe/handle-charge-refunded.ts`.

**Décision autonome (vs brief initial)** : aucune table `refunds` n'existe
dans le schéma TerrOir V1. Les refunds vivent dans :
- `audit_logs` (event `order_admin_refund_*`, `order_revival_blocked_*`,
  `order_producer_refund_*`) posés à l'émission, pour forensique RGPD/PCI ;
- `refund_incidents` + `refund_incident_attempts` (T-102) pour le retry
  workflow des échecs.

Le settlement Stripe est une info forensique additionnelle, pas un état
business critique. **Pas de migration ajoutée**. Si V1.x nécessite une
colonne `settled_at` dédiée (audit comptable plus formel), candidat naturel
= `refund_incident_attempts.settled_at` (UPDATE WHERE `stripe_refund_id =
charge.refunds.data[*].id`).

Logique :
1. Lookup order via `charge.payment_intent` (string ou objet expandé).
2. Audit log `stripe_charge_refunded_settled` avec metadata (charge_id,
   payment_intent_id, order_id, amount, amount_refunded, currency, refunded
   bool, refund_count, last_refund_id, order_match).

**Logs greppables** : `[STRIPE_CHARGE_REFUNDED]`, `[STRIPE_CHARGE_REFUNDED_NO_ORDER]`.

### LOT 3 — Handler `account.application.deauthorized`

**Nouveau fichier** : `lib/stripe/handle-account-deauthorized.tsx`.

**Contrat Stripe à noter** : sur cet event, `event.data.object` est en
réalité un `Stripe.Application` (l'app OAuth/Connect côté plateforme), PAS
un `Account`. Le Connect account déauthorisé est référencé via
`event.account` (Connect-stamped account header). Signature du handler :
`(application: { id, object } | null, eventAccount: string | null, admin)`.

Logique :
1. Lookup producer via `stripe_account_id = event.account`.
2. UPDATE producers : reset les 4 flags Stripe (`stripe_account_id=null`,
   `stripe_charges_enabled=false`, `stripe_payouts_enabled=false`,
   `stripe_details_submitted=false`) + `statut='suspended'`.
3. Audit log forensique `stripe_account_deauthorized`.
4. INSERT notifications placeholder admin.
5. `waitUntil(sendTemplate(... admin URGENT))` via SUPPORT_EMAIL.

**Choix `statut='suspended'`** : enum supporté (`draft`, `pending`, `active`,
`public`, `suspended`). `suspended` correspond exactement à l'état "Connect
désautorisé, ne peut plus recevoir de paiements". Admin peut ré-onboarder
via `/api/stripe/connect/onboard` (création nouveau `acct_*`).

**Logs greppables** : `[STRIPE_ACCOUNT_DEAUTHORIZED]`,
`[STRIPE_ACCOUNT_DEAUTHORIZED_NO_PRODUCER]`,
`[STRIPE_ACCOUNT_DEAUTHORIZED_NO_ACCOUNT]`,
`[STRIPE_ACCOUNT_DEAUTHORIZED_UPDATE_ERR]`,
`[STRIPE_ACCOUNT_DEAUTHORIZED_EMAIL_ERR]`.

**Nouveau template** : `lib/resend/templates/admin-account-deauthorized.tsx`
(subject `[TerrOir Admin] 🚨 URGENT — Connect account déconnecté`, action
admin = contacter producer, proposer ré-onboarding, vérifier orders pending).

### Switch webhook + DEDUP_TARGETS

`app/api/stripe/webhook/route.tsx` :
- 3 nouveaux imports (handlers).
- 3 nouvelles entrées `DEDUP_TARGETS` (toutes avec effets de bord
  persistés : refund Stripe + UPDATE order pour EFW, audit log seul pour
  charge.refunded settlement, UPDATE producer flags + email URGENT pour
  account.application.deauthorized).
- 3 nouveaux `case` avant le `default`.

**Test impacté** : `tests/app/api/stripe/webhook/route.test.tsx` testait
"`charge.refunded` (hors DEDUP_TARGETS) → no-op default case". Remplacé
par `customer.created` (resté volontairement hors switch — TerrOir crée
ses customers explicitement, l'event webhook est redondant).

### Audit logs

`lib/audit-logs/log-payment-event.ts` : ajout de 3 event_types au tableau
`PAYMENT_EVENT_TYPES` (source-of-truth typage `PaymentEventType` dérivé via
`(typeof ...)[number]`) :
- `stripe_early_fraud_warning_received`
- `stripe_charge_refunded_settled`
- `stripe_account_deauthorized`

---

## LOT 4 — Vérification config Dashboard Stripe

### État du MCP Stripe

Le MCP Stripe `read-only` connecté au compte `acct_1TNw9nGuakpserKp`
("Environnement de test TerrOir") **n'expose pas l'opération
`GetWebhookEndpoints`** (testé : 4 opérations webhook trouvées sont
`coupons`/`payment_links`/`promotion_codes`/`prices`, aucune ne match
`webhook_endpoints`).

**Conséquence** : impossible de lister automatiquement les `enabled_events`
de l'endpoint webhook côté Dashboard pour cross-checker avec les
`DEDUP_TARGETS` du code. Vérification manuelle requise par Romain.

### Liste exacte à cocher pour Romain

URL Dashboard Stripe (test mode) :
https://dashboard.stripe.com/test/workbench/webhooks

**Events déjà attendus côté code (ne pas décocher)** :

```
payment_intent.succeeded
payment_intent.payment_failed
account.updated
payout.paid
payout.failed
charge.dispute.created
charge.dispute.updated
charge.dispute.closed
```

**Events à AJOUTER (Phase 2 M-3)** :

```
radar.early_fraud_warning.created
charge.refunded
account.application.deauthorized
```

À répliquer dans le Dashboard **live** au moment du go-live (les endpoints
test et live sont distincts côté Stripe).

---

## LOT 5 — Smoke E2E Playwright

**Nouveau fichier** : `tests/e2e/stripe-webhooks-m3.spec.ts`.

Approche : POST direct sur `/api/stripe/webhook` avec payload signé via
`stripe.webhooks.generateTestHeaderString` + secret local
`STRIPE_WEBHOOK_SECRET` (= `placeholder` dans `.env.local`). Self-contained,
pas de dépendance Stripe CLI `stripe listen`.

### 2 tests actifs

1. **`charge.refunded → audit log stripe_charge_refunded_settled posé`** :
   crée producer + consumer + slot + order avec `stripe_payment_intent_id`
   fixé, POST webhook signé, vérifie qu'un row `audit_logs` avec
   `event_type='stripe_charge_refunded_settled'` et metadata `charge_id`
   et `order_id` matchant existe.

2. **`account.application.deauthorized → producer flags reset + statut=
   suspended`** : crée producer + Connect account réel via
   `stripe.accounts.create`, seed les 3 flags Stripe à `true`, POST webhook
   signé avec `event.account = acct_*`, vérifie en DB que les 4 flags sont
   reset + `statut='suspended'`. Cleanup `stripe.accounts.del` post-test.

### 1 test skip explicite

`radar.early_fraud_warning.created` : non testé E2E. Justification :
Stripe ne déclenche pas EFW spontanément en test mode (signal Visa/MC
réel). Simulation webhook signé serait artificielle (id `issfr_*` non
listé dans Dashboard Stripe). Couverture unitaire suffisante via
`tests/lib/stripe/handle-early-fraud-warning.test.ts` (5 cases dont
nominal/idempotent/refund_failed).

---

## Trade-offs et décisions autonomes

| Décision | Choix | Justification |
|---|---|---|
| Migration `refunds.settled_at` | **Pas de migration** | Aucune table `refunds` n'existe. `audit_logs` suffit pour forensique comptable en V1. Si V1.x nécessite, candidat naturel = `refund_incident_attempts.settled_at`. |
| Statut producer post-deauthorize | **`suspended`** (vs `pending_review` du brief) | `pending_review` n'existe pas dans l'enum. `suspended` (présent dans CHECK) match l'état "Connect désautorisé, action admin requise". |
| Type EFW handler `kind` côté refund_incidents | **`kind='admin'`** | L'enum `RefundKind = 'revival'\|'admin'\|'timeout'`. Pas de `'efw'` en V1 (sinon migration enum à pousser). `'admin'` est le plus proche (path piloté côté plateforme). |
| Fallback charge.retrieve EFW | **Implémenté** | EFW peut arriver sans `payment_intent` direct, seulement charge. Quota Stripe minimal (1 retrieve par EFW). |
| Cas EFW E2E Playwright | **Skip explicite** | Stripe ne trigger pas EFW en test mode. Test signé artificiel sans payload réel. Couverture unitaire suffisante. |

---

## Backlog ouvert (non scopé phase 2 M-3)

- **`capability.updated`** (audit Stripe annexe A LOW) : granularité fine
  vs `account.updated` (agrégat). Utile si SEPA/BACS activé un jour.
- **`payment_method.{attached,detached}`** : sync `/compte/paiements` UI
  (pour V1.1 si pageview Stripe round-trips deviennent un coût).
- **`transfer.{created,reversed}`** : `transfer.created` redondant
  (synchrone côté `processWeeklyPayouts`). `transfer.reversed` rare,
  ajouter si dérive `payouts.statut='paid'` observée.
- **Migration `refund_incident_attempts.settled_at`** : si l'audit
  comptable demande une colonne dédiée (vs metadata audit_logs).
- **`kind='efw'` dans `refund_incidents`** : si EFW devient un volume
  significatif post-go-live, séparer le retry workflow du `kind='admin'`
  (CHECK enum extension + audit log dédié).
