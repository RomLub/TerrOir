# Audit Stripe phase A — 2026-05-05

**Source live** : MCP Stripe `read-only` sur compte test `acct_1TNw9nGuakpserKp` ("Environnement de test TerrOir").
**Source repo** : `lib/stripe/**` (13 modules), `app/api/stripe/**` (5 routes), `app/api/cron/{order-timeout,retry-failed-refunds,weekly-payout}/**`.
**Périmètre** : intégration Stripe applicative côté API Stripe (config Connect, customers, PI, refunds, webhooks, payouts, API version, test/live boundary).
**Hors périmètre** (déjà bouclés) : signature webhook, idempotence applicative, dédup Stripe→DB, RPC `revive_order_with_stock_check`, `record_refund_attempt` — cf. [audit-rpc-edge-2026-05-05.md](./audit-rpc-edge-2026-05-05.md).

> Audit phase A = dette technique avant go-live (~2 mois). Conformité PCI/SCA fine = phase B post-go-live.
> Aucune modification appliquée. Liste pour arbitrage.

---

## Synthèse priorisée

| Sévérité | Compte | Type d'enjeu                                                                                                  |
|----------|:------:|---------------------------------------------------------------------------------------------------------------|
| CRITICAL |   0    | (les 2 CRITICAL `revive_order_with_stock_check` / `record_refund_attempt` sont DB — voir audit RPC §C-1, C-2) |
| HIGH     |   3    | API version pinned 14 mois behind, SDK 5 majors behind, Connect Express via `type` legacy v1                  |
| MEDIUM   |   6    | `payment_method_types: ['card']` hardcodé, refund revival sans idempotency-key, pas de guard pré-PI charges_enabled (mitigé), webhook events utiles non abonnés (radar EFW, charge.refunded), pas de monitoring deadline disputes, test/live customer ID drift |
| LOW      |   6    | IP allowlist webhook absente, `business_type: 'individual'` hardcodé, Apple/Google Pay non configurés, schedule `order-timeout` daily vs commentaire "hourly", refund producer sans cap montant, conventions idempotency-key non documentées |

---

## Verdict opérationnel (5 points clés)

1. **L'intégration applicative est solide** : les 3 patterns critiques (idempotency-key PI/refund/transfer, dédup webhook, anti-race customer/PI persist, guard rétrogradation `confirmed→cancelled`) sont éprouvés et bien documentés inline. Aucune fuite secret/test→live détectée. Pas de Charges API, pas de Sources/Token deprecated.
2. **Le risque le plus tangible avant go-live est l'API version `2025-02-24.acacia`** pinned dans `lib/stripe/server.ts:10`, soit 14 mois et 5 majors derrière `2026-04-22.dahlia`. Idem SDK : `stripe@17.7.0` vs `22.1.0` latest, `@stripe/stripe-js@4.10.0` vs `9.4.0`. Upgrade obligatoire AVANT bascule live (pas après) pour éviter de cumuler bug de version + bug d'environnement.
3. **L'onboarding Connect utilise toujours `type: "express"`** (Accounts v1 legacy), pattern explicitement déconseillé par stripe-best-practices 2026 ("Don't use the legacy `type` parameter for new platforms"). Pas bloquant pour go-live (Accounts v1 reste supporté), mais TerrOir part déjà en dette technique le jour du lancement. Migration vers Accounts v2 + controller properties = 4-8h de boulot, à arbitrer maintenant ou en V1.1.
4. **Quelques events webhook utiles ne sont pas abonnés** : `radar.early_fraud_warning.created` (signal Visa/MC AVANT le dispute, refund pré-emptif évite ~15$ chargeback fee + perte commerce), `charge.refunded` (settlement réel vs création), `account.application.deauthorized` (producer disconnect). Pas critique mais ROI positif pour go-live.
5. **Aucun finding CRITICAL applicatif** côté API Stripe. Les 2 CRITICAL ouvertes (`revive_order_with_stock_check` et `record_refund_attempt` exposées PUBLIC) sont du périmètre RLS/RPC déjà bouclé — voir audit-rpc-edge §C-1, C-2.

---

# CRITICAL

Aucun finding critical détecté sur le périmètre Stripe API applicatif. Les 2 CRITICAL existantes (RPC exposées PUBLIC sans garde) restent ouvertes côté audit RPC §C-1, C-2 — non re-priorisées ici.

---

# HIGH

## H-1 — `apiVersion: "2025-02-24.acacia"` pinned 14 mois en arrière, à upgrader AVANT go-live

**Files** : `lib/stripe/server.ts:10`, `scripts/backfill-stripe-connect-flags.ts:65`, `scripts/audit-cleanup-orphan-customers.ts:118`, `scripts/audit-cleanup-orphan-pms.ts:87`.

```ts
// lib/stripe/server.ts:9-12
export const stripe = new Stripe(stripeSecret, {
  apiVersion: "2025-02-24.acacia",
  typescript: true,
});
```

**Preuve API version dispo** : skill stripe-best-practices = "Latest Stripe API version: **2026-04-22.dahlia**. Always use the latest API version and SDK unless the user specifies otherwise." 14 mois entre `acacia` (2025-02-24) et `dahlia` (2026-04-22) ; 5 releases majeures intermédiaires.

**Preuve SDK** :

```
$ npm view stripe version
22.1.0
$ npm ls stripe
└── stripe@17.7.0
```

5 majors derrière. Idem côté frontend : `@stripe/stripe-js@4.10.0` vs `9.4.0` latest.

**Impact go-live** :
- Tout schema des objets retournés (`PaymentIntent`, `Account`, `Dispute`, `Payout`) suit la version pinned. Le code TerrOir parse ces objets directement (ex. `payout.source_transaction`, `dispute.evidence_details.due_by`, `account.charges_enabled`). Une upgrade mid-prod = breaking changes potentiels sur ces champs.
- Les webhook events sont rendus au format de la version `apiVersion` du compte au moment de l'event (cf. https://docs.stripe.com/upgrades). Si la version compte Dashboard est upgradée mais le SDK reste sur `acacia`, on paie le coût de divergence sur **tous les events historiques rejoués**.
- Stripe a une politique de support 12 mois après une release. `acacia` (Feb 2025) sortira de support nominal autour de Feb 2026 → on est déjà sur fenêtre tail (mai 2026 = 15 mois après).

**Stratégie d'upgrade recommandée** :
1. Bump SDK `stripe@17.7.0 → 22.x` + `@stripe/stripe-js@4.10.0 → 9.x` (séquencer en 2 PR séparés, breaking TS likely).
2. Bump `apiVersion: "2026-04-22.dahlia"` dans `lib/stripe/server.ts:10` + 3 scripts.
3. Re-run la suite de tests Stripe (`tests/lib/stripe/**`, `tests/app/api/stripe/**`).
4. Smoke test bout-en-bout sur compte test (création PI, 3DS retry, refund, dispute simulée).
5. Bump version Dashboard Stripe en parallèle (Workbench → Overview → API versions → Upgrade) pour aligner les rendus webhook.

**Coût estimé** : 4-8h sur le dahlia changelog + breaking changes TS éventuels. **Avant go-live** : impératif. Cumuler bug de version + bug d'env live = doublement du périmètre de debug en prod.

## H-2 — Connect onboarding via `type: "express"` (Accounts v1 legacy) ≠ best-practice 2026

**File** : `app/api/stripe/connect/onboard/route.ts:33-42`.

```ts
const account = await stripe.accounts.create({
  type: "express",
  country: "FR",
  email: session.email ?? undefined,
  capabilities: {
    card_payments: { requested: true },
    transfers: { requested: true },
  },
  business_type: "individual",
});
```

**Preuve best-practice** : skill stripe-best-practices `references/connect.md:14` =

> **Traps to avoid:** Don't use the legacy `type` parameter (`type: 'express'`, `type: 'custom'`, `type: 'standard'`) in `POST /v1/accounts` for new platforms unless the user has explicitly requested v1.

Pour les nouvelles plateformes Connect, Stripe pousse :
- **Accounts v2 API** (`POST /v2/core/accounts`) → actively invested path.
- **Controller properties** (`controller.losses.payments`, `controller.fees.payer`, `controller.stripe_dashboard.type`, `controller.requirement_collection`) → choix explicite par dimension vs label opaque "Express".

Quand on crée un Express via `type`, Stripe set `controller.fees.payer = "application_express"` (variant interne) au lieu de `"application"` que poseraient les controller properties — discrimination tracée pour fee billing. Side effect : si TerrOir veut un jour ajouter Direct charges, le `application_express` change la facturation Stripe vs `application` pur.

**Impact go-live** :
- Accounts v1 + `type` reste **supporté** pour les comptes existants → pas de bloqueur immédiat.
- Mais : TerrOir crée son premier producer Connect le jour J du go-live. Au lieu de partir clean sur v2, on part en dette de migration. La migration v1→v2 est elle-même supportée (cf. https://docs.stripe.com/connect/accounts-v2/migrate-integration) mais c'est un chantier dédié à V1.1 ou plus tard.
- Le Dashboard Stripe pousse depuis 2025 vers v2 ; Stripe Connect support team va systématiquement nous demander pourquoi on est en v1.

**Décision à arbitrer maintenant** :
- **Option A** (recommandée pour go-live propre) : refacto avant prod = ~6-12h. `stripe.v2.core.accounts.create({ ... defaults: { responsibilities: { fees_collector: "application", losses_collector: "application" }}, dashboard: "express" })`. Keep le flow `accountLinks.create` côté onboarding. Tests à re-écrire.
- **Option B** (pragmatique) : keep `type: "express"`, créer un ticket V1.1 explicite + commentaire dans `onboard/route.ts` "TODO V1.1 migration Accounts v2". Aligné avec la décision interne "tolérance dette pour accélérer delivery" (cf. CLAUDE.md global).

**Side note Connect liability** : skill `references/security.md:101` =

> Platform operators bear financial liability for fraud and disputes on Express and Custom connected accounts. Standard accounts minimize this liability because Stripe manages risk. Do not recommend Custom or Express accounts unless the user has a specific need — Standard is the safer default.

TerrOir Express → la plateforme paye les chargebacks. Audit perte attendue : avec ~5% de fraude carte en France et 1% de chargeback rate sur food/local marketplaces, sur 1k commandes/mois à 25€ panier moyen = ~250€/mois de pertes potentielles + 15€ Stripe dispute fee × N. Pour un MVP, c'est gérable. Pour scale, considérer Standard accounts.

## H-3 — SDK `stripe@17.7.0` (5 majors derrière) + `@stripe/stripe-js@4.10.0` (5 majors derrière)

**File** : `package.json` (résolu par `npm ls`).

```
+-- @stripe/react-stripe-js@2.9.0
| `-- @stripe/stripe-js@4.10.0 deduped
+-- @stripe/stripe-js@4.10.0
`-- stripe@17.7.0
```

**Latest npm** :
- `stripe@22.1.0` (latest), beta `18.6.0-alpha.2`, public-preview `22.2.0-beta.2`.
- `@stripe/stripe-js@9.4.0` (latest).

**Implications** :
- TS types dérivent de la version pinned du SDK. Toute migration `apiVersion` (cf. H-1) devient bloquée si le SDK ne supporte pas le version string `2026-04-22.dahlia` — il ne le supportera pas en v17.
- Stripe.js v4 → v9 : breaking changes sur `loadStripe()`, `Elements`, gestion du `clientSecret`, support natif du Payment Element nouvelle génération. Le composant `getStripe()` (`lib/stripe/client.ts`) à re-tester.
- Versions LTS Node compatibles : Stripe v22 supporte Node 18+, OK pour Vercel Node 20.

**Fix** : couplé avec H-1, séquence recommandée = 1) bump SDK + Stripe.js, 2) bump `apiVersion`, 3) re-run tests, 4) bump dashboard. Ne pas faire dans la même PR.

---

# MEDIUM

## M-1 — `payment_method_types: ["card"]` hardcodé → désactive Apple Pay, Google Pay, SEPA (et Link, intentionnellement)

**File** : `app/api/stripe/create-payment-intent/route.ts:131-143`.

```ts
pi = await stripe.paymentIntents.create(
  {
    amount,
    currency: "eur",
    customer: customerId,
    payment_method_types: ["card"],
    ...(setupFutureUsage && { setup_future_usage: setupFutureUsage }),
    metadata: { ... },
  },
  { idempotencyKey: `pi_create_${order.id}` },
);
```

Le commentaire l. 119-122 documente la décision pour Link :

> `payment_method_types: ["card"]` explicite → désactive le default `automatic_payment_methods` qui activerait Link dans le Payment Element. Notre propre système de cartes sauvegardées (Stripe Customer) couvre le besoin sans la friction Link.

**Préoccupation** : la décision a été prise contre Link explicitement, mais le `["card"]` désactive **aussi** Apple Pay, Google Pay, SEPA Debit, Bancontact, etc. — pas mentionnés dans le commentaire. En France :
- Apple Pay = 25-35% de checkout mobile sur food/marketplace en 2025.
- Google Pay = 8-15% supplémentaires (Android).
- SEPA Direct Debit = preferred sur paniers >50€ (no card fees côté consumer).

**Preuve best-practice** : skill payments.md `:42-44` =

> Advise users to enable dynamic payment methods in the Stripe Dashboard rather than passing specific `payment_method_types` in the PaymentIntent or SetupIntent. Stripe automatically selects payment methods based on the customer's location, wallets, and preferences when the Payment Element is used.

**Impact business estimé (à valider Romain)** : sur un funnel mobile de 500 visites/jour avec 30% Apple Pay propension, conversion mobile potentiellement -10 à -20%.

**Fix recommandé** :
- Activer dynamic payment methods côté Dashboard Stripe.
- Passer `automatic_payment_methods: { enabled: true, allow_redirects: 'never' }` au PI create. `allow_redirects: 'never'` filtre out les méthodes redirect-based si on veut garder le flow checkout single-page.
- Si Link reste indésirable : Dashboard a un toggle dédié pour le désactiver côté compte sans hardcoder les types.
- Apple Pay nécessite **domain verification** (cf. L-3) — préparer en parallèle.

## M-2 — Refund path `revival` n'utilise pas d'idempotency-key

**File** : `lib/stripe/handle-payment-succeeded.ts:211`.

```ts
try {
  await stripe.refunds.create({ payment_intent: paymentIntent.id });
  // ...
} catch (refundErr) {
  // ...
}
```

Comparé aux 2 autres paths refund, qui sont tous deux idempotents :

```ts
// app/api/stripe/refund/route.ts:87-90 (admin)
refund = await stripe.refunds.create(
  { payment_intent: order.stripe_payment_intent_id },
  { idempotencyKey: `refund_${order.id}_admin` },
);

// app/api/cron/order-timeout/route.tsx:118-121 (timeout)
await stripe.refunds.create(
  { payment_intent: order.stripe_payment_intent_id },
  { idempotencyKey: `refund_${order.id}_timeout` },
);
```

Le path `revival` (résurrection 3DS-retry bloquée par stock/slot) émet un refund Stripe inline dans le webhook handler, sans idempotency-key.

**Test mental rejouage** :
- Stripe re-émet `payment_intent.succeeded` (rare mais possible).
- Notre dédup applicative `webhook_events_processed` (PK `event_id`) attrape le rejouage AVANT le code revival → pas de 2e refund. ✅
- Mais : si la table `webhook_events_processed` perd un row (purge erronée, migration), ou si le rejouage arrive entre l'INSERT dédup et le code refund (timing impossible en pratique mais mentale-modèle-wise), un 2e refund peut être tenté.
- Stripe API renverra `charge_already_refunded` côté serveur, mais le `await stripe.refunds.create(...)` aura quand même fait un round-trip + log d'incident côté Stripe Dashboard.

**Severity MEDIUM** : defense-in-depth, pas un bug exploitable. La dédup applicative T-103 fait l'essentiel du job.

**Fix recommandé** : aligner avec les 2 autres paths.

```ts
await stripe.refunds.create(
  { payment_intent: paymentIntent.id },
  { idempotencyKey: `refund_${orderId}_revival` },
);
```

Cohérent avec le contrat documenté dans audit RPC §L-2 (idempotency-key conventions).

## M-3 — Webhook events utiles non abonnés : `radar.early_fraud_warning.created`, `charge.refunded`, `account.application.deauthorized` ✅ FIXED (Phase 2)

> **Statut 2026-05-05** : FIXED côté code TerrOir. 3 handlers + 3 audit logs +
> 2 templates email + 11 nouveaux tests vitest + 1 spec Playwright (2 actifs).
> Cf. [`docs/fixes/fix-stripe-phase-2-m3-webhook-events-2026-05-05.md`](../fixes/fix-stripe-phase-2-m3-webhook-events-2026-05-05.md).
> **Action restante côté Dashboard Stripe** : cocher les 3 events dans
> l'endpoint webhook test ET live (impossible automatiquement via MCP, le
> tooling Stripe MCP n'expose pas `webhook_endpoints`).

**File** : `app/api/stripe/webhook/route.tsx:104-465` (switch sur `event.type`).

Events actuellement traités :
- `payment_intent.succeeded`, `payment_intent.payment_failed`
- `account.updated`
- `payout.paid`, `payout.failed`
- `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`

**Events manquants notables** :

| Event manquant                              | Pourquoi le subscribir                                                                                                                                                                                                                                                                              | Severity |
|---------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------|
| `radar.early_fraud_warning.created`         | Visa/MC notifient Stripe d'une potentielle fraude AVANT que le client ouvre un dispute. Permet refund pré-emptif → évite chargeback fee (15€ FR) + dispute. ROI : si on a 3-5 EFW/mois, on économise ~50€/mois.                                                                                  | MEDIUM   |
| `charge.refunded`                           | Confirme que le refund a été settled côté Stripe (vs `refund.created` qui est juste l'émission). Permet de poser `refunds.settled_at` dans la DB pour audit comptable. Aujourd'hui on log `order_admin_refund_succeeded` à l'émission, pas au settle.                                            | MEDIUM   |
| `account.application.deauthorized`          | Producer disconnecte son Connect account depuis Dashboard Stripe (rare mais possible — perte de confiance, bug, etc.). Sans handler, `producer.stripe_account_id` reste figé en DB et le prochain transfer va échouer en `account_invalid`.                                                      | LOW→MED  |
| `capability.updated`                        | Granularité plus fine que `account.updated`. Si SEPA est activé un jour, le statut `sepa_debit_payments` arrivera ici. Aujourd'hui on lit seulement `charges_enabled`/`payouts_enabled` qui sont l'agrégat.                                                                                       | LOW      |
| `payment_method.attached` / `detached`      | Synchroniser l'état des CB sauvegardées entre Stripe et l'UI `/compte/paiements`. Aujourd'hui la liste est lue à chaque pageview via `paymentMethods.list` → OK pour V1, mais round-trip Stripe à chaque rendu.                                                                                  | LOW      |
| `transfer.created` / `transfer.reversed`    | TerrOir crée des transfers via cron (synchrone), donc `transfer.created` est redondant. `transfer.reversed` arrive si Stripe rollback un transfer (très rare, ex. fraude détectée post-fait). Sans handler, drift `payouts.statut='paid'` mais argent côté plateforme.                          | LOW      |

**Fix recommandé** :
- Phase A (avant go-live) : ajouter `radar.early_fraud_warning.created` (alerte admin email + log audit) et `charge.refunded` (UPDATE `refunds.settled_at` + audit log `stripe_charge_refunded`).
- Phase B (go-live polish) : ajouter `account.application.deauthorized` avec UPDATE `producers.stripe_account_id = null` + `stripe_charges_enabled = false` + alerte admin.
- Phase C (post-launch) : `capability.updated`, `transfer.reversed`, `payment_method.{attached,detached}` selon dérives observées.

Toutes ces additions doivent passer par la `DEDUP_TARGETS` du switch dans le webhook handler (effets de bord persistés).

## M-4 — Pas de monitoring `evidence_due_by` sur disputes ouverts

**File** : `lib/stripe/handle-dispute-created.tsx:42-223`.

Le handler `charge.dispute.created` envoie correctement un email urgent à `SUPPORT_EMAIL` au moment de la création (l. 205-221). Le `evidence_due_by` est passé dans le template. Mais après cet email initial :
- **Aucune relance auto** si l'admin ne traite pas le dispute.
- Si Stripe ne reçoit pas l'evidence avant la deadline (~21 jours sur Visa/MC, plus court sur Amex) → **auto-loss** côté plateforme : argent retiré + commission Stripe perdue + chargeback fee 15€.

**Test mental** : Romain part en vacances 3 semaines, ne lit pas l'email, dispute auto-perdu. La perte serait d'autant plus grosse que le dispute concerne potentiellement plusieurs commandes (montant cumulé) si l'attaquant a fraudé en série.

**Fix recommandé (effort faible)** :
- Cron daily check : `SELECT * FROM disputes WHERE status='needs_response' AND evidence_due_by < now() + interval '3 days'` → email relance admin.
- Bonus : `SELECT * FROM disputes WHERE status='needs_response' AND evidence_due_by < now() + interval '24 hours'` → SMS Twilio + email "URGENT".

Pas une faille technique, mais un risque opérationnel concret pour go-live.

## M-5 — Cohérence DB ↔ Stripe : `users.stripe_customer_id` et `producers.stripe_account_id` n'ont pas de discriminant test/live

**Files** : `supabase/migrations/20260422310000_add_stripe_customer_id_to_users.sql`, `supabase/migrations/20260424000000_producers_stripe_connect_flags.sql`.

```sql
alter table public.users add column stripe_customer_id text;
-- (extrait, simplifié)
alter table public.producers add column stripe_account_id text;
```

Schéma cible un seul Stripe environnement à la fois. **Au moment du go-live**, si on bascule la prod Vercel sur les clés `sk_live_*` SANS purger les `stripe_customer_id` test existants en DB, l'app va tenter de retrieve `cus_*` test sur l'API live → 404 → race :
- `getOrCreateStripeCustomer()` (`lib/stripe/customer.ts:35`) lit `stripe_customer_id` existant et le retourne sans recréer. Donc le PI subséquent va référencer un customer inexistant → erreur Stripe `resource_missing` au paiement.

**Spot-check MCP** : 4 customers test trouvés (`cus_UQShfF92OYpIgP`, `cus_UOoKFU9IIk6NFZ`, `cus_UNjJChcYlU879g`, `cus_UMfaaMmcCd9BHP`) — tous valides en test. Aucun moyen via DB de savoir s'ils sont test ou live.

**Risque exposition** : aucun (pas de fuite secret), juste un 500 sur le premier paiement live de chaque user existant.

**Fix recommandé pour go-live** :
- **Option 1** (la plus simple) : migration one-shot le jour J = `UPDATE users SET stripe_customer_id = NULL` + `UPDATE producers SET stripe_account_id = NULL, stripe_charges_enabled = false, stripe_payouts_enabled = false, stripe_details_submitted = false`. Tous les users repartent sur un customer/account live propre. Coût UX : producers doivent re-onboard Connect (5min) ; consumers ne voient rien (le customer est créé au prochain checkout).
- **Option 2** (plus tracking) : ajouter une colonne `stripe_env text not null default 'test' check (stripe_env in ('test','live'))` + filtrer en lecture/écriture selon `process.env.STRIPE_ENV`. Plus propre mais plus de code.
- **Option 3** : rester en test mode jusqu'à un cutover hard. Migration prod = baseline propre dès le début (rare possibilité).

À choisir avant go-live. Documenter la décision dans le runbook de bascule.

## M-6 — Pas de guard pré-PI sur `producer.stripe_charges_enabled` (mais mitigé)

**File** : `app/api/stripe/create-payment-intent/route.ts` ne vérifie pas `producers.stripe_charges_enabled` avant de créer le PI.

**Mitigation existante (à confirmer)** : `lib/producers/promote-to-public.ts:38-47` empêche un producer non-charges-enabled d'apparaître en `statut='public'`. La création d'order côté consumer (`/api/orders/create`) passe par RLS qui filtre sur `statut='public'`. Donc en pratique :
- Consumer ne peut pas créer d'order pour un producer non-charges-enabled.
- Pas de PI à créer sur un producer pas prêt.

**Cas limite** : un producer charges_enabled au moment de l'order, mais qui perd la capability ENTRE order create et PI create (latence webhook, KYC re-flagged) → PI créé sur un producer non-chargeable. Le PI lui-même ne réfère pas le Connect account dans le code actuel (Separate Charges & Transfers — voir Annexe E), donc le PI passe quand même. C'est le `transfer` weekly qui échoue plus tard.

**Severity MEDIUM→LOW** : risque marginal, déjà attrapé par la séquence INSERT-before-transfer + audit log `stripe_transfer_failed`.

**Fix recommandé** (defense-in-depth, optionnel) : ajouter un check `producer.stripe_charges_enabled` au début de `create-payment-intent/route.ts`, retourner 409 `producer_not_ready` si false. Cohérent avec l'invariant `promoteProducerToPublicIfActive`.

---

# LOW

## L-1 — Pas d'IP allowlist sur le webhook Stripe

**File** : `app/api/stripe/webhook/route.tsx`.

Skill `references/security.md:74` recommande la défense en profondeur :

> For defense in depth, also allowlist Stripe's IP addresses on your webhook endpoint so that it accepts connections only from Stripe's infrastructure.

La signature webhook (`constructEvent`) suffit en théorie. Mais sans IP allowlist :
- Un attaquant qui spoof une signature valide (impossible sans le secret) ne peut pas réussir, mais peut **flood le endpoint** avec des payloads invalides → consomme du compute Vercel et pollue les logs `[STRIPE_WEBHOOK_INVALID_SIGNATURE]`.
- Defense-in-depth contre une fuite future du `STRIPE_WEBHOOK_SECRET`.

Liste IPs Stripe : https://docs.stripe.com/ips. À implémenter via Vercel Edge Middleware ou Cloudflare WAF. Pas de Vercel Pro feature dédiée → custom middleware.

**Fix recommandé** : phase B post-launch, pas bloquant pour go-live.

## L-2 — `business_type: "individual"` hardcodé à l'onboarding Connect

**File** : `app/api/stripe/connect/onboard/route.ts:41`.

```ts
business_type: "individual",
```

Tous les producers sont créés en `individual` (auto-entrepreneur). En France :
- ~80% des producteurs locaux food/maraîchage = micro-entrepreneur → OK.
- Les SARL / EURL / SAS / GAEC (groupements agricoles) ne matchent pas → KYC va exiger des docs business additionnels. Si onboard Express ne propose pas le bon flow, le producer va abandonner.

**Fix recommandé** : prompter le `business_type` lors du flow producer signup (radio button "Auto-entrepreneur / SARL / EURL / SAS / GAEC / Autre"), passer la valeur à `accounts.create`. Ou alternativement, omettre `business_type` et laisser Stripe demander via le accountLink (Stripe a un sélecteur natif).

## L-3 — Apple Pay / Google Pay non configurés (lié à M-1)

Pas de domain verification Stripe trouvée :
- Pas de fichier `.well-known/apple-developer-merchantid-domain-association`.
- Pas de meta tag `apple-itunes-app` ou config Wallet.

Si on lift M-1 (passage à dynamic payment methods), Apple Pay sera proposé par le Payment Element MAIS échouera à l'init Apple Wallet sans domain registration. Google Pay marche immédiatement sans config.

**Fix** : couplé avec M-1, suivre https://docs.stripe.com/payments/apple-pay. ~30min de boulot.

## L-4 — Schedule cron `order-timeout` daily, commentaire dit "hourly"

**File** : `app/api/cron/order-timeout/route.tsx:20` (commentaire) vs `vercel.json:13-15` (schedule).

```ts
// route.tsx l.20
// Toutes les heures : annule + rembourse les commandes pending depuis +24h.
```

```json
// vercel.json
{ "path": "/api/cron/order-timeout", "schedule": "0 9 * * *" }
```

`0 9 * * *` = daily à 9h UTC. Pas hourly. Discordance commentaire ↔ config — pas un bug fonctionnel (un order pending 24h+ sera collected au plus tard 24h après par le run daily) mais le commentaire suggère un SLA différent.

**Fix** : 1-line edit du commentaire pour aligner sur la réalité, ou bumper le schedule à `0 * * * *` si l'intent était vraiment hourly. À arbitrer (impact UX consumer : timeout effectif compris entre 24h et 48h en daily, vs 24-25h en hourly).

## L-5 — `/api/stripe/refund` : producer-owned refund sans cap montant ni approval

**File** : `app/api/stripe/refund/route.ts:40-52`.

Le producer propriétaire de l'order peut refund 100% du montant à tout moment (même après `completed`), sans approval admin et sans cap. Cas d'usage légitime : marchandise abîmée à la livraison, producer veut rembourser. Cas problématique :
- Bug producer (refund par erreur), pas de undo.
- Producer mal intentionné refund toutes ses commandes pour fuir la commission TerrOir (les 6% sont déjà encaissés en `commission_terroir`, mais le refund réduit à 0).

**Severity LOW** : niche, pas un risque de fuite/sécurité, juste un risque opérationnel.

**Fix recommandé (V1.1)** : audit_log `order_producer_refund_*` (déjà partial dans le code actuel via `order_admin_refund_failed`), email notification admin sur tout refund producer ≥ N €, possibilité d'undo via Dashboard Stripe.

## L-6 — Idempotency-key conventions : sync entre code et docs

**Pattern actuel** observé dans le code :
- `customer_create_${userId}` (customer.ts)
- `pi_create_${order.id}` (create-payment-intent)
- `refund_${order.id}_admin`, `refund_${order.id}_timeout`, `refund_${order.id}_revival` (revival manquant — voir M-2)
- `transfer_${producerId}_${periodeDebut}` (payouts.ts)

Documenté indirectement via commentaires inline (T-404, T-408, T-414…). Audit RPC §L-2 le mentionne déjà :

> Documenter ce contrat dans `METHODOLOGY.md` pour qu'aucun futur path n'utilise une key non-UUID.

**Severity LOW** : convention saine, juste à documenter dans `METHODOLOGY.md`.

---

# Annexe A — Webhook events traités vs ignorés (matrice exhaustive)

## Events traités côté `app/api/stripe/webhook/route.tsx`

| Event Stripe                          | Handler                                          | Dédup `webhook_events_processed` | Side effects                                                                       |
|---------------------------------------|--------------------------------------------------|:---------------------------------:|------------------------------------------------------------------------------------|
| `payment_intent.succeeded`            | `lib/stripe/handle-payment-succeeded.ts`         |                ✓                  | UPDATE order (résurrection 3DS), refund Stripe (revival blocked), email producer, SMS, audit log |
| `payment_intent.payment_failed`       | `lib/stripe/handle-payment-failed.ts`            |                ✓                  | UPDATE order pending→cancelled+payment_failed, audit log                          |
| `account.updated`                     | `lib/stripe/sync-account-flags.ts`               |                ✓                  | UPDATE producer flags (charges/payouts/details), audit log                        |
| `payout.paid`                         | `lib/stripe/handle-payout-paid.ts`               |                ✓                  | UPDATE payouts statut→paid, audit log                                             |
| `payout.failed`                       | `lib/stripe/handle-payout-failed.tsx`            |                ✓                  | UPDATE payouts statut→failed, audit log, email admin                              |
| `charge.dispute.created`              | `lib/stripe/handle-dispute-created.tsx`          |                ✓                  | INSERT disputes, audit log, email admin URGENT                                    |
| `charge.dispute.updated`              | `lib/stripe/handle-dispute-updated.ts`           |                ✓                  | UPDATE disputes statut, audit log                                                 |
| `charge.dispute.closed`               | `lib/stripe/handle-dispute-closed.tsx`           |                ✓                  | UPDATE disputes statut + closed_at, audit log, email admin info-only              |

## Events Stripe NON abonnés (pertinents pour TerrOir)

| Event                                       | Pertinence pour TerrOir                                                                                                                          | Sévérité ajout      |
|---------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------|---------------------|
| `radar.early_fraud_warning.created`         | Refund pré-emptif avant chargeback                                                                                                                | M-3 MEDIUM          |
| `charge.refunded`                           | Settlement réel du refund (vs émission)                                                                                                          | M-3 MEDIUM          |
| `account.application.deauthorized`          | Producer disconnect Connect                                                                                                                      | M-3 MEDIUM          |
| `capability.updated`                        | Granularité fine des capabilities (SEPA futur)                                                                                                   | M-3 LOW             |
| `payment_method.{attached,detached}`        | Sync UI `/compte/paiements`                                                                                                                      | M-3 LOW             |
| `transfer.{created,reversed}`               | Suivi transfers Stripe-side (fail safe)                                                                                                         | M-3 LOW             |
| `customer.{created,deleted}`                | TerrOir crée tous les customers explicitement → redondant                                                                                       | NA                  |
| `payment_intent.processing`                 | États transitoires non utilisés par TerrOir (cards uniquement, pas SEPA)                                                                         | NA                  |
| `setup_intent.*`                            | TerrOir n'utilise pas SetupIntents pur (save during checkout via PI + setup_future_usage)                                                        | NA                  |
| `invoice.*`, `subscription.*`               | Pas d'usage Stripe Billing                                                                                                                       | NA                  |

## Subscription set côté Dashboard Stripe (à vérifier en MCP write futur)

⚠️ Cet audit n'a pas vérifié le `webhook endpoint configuration` côté Dashboard Stripe (events réellement envoyés à `/api/stripe/webhook`). Si le Dashboard envoie tous les events `*` mais le code `default: break` les ignore, le coût est faible (200 OK rapide). Mais si le Dashboard ne renvoie qu'une whitelist trop courte, le code attend des events qu'il ne recevra jamais.

**À vérifier avant go-live (read-only)** : le `webhook_endpoint.enabled_events` côté Dashboard Stripe vs la `DEDUP_TARGETS` du code (`webhook/route.tsx:61-81`).

---

# Annexe B — Inventaire endpoints Stripe applicatifs

| Route                                                | Méthode | Auth                           | Effets Stripe                                                                | Idempotency                  |
|-----------------------------------------------------|:-------:|--------------------------------|-------------------------------------------------------------------------------|------------------------------|
| `/api/stripe/create-payment-intent`                 | POST    | session + ownership 403        | `paymentIntents.create / retrieve / update / cancel` + `customers.create`     | `pi_create_${orderId}`       |
| `/api/stripe/ensure-default-payment-method`         | POST    | session + ownership 403        | `customers.retrieve / update` + `paymentMethods.list / detach`               | (none — dédup applicative)   |
| `/api/stripe/connect/onboard`                       | POST    | session + role producer/admin  | `accounts.create / del` + `accountLinks.create`                              | (none — dédup via DB UPDATE) |
| `/api/stripe/refund`                                | POST    | session admin OR producer-owner| `refunds.create`                                                              | `refund_${orderId}_admin`    |
| `/api/stripe/webhook`                               | POST    | signature Stripe               | (none — read-only sur events)                                                | dédup `webhook_events_processed` |
| `/api/cron/order-timeout`                           | POST/GET| `Bearer CRON_SECRET`           | `paymentIntents.retrieve` + `refunds.create` (×N)                            | `refund_${orderId}_timeout`  |
| `/api/cron/retry-failed-refunds`                    | POST/GET| `Bearer CRON_SECRET`           | `refunds.create` (via `retryIncident`)                                        | (à confirmer côté retryIncident) |
| `/api/cron/weekly-payout`                           | POST/GET| `Bearer CRON_SECRET`           | `transfers.create` (×N)                                                       | `transfer_${producerId}_${weekStart}` |

## Scripts maintenance (hors API runtime)

| Script                                      | Effet                                                                              | Dangereux ?           |
|---------------------------------------------|-------------------------------------------------------------------------------------|-----------------------|
| `scripts/backfill-stripe-connect-flags.ts`  | Sync `producers.stripe_*` flags depuis l'API Stripe (read-only Stripe + write DB)  | non                   |
| `scripts/audit-cleanup-orphan-customers.ts` | Liste customers orphelins (non référencés en DB)                                   | read-only par défaut  |
| `scripts/audit-cleanup-orphan-pms.ts`       | Liste PaymentMethods orphelins                                                     | read-only par défaut  |

Tous 3 utilisent `apiVersion: "2025-02-24.acacia"` (cf. H-1) — à upgrader avec le SDK.

---

# Annexe C — Cross-référence audits Supabase déjà bouclés

| Audit Supabase                              | Findings recoupant Stripe API                                                              | Statut audit Stripe          |
|---------------------------------------------|--------------------------------------------------------------------------------------------|------------------------------|
| audit-rls-2026-05-05.md §C-1, C-2           | `revive_order_with_stock_check` + `record_refund_attempt` PUBLIC sans garde                | Hors périmètre (DB-side)     |
| audit-rpc-edge-2026-05-05.md §M-1           | Crons séquentiels Stripe = risque timeout                                                  | Adressé via mapWithConcurrency (Audit RPC fix) |
| audit-rpc-edge-2026-05-05.md §L-2           | Idempotency-keys conventions                                                                | Renforcé ici via M-2 (revival manquant) + L-6 (doc) |
| audit-rpc-edge-2026-05-05.md Annexe C       | Webhook signature + dédup applicative confirmées solides                                   | Confirmé ici, non re-audité  |
| audit-rpc-edge-2026-05-05.md Annexe C       | Pas d'IP allowlist Stripe webhook (mention)                                                 | Reposé ici en L-1            |
| audit-perf-postgres-2026-05-05.md C-3       | N+1 dans cron order-timeout résolu via embeds PostgREST                                    | OK, hors périmètre Stripe API |

Aucune contradiction entre les 5 audits Supabase et l'audit Stripe phase A.

---

# Annexe D — Spot-check Stripe MCP (lecture seule)

**Account** : `acct_1TNw9nGuakpserKp` ("Environnement de test TerrOir"), `livemode: false` ✅.

**Balance** :
- `available: -571 cents` (= -5.71€) — refunds excédant payments. Normal en test mode après une série de refund-tests. Pas un finding.
- `pending: 0`, `connect_reserved: 0`, `refund_and_dispute_prefunding.available: 0`.

**Customers (top 4)** :
- `cus_UQShfF92OYpIgP` (Romain Lubin, lubin.rom@gmail.com)
- `cus_UOoKFU9IIk6NFZ` (Claire Vasseur, test-producer-conseil@mailinator.com)
- `cus_UNjJChcYlU879g` (Test TEST, test-phase3-newuser@mailinator.com)
- `cus_UMfaaMmcCd9BHP` (testaccount@example.com)

Tous nominaux. Pas d'orphelins visibles. Phone metadata observée sur `cus_UMfaaMmcCd9BHP` (`0000000000`) — fixture test, à purger avant go-live.

**PaymentIntents (top 10 récents)** :
- 5 succeeded, 4 requires_payment_method, 0 canceled, 0 processing.
- 3 PI succeeded ont chacun **1 refund associé** (cf. spot-check `list_refunds`) → indique des cycles "pay → refund" test, cohérent avec balance négative.
- Tous en EUR, montants entre 4.50€ et 27.50€ (cohérent panier food/local).

**Disputes** : `[]` — aucun dispute en test mode. ⚠️ **Conséquence** : les handlers `dispute.{created,updated,closed}` n'ont jamais été testés contre une dispute Stripe réelle. Tests unitaires existent (`tests/lib/stripe/handle-dispute-*.test.ts`), mais pas de validation E2E.

**Recommandation pré-go-live** : déclencher 1 dispute test via Stripe CLI (`stripe trigger charge.dispute.created`) ou test card `4000 0000 0000 0259`, valider que :
- Le row `disputes` est créé avec `status='needs_response'`.
- L'email admin est envoyé à `SUPPORT_EMAIL`.
- L'audit log `stripe_dispute` est posé.

---

# Annexe E — Pattern de charge Connect : Separate Charges & Transfers (vs Direct/Destination)

**Choix architectural observé** (pas un finding, contexte) :

```
PI créé sur compte plateforme TerrOir
  → consumer paye en totalité au compte plateforme
  → Stripe fee 1.4% + 0.25€ prélevée au compte plateforme
  → cron weekly-payout déclenche stripe.transfers.create({
      destination: producer.stripe_account_id,
      amount: montant_net_producer (= total - 6% commission)
    })
  → producer reçoit son net hebdomadaire en lot
```

**Pas de `transfer_data.destination` ni `application_fee_amount` dans les PI** (grep confirmé : 0 hit en code applicatif, seulement en commentaires templates).

**Trade-offs vs Destination charges** :

| Dimension                                     | Separate C&T (actuel)                            | Destination charge (alternative)                |
|-----------------------------------------------|--------------------------------------------------|--------------------------------------------------|
| Atomicité paiement→transfert                  | Non (cron weekly découplé)                       | Oui (atomique au PI confirm)                     |
| Cashflow plateforme                           | TerrOir détient les fonds 7 jours               | Stripe transfère immédiatement                   |
| Complexité opérationnelle                     | Cron + table `payouts` + retry logic            | Simple, géré par Stripe                          |
| Liabilité chargebacks                         | Plateforme paye (Stripe fee + commission)       | Plateforme paye (Express)                        |
| Visibilité commission                         | `commission_terroir` calculée en DB             | `application_fee_amount` paramétré par PI        |
| Cas d'usage idéal                             | Paiements groupés, business hebdo               | E-commerce instant payout                        |

**Décision actuelle est défensable** pour un marketplace food hebdo (cohérence avec retraits hebdo des consumers, paie producteur le lundi). Pas un finding mais à arbitrer en V1.x si les producers demandent des virements plus rapides.

---

# Recommandations d'action (priorisé pour go-live)

## Avant go-live (HIGH priority)

1. **H-1 + H-3 : Upgrade SDK + apiVersion ensemble** — séquence : bump `stripe@17→22` + `@stripe/stripe-js@4→9` (PR1, breaking TS), puis bump `apiVersion: "2026-04-22.dahlia"` (PR2), puis bump version Dashboard Stripe (manual). Re-run la suite tests Stripe. Smoke test E2E. **Estimé 4-8h.**
2. **M-5 : Décider stratégie test→live customer ID drift** — option recommandée : migration one-shot `UPDATE users SET stripe_customer_id = NULL` + `UPDATE producers SET stripe_account_id = NULL, stripe_*_enabled = false` au moment du cutover. Documenter dans le runbook bascule. **Estimé 1h.**
3. **M-2 : Ajouter idempotency-key au refund revival** — 1-line fix, defense-in-depth. **Estimé 15min.**
4. **Annexe D : Smoke test E2E disputes** — `stripe trigger charge.dispute.created` en test mode, valider le 3-handler chain. **Estimé 30min.**

## Avant go-live (MEDIUM priority — arbitrer ROI)

5. **H-2 : Migration Connect Express v1→v2 + controller properties** — option A (refacto avant) ~6-12h, option B (V1.1 + TODO) 0min. Romain arbitre selon dispo dev.
6. **M-1 : Activer dynamic payment methods (Apple Pay + Google Pay + SEPA)** — couplé domain verification Apple. **Estimé 2-4h** + impact UX/conversion potentiellement +10-20% mobile.
7. **M-3 : Subscribe `radar.early_fraud_warning.created` + `charge.refunded`** — 2 handlers + 2 audit logs. **Estimé 2h.**
8. **M-4 : Cron monitoring deadline disputes** — daily check J-3 + J-1. **Estimé 1-2h.**

## Post-launch (LOW priority — peuvent attendre V1.1)

9. **L-1 IP allowlist Stripe webhook** — defense-in-depth via Vercel Edge Middleware ou Cloudflare WAF.
10. **L-2 `business_type` prompt onboarding producer** — UX form + transmission au accounts.create.
11. **L-3 Apple Pay domain verification** — couplé M-1.
12. **L-4 Cron `order-timeout` schedule alignement** — 1-line fix commentaire OU bumper hourly.
13. **L-5 Workflow refund producer** — audit log + email admin + cap montant à arbitrer.
14. **L-6 Documentation `METHODOLOGY.md` idempotency-key conventions** — 30min de rédaction.

## Backlog ouvert (audits Supabase)

- **Audit RPC §C-1, C-2** : RPC `revive_order_with_stock_check` + `record_refund_attempt` exposées PUBLIC sans garde — toujours ouverts. Migration cleanup ACL globale recommandée (cf. audit RPC §H-3).

---

**Aucune action n'a été appliquée. Liste pour arbitrage.**
