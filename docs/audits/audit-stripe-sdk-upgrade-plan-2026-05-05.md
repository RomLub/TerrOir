# Plan upgrade SDK Stripe — Phase 3 Lot 1

**Date** : 2026-05-05
**Périmètre** : audit READ-ONLY uniquement, aucune modification de code
**Référence audit Stripe** : `docs/audits/audit-stripe-2026-05-05.md` (findings H-1, H-3)
**Phase amont bouclée** : Phase 1 (5 commits ac5fe62 → 7ea6006), 1662 tests verts.

## 0. Inventaire dépendances Stripe et cibles

### Direct (`package.json`)

| Package | Actuel | Cible | Majors traversés |
|---|---|---|---|
| `stripe` (Node SDK) | `^17.2.0` (résolu : 17.7.0) | `22.1.x` | **5** (17→18→19→20→21→22) |
| `@stripe/stripe-js` (client) | `^4.8.0` (résolu : 4.10.0) | `9.4.x` | **5** (4→5→6→7→8→9) |
| `@stripe/react-stripe-js` | `^2.9.0` | `6.3.0` | **4** (2→3→4→5→6) |

### Transitive (vérification `package-lock.json`)

```
$ grep "@stripe/" package-lock.json
"@stripe/react-stripe-js": "^2.9.0",
"@stripe/stripe-js": "^4.8.0",
"@stripe/stripe-js": "^1.44.1 || ^2.0.0 || ^3.0.0 || ^4.0.0",   ← peerDeps de react-stripe-js@2.9.x
```

**Aucune autre dépendance Stripe transitive.** Le 3ᵉ match est uniquement le peerDeps de `@stripe/react-stripe-js@2.9.x` qui plafonne à `stripe-js@4` — c'est la raison structurelle qui force l'upgrade conjoint.

### `apiVersion` Stripe pinned

| Composant | Actuel | Cible |
|---|---|---|
| `lib/stripe/server.ts:10` | `2025-02-24.acacia` | `2026-04-22.dahlia` |
| `scripts/backfill-stripe-connect-flags.ts:65` | `2025-02-24.acacia` | `2026-04-22.dahlia` |
| `scripts/audit-cleanup-orphan-customers.ts:118` | `2025-02-24.acacia` | `2026-04-22.dahlia` |
| `scripts/audit-cleanup-orphan-pms.ts:87` | `2025-02-24.acacia` | `2026-04-22.dahlia` |

Versions API traversées : `2025-02-24.acacia` → `2025-03-31.basil` → `2025-09-30.clover` → `2025-11-17.clover` → `2026-03-25.dahlia` → `2026-04-22.dahlia`.

### Compat react-stripe-js@6.3.0 (cible)

D'après `package.json` master du repo Stripe :
```json
"peerDependencies": {
  "@stripe/stripe-js": ">=9.3.1 <10.0.0",
  "react": ">=16.8.0 <20.0.0",
  "react-dom": ">=16.8.0 <20.0.0"
}
```
→ exige `stripe-js >= 9.3.1 < 10` ; React 18 (TerrOir) compatible.

## 1. Synthèse priorisée

### Tableau breaking-vs-usage

| Catégorie | Server (17→22) | Client (4→9) | React (2→6) | apiVersion (acacia→dahlia) | **TOTAL pertinent TerrOir** |
|---|---|---|---|---|---|
| Removals usage TerrOir | 1 | 0 | 0 | 0 | **1** |
| Renames usage TerrOir | 0 | 0 | 0 | 0 | **0** |
| Type/signature changes | 1 | 1 | 0 | 0 | **2** |
| Comportement runtime | 2 | 0 | 0 | 1 | **3** |
| Removals NON utilisées (info) | 30+ | 5+ | 4 | 8+ | **47+** |

### Compteur findings actionnables (par sévérité)

| Sévérité | Count | Origine |
|---|---|---|
| **H — bloquant** | 1 | v22 : `Stripe.errors.StripeError` n'est plus un type → cast `e is Stripe.errors.StripeError` à corriger (`classify-error.ts:99`) |
| **M — code à toucher** | 2 | v8 stripe-js : `Elements options` discriminated union ; v22 : confirmer `new Stripe()` partout |
| **L — vérification post-upgrade** | 4 | Capabilities Connect, `confirmCardPayment` legacy, `total_count` jamais utilisé, peerDeps peerDeps React 19+ |
| **Info — non utilisé** | 47+ | Listés dans chaque section pour traçabilité |

### Estimation effort total

| Lot | Travail | Effort CC |
|---|---|---|
| **Lot 2** : exécution upgrade (bumps + fixes code + apiVersion bump 4 sites) | Bumps npm, fix `classify-error.ts`, vérifier 4 sites apiVersion, vérifier `Elements options` shape, run TS, run vitest 1662 tests | **3-4h** |
| **Lot 3** : smoke tests E2E + résolution drift | Smoke checkout (cartes test), webhook fire (Stripe CLI listen), refund manuel, cron weekly-payout dry-run, cron disputes-deadline-check, audit `consumer_email` champs, dry-run scripts maintenance, validation TypeScript stricte | **2-3h** |
| **TOTAL** | | **5-7h CC** |

## 2. Server SDK : `stripe@17` → `22`

### 2.1 Major 17 → 18 (publié 2025-04-01, `2025-03-31.basil`)

Release notes : https://github.com/stripe/stripe-node/releases/tag/v18.0.0

#### Breaking changes pertinents pour TerrOir

| Item changelog | Impact TerrOir |
|---|---|
| Remove `SubscriptionItemUsageRecordSummary` / `SubscriptionItemUsageRecord` | NON utilisé (TerrOir n'a pas de subscriptions) |
| Remove `Invoice.listUpcomingLines` / `retrieveUpcoming` | NON utilisé |
| Remove `SubscriptionItems.createUsageRecord` / `listUsageRecordSummaries` | NON utilisé |
| **Remove `invoice` on `Charge` and `PaymentIntent`** | ✅ NON utilisé — TerrOir lit `pi.id`, `pi.metadata`, `pi.status`, `pi.client_secret`, `pi.customer`, `pi.setup_future_usage`. Aucun accès à `pi.invoice`. |
| Remove `shipping_details` on `Checkout.Session` | NON utilisé (pas de Checkout Session) |
| Remove `coupon` on Customer/Subscription create params | NON utilisé |
| Remove `promotion_code` on Customer/Subscription params | NON utilisé |
| Remove `price` on InvoiceItemCreateParams | NON utilisé |
| Remove `application_fee_amount`, `charge`, `paid_out_of_band`, etc. on `Invoice` | NON utilisé |
| **`page` removed from V2 list params** | NON utilisé — TerrOir n'utilise pas le namespace v2 |
| Change `Checkout.Session.collected_information.shipping_details` required | NON utilisé |
| Change `political_exposure` on `Person` from string to enum | NON utilisé |
| **Remove `total_count` expansion on lists** (côté API) | À vérifier : TerrOir utilise `paymentMethods.list`, `customers.list`, `charges.list`. Grep `total_count` : aucune occurrence dans le code TerrOir. ✅ NON utilisé |
| `political_exposure` enum (Person) | NON utilisé |

#### Verdict

**Aucun fix code requis.** TerrOir n'utilise aucun des champs/méthodes retirés en `2025-03-31.basil`. Le bump SDK v17 → v18 est purement transparent côté code applicatif TerrOir.

#### Gotcha

`pinned API version` change automatiquement de `2025-02-24.acacia` à `2025-03-31.basil`. Comme on overwrite explicitement dans `lib/stripe/server.ts:10` et les 3 scripts maintenance, le default n'a pas d'effet — mais il faut bumper ces 4 sites simultanément (cf. §5).

### 2.2 Major 18 → 19 (publié 2025-09-30, `2025-09-30.clover`)

Release notes : https://github.com/stripe/stripe-node/releases/tag/v19.0.0

#### Breaking changes pertinents pour TerrOir

| Item changelog | Impact TerrOir |
|---|---|
| Move `V2.Event` resources to `V2.Core.Events` namespace | NON utilisé (pas de v2) |
| Rename `StripeClient.parseThinEvent` → `parseEventNotification` | NON utilisé (TerrOir utilise `stripe.webhooks.constructEvent` v1) |
| **Drop support for Node < 16** | OK — Vercel Functions Node 20 par défaut |
| Add `StripeContext` class + `EventNotification.context` from string to `StripeContext` | NON utilisé |
| Stop removing `stripe-context`/`stripe-account` headers | NON utilisé |
| V2 delete methods return `V2DeletedObject` | NON utilisé |
| V2 nullable types union → optional | NON utilisé |
| **Remove `coupon` on Discount/PromotionCode** (use `Discount.source.coupon`) | NON utilisé |
| Remove `link`/`pay_by_bank` on `PaymentMethodUpdateParams` | NON utilisé |
| Remove support for values `saturday`/`sunday` from payouts.schedule.weekly_payout_days | NON utilisé directement (TerrOir n'utilise pas Account.settings.payouts.schedule) |
| `Invoice.id` required | NON utilisé |
| Remove `iterations` on Subscription Schedule phases | NON utilisé |
| Remove `balance_report`/`payout_reconciliation_report` on AccountSession.components | NON utilisé |

#### Verdict

**Aucun fix code requis.** Le bump v18 → v19 est transparent.

#### Gotcha

`pinned API version` → `2025-09-30.clover`. Idem §2.1 : on override les 4 sites.

### 2.3 Major 19 → 20 (publié 2025-11-18, `2025-11-17.clover`)

Release notes : https://github.com/stripe/stripe-node/releases/tag/v20.0.0

#### Breaking changes pertinents pour TerrOir

| Item changelog | Impact TerrOir |
|---|---|
| Remove `gt`/`gte`/`lt`/`lte` on `V2.Core.EventListParams` (use `created`) | NON utilisé |
| **V2 array param serialization → indexed format** | NON utilisé. ⚠️ Heads-up : *si* un test mock un serveur HTTP simulant v2 endpoints, il pourrait casser. Audit grep tests v2 : aucune occurrence `V2.` dans `tests/`. ✅ Safe. |
| Add `Tax.Association`, `Terminal.OnboardingLink` resources (additif) | NON utilisé |

#### Verdict

**Aucun fix code requis.** Bump v19 → v20 transparent.

### 2.4 Major 20 → 21 (publié 2026-03-26, `2026-03-25.dahlia`)

Release notes : https://github.com/stripe/stripe-node/releases/tag/v21.0.0
Migration guide officiel : https://github.com/stripe/stripe-node/wiki/Migration-guide-for-v21

#### Breaking changes pertinents pour TerrOir

| Item changelog | Impact TerrOir |
|---|---|
| **Decimal type** : tous les `decimal_string` deviennent `Stripe.Decimal` au lieu de `string`. Champs concernés : `Plan.amount_decimal`, `Price.unit_amount_decimal/flat_amount_decimal`, `InvoiceItem.quantity_decimal/unit_amount_decimal`, `InvoiceLineItem.quantity_decimal/unit_amount_decimal`, `CreditNoteLineItem.unit_amount_decimal`, `Issuing.Authorization/Transaction.quantity_decimal/unit_cost_decimal/gross_amount_decimal/local_amount_decimal/national_amount_decimal`, `Climate.Order.metric_tons`, `Climate.Product.metric_tons_available`, `V2.Core.Account/AccountPerson.percent_ownership`. Construct via `Decimal.from("1.23")`, serialize via `.toString()`. | ✅ NON utilisé. TerrOir n'accède à AUCUN de ces champs. Toute l'arithmétique monétaire passe par `lib/money/cents.ts` (eurosToCents/centsToEuros/sumCents) sur des `number`. Les montants Stripe lus (`payout.amount`, `dispute.amount`, `Refund.amount`) sont des integer cents (pas decimal_string). |
| **Throw error when using wrong webhook parsing method** | À vérifier : `stripe.webhooks.constructEvent(rawBody, signature, secret)` est l'API v1 standard. Si on l'utilise sur un payload v2, ça throw désormais. TerrOir reçoit *uniquement* des events v1 (account.updated, payment_intent.*, payout.*, charge.dispute.*) → pas d'impact. ✅ |
| New OAuth Error classes | NON utilisé (pas d'OAuth Connect) |
| **Drop Node 16** | OK — Vercel Node 20 |
| Add manual amount type | Additif |
| Runtime support for V2 int64 string-encoded fields | NON utilisé |

#### Verdict

**Aucun fix code requis pour TerrOir.** Le Decimal type breaking ne touche que les champs decimal_string sur Plans/Prices/Invoices/Climate/Issuing — tous absents du périmètre TerrOir.

### 2.5 Major 21 → 22 (publié 2026-04-03, `2026-03-25.dahlia` identique)

Release notes : https://github.com/stripe/stripe-node/releases/tag/v22.0.0
Migration guide officiel : https://github.com/stripe/stripe-node/wiki/Migration-guide-for-v22

#### Breaking changes pertinents pour TerrOir

| Item changelog | Impact TerrOir | Action |
|---|---|---|
| **Stripe import est désormais une vraie classe ES6 — `new Stripe()` obligatoire** | ✅ TerrOir utilise déjà `new Stripe(...)` partout (`lib/stripe/server.ts:9`, scripts maintenance). | Aucune action |
| **Remove callbacks API methods (use `async/await`)** | ✅ TerrOir utilise `await stripe.x.y(...)` partout, jamais de callback. | Aucune action |
| **Remove apiKey as function arg** (use `RequestOptions.apiKey`) | ✅ NON utilisé. | Aucune action |
| **Remove per-request `host` override** (use client config) | ✅ NON utilisé. | Aucune action |
| **`params` + `options` keys no longer mixed** : `RequestParams` premier arg, `RequestOptions` second arg ; pour options sans params passer `undefined` | ✅ TerrOir respecte déjà cette signature : `stripe.refunds.create({ payment_intent: ... }, { idempotencyKey: ... })`, `stripe.paymentIntents.create({ amount, ... }, { idempotencyKey: ... })`. | Aucune action |
| Remove `StripeResource` internal methods (`createFullPath`, `extend`, `method`, etc.) | NON utilisé | Aucune action |
| **`Stripe.StripeContext` n'est plus exporté comme type — utiliser `Stripe.StripeContextType`** | NON utilisé (pas de StripeContext dans TerrOir) | Aucune action |
| **`Stripe.errors.StripeError` n'est plus un type — utiliser `typeof Stripe.errors.StripeError` ou `Stripe.ErrorType`** | ⚠️ **IMPACT** : `lib/refund-incidents/classify-error.ts:99` utilise `e is Stripe.errors.StripeError` comme type predicate ; `classify-error.ts:169` utilise `error: Stripe.errors.StripeError` comme paramètre de fonction. | **FIX REQUIS** (cf. ci-dessous) |
| **CJS entry point n'exporte plus `.default`/`.Stripe` séparément** | ✅ TerrOir utilise ESM (`import Stripe from "stripe"`). NON impacté. | Aucune action |
| `V2/Amount.ts` → `V2/V2Amount.ts` | NON utilisé | Aucune action |

#### Le seul fix code requis pour les 5 majors server

**Fichier impacté** : `lib/refund-incidents/classify-error.ts`

**Symptôme** : la classe `Stripe.errors.StripeError` reste utilisable comme **valeur** (`instanceof Stripe.errors.StripeError`) — c'est inchangé. Mais elle n'est plus exportée comme **type** (`e is Stripe.errors.StripeError` en signature TS).

**Fix proposé** :

```diff
// classify-error.ts:99-101
- export function isStripeError(e: unknown): e is Stripe.errors.StripeError {
+ export function isStripeError(e: unknown): e is InstanceType<typeof Stripe.errors.StripeError> {
    return e instanceof Stripe.errors.StripeError;
  }

// classify-error.ts:169
- function extractBase(error: Stripe.errors.StripeError): Omit<
+ function extractBase(error: InstanceType<typeof Stripe.errors.StripeError>): Omit<
    ClassifiedRefundError,
    "category"
  > {
```

**Alternative (plus idiomatique)** : utiliser `Stripe.ErrorType` exporté par v22.

```diff
- export function isStripeError(e: unknown): e is Stripe.errors.StripeError {
+ export function isStripeError(e: unknown): e is Stripe.ErrorType {
```

⚠️ Choix dépend de la résolution du symbole `Stripe.ErrorType` post-bump (à valider en TS strict en Lot 2). Préférer `InstanceType<typeof Stripe.errors.StripeError>` qui est garanti compatible toutes versions.

**Tests à adapter** : `tests/lib/refund-incidents/classify-error.test.ts:432` — l'assertion `isStripeError(new Stripe.errors.StripeRateLimitError())` reste valide (le runtime n'a pas changé), pas de modification nécessaire côté test.

#### Gotcha v22

L'usage `instanceof Stripe.errors.StripeXxxError` dans `classify-error.ts:217-253` reste valide (les classes existent toujours runtime). Seul le narrowing TS du type guard `is` casse.

## 3. Client SDK : `@stripe/stripe-js@4` → `9`

Périmètre code TerrOir :
- `lib/stripe/client.ts` : `loadStripe`, type `Stripe`
- `app/(consumer)/compte/checkout/page.tsx` : `Elements`, `PaymentElement`, `useStripe`, `useElements`, `stripe.confirmCardPayment`, `stripe.confirmPayment`
- `app/(consumer)/compte/paiements/_components/AddCardModal.tsx` : `Elements`, `PaymentElement`, `useElements`, `useStripe`, `stripe.confirmSetup`
- `lib/checkout/classify-stripe-error.ts` : type `StripeError` import

### 3.1 Major 4 → 5 (2024-11-18)

Release : https://github.com/stripe/stripe-js/releases/tag/v5.0.0

| Item | Impact TerrOir |
|---|---|
| Rename `Custom Checkout` → `Checkout` (types) | NON utilisé (TerrOir n'utilise pas le namespace Custom Checkout) |
| Add `customPaymentMethods` types | Additif |

**Verdict** : transparent.

### 3.2 Major 5 → 6 (2025-03-10, `acacia` GA)

Release : https://github.com/stripe/stripe-js/releases/tag/v6.0.0

Pas de field-level breaking. C'est principalement le bump pinned API version.

**Verdict** : transparent.

### 3.3 Major 6 → 7 (2025-04-01, `basil` GA)

Release : https://github.com/stripe/stripe-js/releases/tag/v7.0.0

| Item | Impact TerrOir |
|---|---|
| Modify Elements with Checkout Session types for GA | NON utilisé |
| Add developer tools typings | Additif |

**Verdict** : transparent.

### 3.4 Major 7 → 8 (2025-10-01, `clover`)

Release : https://github.com/stripe/stripe-js/releases/tag/v8.0.0

| Item | Impact TerrOir |
|---|---|
| **[breaking] Update types for Checkout SDK** | NON utilisé (pas de Checkout Session) |
| **[breaking] Remove types for `redirectToCheckout`** | NON utilisé (TerrOir utilise PaymentElement, pas redirectToCheckout) |
| **Replace optional `stripe.elements` mode params with discriminated union** | À vérifier : TerrOir appelle `<Elements stripe={getStripe()} options={{ clientSecret, locale: 'fr', appearance: { theme: 'stripe' } }}>`. Avec `clientSecret` set, le mode est implicitement "client_secret" — la discriminated union doit accepter cette shape sans modification. **Action** : valider en TS strict en Lot 2 que la shape `{ clientSecret, locale, appearance }` reste valide. Si TS rejette, ajouter `mode: 'payment'` ou refactor en discriminated union. ⚠️ Risk: low (les exemples Stripe utilisent toujours `{clientSecret}` simple). |
| Remove Clover elements | NON utilisé |
| Add Types for metadata field | Additif |
| Add Types for Condensed Inputs | Additif |
| Support expand on `confirmAcssDebitSetup()` | Additif |
| Fix types for PaymentMethod for all GA-ed LPMs | Bug fix non-breaking |

**Verdict** : 1 vérif TS post-bump, pas de fix code probable.

### 3.5 Major 8 → 9 (2026-03-26, `dahlia`)

Release : https://github.com/stripe/stripe-js/releases/tag/v9.0.0

| Item | Impact TerrOir |
|---|---|
| **`elements.update()` return type `void` → `Promise<void>`** | ✅ NON utilisé (TerrOir n'appelle jamais `elements.update()`). |
| Updated types for Dahlia | Cohérent avec apiVersion target |
| `createEmbeddedCheckoutPage` rename | NON utilisé |
| Add `format` to `getValue` for addressElement | NON utilisé |
| **Remove boolean from RadiosOption type for Dahlia** | NON utilisé |
| **Remove `createSource` and `retrieveSource` types for Dahlia** | NON utilisé (TerrOir n'utilise pas l'API Sources legacy) |

**Verdict** : transparent.

### Récap client : aucun fix code requis si la discriminated union §3.4 passe en TS strict.

#### Heads-up `confirmCardPayment` (page checkout.tsx:479)

Le changelog dahlia mentionne « Suppression des méthodes obsolètes de Payment Intents, Setup Intents et Sources ». `stripe.confirmCardPayment(clientSecret, { payment_method: ... })` est documenté comme legacy depuis l'arrivée du Payment Element, mais **pas explicitement listé comme retiré dans v9**. Sa signature côté TS est conservée. À vérifier en smoke test Lot 3 que l'appel fonctionne toujours runtime (très peu probable qu'il soit retiré sans annonce explicite — le SDK garde la rétro-compat sur les méthodes nommées).

Backlog ouvert post-Phase 3 : migrer la branche "CB enregistrée" (`mode === 'saved'`) vers `stripe.confirmPayment({ elements, confirmParams: { ... }, redirect: 'if_required' })` avec `payment_method` injecté via `elements.submit()` — si l'API le permet pour les PMs sauvegardés. Hors scope Phase 3.

## 4. React SDK : `@stripe/react-stripe-js@2` → `6`

Périmètre code TerrOir :
- `app/(consumer)/compte/checkout/page.tsx` : `Elements`, `PaymentElement`, `useStripe`, `useElements`
- `app/(consumer)/compte/paiements/_components/AddCardModal.tsx` : idem

### 4.1 Major 2 → 3 (2024-11-19)

Release : https://github.com/stripe/react-stripe-js/releases/tag/v3.0.0

| Item | Impact TerrOir |
|---|---|
| **Rename `CustomCheckoutProvider` → `CheckoutProvider`** | NON utilisé (TerrOir utilise `<Elements>`, pas `<CheckoutProvider>`/`<CustomCheckoutProvider>`) |

**Verdict** : transparent.

### 4.2 Major 3 → 4 (2025-09-02)

Release : https://github.com/stripe/react-stripe-js/releases/tag/v4.0.0

| Item | Impact TerrOir |
|---|---|
| **[breaking] Split out custom checkout imports** : `import {useCheckout, PaymentElement} from '@stripe/react-stripe-js'` → `import {useCheckout, PaymentElement} from '@stripe/react-stripe-js/checkout'` | ⚠️ NON applicable directement : ce path-rename ne s'applique qu'aux **intégrations Elements-with-Checkout-Sessions**. TerrOir utilise les Elements + PaymentElement standalone (avec `clientSecret` PaymentIntent classique), pas avec une Checkout Session. **Les imports `Elements`, `PaymentElement`, `useStripe`, `useElements` depuis `'@stripe/react-stripe-js'` restent valides en v4.** |
| `useCheckout()` returns disjoint union loading/success/error | NON utilisé (pas de `useCheckout()`) |
| `CheckoutProvider` renders children unconditionally | NON utilisé |

**Verdict** : transparent. ⚠️ **Mise en garde** : si jamais Phase 2 H-2 Connect v2 introduit `useCheckout`, il faudra l'importer depuis `@stripe/react-stripe-js/checkout`.

### 4.3 Major 4 → 5 (2025-10-01)

Release : https://github.com/stripe/react-stripe-js/releases/tag/v5.0.0

| Item | Impact TerrOir |
|---|---|
| **[breaking] Update CheckoutProvider to use new shape** | NON utilisé |
| Remove Clover element types | NON utilisé |

**Verdict** : transparent.

### 4.4 Major 5 → 6 (2026-03-26, dahlia + stripe-js v9 RC)

Release : https://github.com/stripe/react-stripe-js/releases/tag/v6.0.0

| Item | Impact TerrOir |
|---|---|
| Type updates for Dahlia | Cohérent cible |
| Update React providers for upcoming checkout SDK changes | NON utilisé (TerrOir pas en Checkout) |
| Point to stripe-js V9 RC + rename to `createEmbeddedCheckoutPage` | NON utilisé (pas d'Embedded Checkout) |

**Verdict** : transparent.

### Récap React : aucun fix code requis.

Le code TerrOir n'utilise QUE les composants stables `<Elements>`, `<PaymentElement>`, `useStripe()`, `useElements()` — qui n'ont pas changé d'API entre v2 et v6. C'est la partie la plus simple de l'upgrade.

## 5. apiVersion : `acacia` → `dahlia`

### 5.1 Versions traversées et fonction de transition

```
2025-02-24.acacia      ← TerrOir actuel
       ↓
2025-03-31.basil       (default v18)
       ↓
2025-09-30.clover      (default v19)
       ↓
2025-11-17.clover      (default v20)
       ↓
2026-03-25.dahlia      (default v21 + v22)
       ↓
2026-04-22.dahlia      ← cible
```

### 5.2 Breaking changes API par version (impact TerrOir)

#### `2025-02-24.acacia` → `2025-03-31.basil`

Source : https://docs.stripe.com/changelog/basil

| Breaking change | Impact TerrOir |
|---|---|
| **Remove `total_count` expansion sur lists** | ✅ NON utilisé (grep `total_count` : aucune occurrence). Les pagination scripts utilisent `has_more` + `starting_after`. |
| **Remove `Refund` from partial capture / cancellation workflows** | NON utilisé (TerrOir ne fait pas de partial capture) |
| **Remove `Invoice.upcoming` API** | NON utilisé |
| **Subscription period fields restructured (line-item level)** | NON utilisé |
| **Person `political_exposure` enum** | NON utilisé |
| Deprecation `coupon` + `promotion_code` singular | NON utilisé |

#### `2025-03-31.basil` → `2025-09-30.clover`

Source : https://docs.stripe.com/changelog/clover

| Breaking change | Impact TerrOir |
|---|---|
| Remove `currency_conversion` field on Checkout Sessions | NON utilisé |
| Remove `redirectToCheckout` method | NON utilisé |
| `initCheckout` now synchronous | NON utilisé |
| Remove `iterations` parameter on Subscription Schedule phases | NON utilisé |
| `Discount.coupon` → polymorphic `Discount.source.coupon` | NON utilisé |
| Default billing mode → flexible | NON utilisé |
| **Decline codes changed for Alma, Amazon Pay, Billie, Satispay, Korean PMs** | À vérifier : TerrOir utilise uniquement carte (`payment_method_types: ["card"]` dans `create-payment-intent/route.ts:155`). Pas d'Alma/Amazon Pay/Billie/Satispay → ✅ pas d'impact direct. Si Phase 2+ introduit ces PMs : revoir `lib/checkout/classify-stripe-error.ts`. |
| **New error code `unsupported_business_type`** sur Account.requirements | À vérifier : `lib/stripe/sync-account-flags.ts` ne lit pas `requirements.errors[]` → ✅ pas d'impact direct. |
| Remove `link`/`pay_by_bank` on PaymentMethodUpdateParams | NON utilisé |
| Remove `balance_report`/`payout_reconciliation_report` on AccountSession | NON utilisé |

#### `2025-09-30.clover` → `2025-11-17.clover`

Source : https://docs.stripe.com/changelog/clover

Aucun breaking field-level documenté pour cette version. Pure additivité (new resources `Tax.Association`, `Terminal.OnboardingLink`, etc.).

#### `2025-11-17.clover` → `2026-03-25.dahlia` puis `2026-04-22.dahlia`

Source : https://docs.stripe.com/changelog/dahlia

| Breaking change | Impact TerrOir |
|---|---|
| **Remove sources API types** (createSource/retrieveSource côté stripe-js) | NON utilisé |
| **Suppression méthodes legacy Payment Intents / Setup Intents / Sources** côté Stripe.js | À vérifier : `confirmCardPayment` mentionné dans `checkout/page.tsx:479` (cf. §3.5 heads-up) — non listé explicitement comme retiré. |
| **`initCheckout` rename → `initCheckoutElements`** | NON utilisé |
| **Address Element latin chars default** | NON utilisé (pas d'AddressElement) |
| **`elements.update()` retourne Promise<void>** | NON utilisé |
| **Checkout Session UI mode enum updates** | NON utilisé |
| **Capabilities API risk requirements** (Connect Accounts) | À vérifier : `app/api/stripe/connect/onboard/route.ts:42-45` demande `card_payments` + `transfers` — toujours valides en dahlia. Le webhook `account.updated` lit `account.charges_enabled / payouts_enabled / details_submitted` — champs stables. ⚠️ **Smoke test Lot 3 obligatoire** : créer un compte Connect Express en env Test post-bump, valider que `accounts.create` + `accountLinks.create` n'erreurent pas, et que les 3 flags se propagent côté webhook. |
| **New cancellation reason enum value (Subscriptions)** | NON utilisé |
| **Visa reference ID Issuing Token** | NON utilisé |

### 5.3 Impact sur les objets parsés directement

Audit des accès aux fields Stripe lus par TerrOir (dérivé de l'inventaire §6) :

| Field accédé | Fichiers TerrOir | Status dahlia |
|---|---|---|
| `paymentIntent.id`, `.metadata`, `.metadata.order_id`, `.status`, `.client_secret`, `.customer`, `.setup_future_usage` | `create-payment-intent/route.ts`, `handle-payment-succeeded.ts`, `handle-payment-failed.ts`, `cron/order-timeout/route.tsx` | ✅ Stables |
| `account.id`, `.charges_enabled`, `.payouts_enabled`, `.details_submitted` | `sync-account-flags.ts`, `webhook/route.tsx`, `backfill-stripe-connect-flags.ts` | ✅ Stables |
| `dispute.id`, `.charge`, `.payment_intent`, `.evidence_details.due_by`, `.amount`, `.currency`, `.reason`, `.status` | `handle-dispute-created.tsx`, `handle-dispute-updated.ts`, `handle-dispute-closed.tsx`, `cron/disputes-deadline-check/route.tsx` | ✅ Stables |
| `payout.id`, `.amount`, `.currency`, `.arrival_date`, `.destination`, `.failure_code`, `.failure_message`, `.metadata`, `.source_transaction` | `handle-payout-failed.tsx`, `handle-payout-paid.ts` | ✅ Stables |
| `refund.id` | `refund/route.tsx`, `retry-incident.ts`, `handle-payment-succeeded.ts`, `cron/order-timeout/route.tsx` | ✅ Stable |
| `customer.id`, `.deleted`, `.invoice_settings.default_payment_method`, `.email`, `.metadata`, `.created` | `customer.ts`, `ensure-default-payment-method/route.ts`, `audit-cleanup-orphan-customers.ts`, `audit-cleanup-orphan-pms.ts` | ✅ Stables |
| `paymentMethod.id`, `.card.fingerprint`, `.card.brand`, `.card.last4`, `.created` | `ensure-default-payment-method/route.ts`, `audit-cleanup-orphan-pms.ts` | ✅ Stables |
| `charges.list({ customer, limit })` (script audit) | `audit-cleanup-orphan-customers.ts` | ✅ Stable (pas dans liste removals) |
| `event.id`, `.type`, `.data.object`, `.account` | `webhook/route.tsx` | ✅ Stables |
| `error.code`, `.type`, `.rawType`, `.message`, `.statusCode`, `.requestId`, `.decline_code` (Stripe.errors.*) | `classify-error.ts` | ✅ Stables (les classes restent runtime ; seul le narrowing TS du `is Stripe.errors.StripeError` change — cf. §2.5) |

**Verdict apiVersion** : aucun field accédé par TerrOir n'est retiré ou renommé entre acacia et dahlia. Le bump est purement administratif **côté code TerrOir** — il ne touche que :
1. la chaîne `apiVersion` dans 4 fichiers (cf. §0)
2. la version SDK qui suit (transparent côté code).

## 6. Inventaire complet des call-sites (28 fichiers scannés)

### `lib/stripe/**` (13 modules)
- `client.ts` : `loadStripe`, type `Stripe`
- `server.ts` : init `new Stripe(...)`, `apiVersion: "2025-02-24.acacia"`
- `customer.ts` : `stripe.customers.create({...}, { idempotencyKey })`
- `cleanup.ts` : `stripe.accounts.del`, `stripe.customers.del`
- `sync-account-flags.ts` : type `Stripe.Account`, lit `charges_enabled / payouts_enabled / details_submitted`
- `payouts.tsx` : `stripe.transfers.create`, `processWeeklyPayouts` (T-414 INSERT-before-transfer)
- `handle-payment-succeeded.ts` : type `Stripe.PaymentIntent`, `stripe.refunds.create({...}, { idempotencyKey: refund_${orderId}_revival })`
- `handle-payment-failed.ts` : type `Stripe.PaymentIntent`, lecture `metadata.order_id`
- `handle-dispute-created.tsx` : type `Stripe.Dispute`, lit `evidence_details.due_by`
- `handle-dispute-updated.ts` : type `Stripe.Dispute`, mapping status
- `handle-dispute-closed.tsx` : type `Stripe.Dispute`, mapping terminal status
- `handle-payout-failed.tsx` : type `Stripe.Payout`, lit `failure_code/failure_message`, `metadata.payout_id`
- `handle-payout-paid.ts` : type `Stripe.Payout`, lit `source_transaction`

### `app/api/stripe/**` (5 routes)
- `webhook/route.tsx` : `stripe.webhooks.constructEvent`, dispatch event types, dédup T-103
- `create-payment-intent/route.ts` : `stripe.paymentIntents.create/retrieve/update/cancel`, `Stripe.errors.StripeIdempotencyError` instanceof
- `connect/onboard/route.ts` : `stripe.accounts.create({type: "express", capabilities: {card_payments, transfers}})`, `stripe.accountLinks.create`, `stripe.accounts.del` rollback
- `refund/route.tsx` : `stripe.refunds.create({...}, { idempotencyKey: refund_${orderId}_admin })`
- `ensure-default-payment-method/route.ts` : `stripe.customers.retrieve`, `stripe.customers.update`, `stripe.paymentMethods.list`, `stripe.paymentMethods.detach`

### `app/api/cron/{order-timeout,retry-failed-refunds,weekly-payout,disputes-deadline-check}/**` (4 crons)
- `order-timeout/route.tsx` : `stripe.paymentIntents.retrieve`, `stripe.refunds.create({...}, { idempotencyKey: refund_${orderId}_timeout })`
- `retry-failed-refunds/route.ts` : délègue à `retryIncident()`
- `weekly-payout/route.tsx` : délègue à `processWeeklyPayouts()`
- `disputes-deadline-check/route.tsx` : pas d'I/O Stripe (read-only DB)

### `lib/refund-incidents/**`
- `classify-error.ts` : `Stripe.errors.{StripeError, StripeRateLimitError, StripeConnectionError, StripeAPIError, StripeIdempotencyError, StripeAuthenticationError, StripePermissionError, StripeInvalidGrantError, TemporarySessionExpiredError, StripeInvalidRequestError, StripeCardError}` instanceof checks ; type guard `e is Stripe.errors.StripeError` (⚠️ FIX v22)
- `record-refund-attempt.ts` : appel RPC PostgreSQL (pas d'I/O Stripe)
- `retry-incident.ts` : `stripe.refunds.create({...}, { idempotencyKey: refund_${orderId}_${kind}_${attemptNumber} })`
- `types.ts` : enums TS only

### `scripts/{backfill-stripe-connect-flags,audit-cleanup-orphan-customers,audit-cleanup-orphan-pms}.ts`
- `backfill-stripe-connect-flags.ts` : `new Stripe(...)`, `stripe.accounts.retrieve`, apiVersion à bumper
- `audit-cleanup-orphan-customers.ts` : `stripe.customers.list` (pagination starting_after/has_more), `stripe.charges.list`, `stripe.customers.del`, types `Stripe.ApiList<Stripe.Customer>`, `Stripe.DeletedCustomer`, apiVersion à bumper
- `audit-cleanup-orphan-pms.ts` : `stripe.customers.retrieve`, `stripe.paymentMethods.list/detach`, types `Stripe.PaymentMethod`, apiVersion à bumper

### Composants client React
- `app/(consumer)/compte/checkout/page.tsx` : `<Elements>`, `<PaymentElement>`, `useStripe()`, `useElements()`, `stripe.confirmCardPayment`, `stripe.confirmPayment`
- `app/(consumer)/compte/paiements/_components/AddCardModal.tsx` : idem + `stripe.confirmSetup`
- `app/(consumer)/compte/paiements/page.tsx` : type `Stripe.Customer`, `Stripe.PaymentMethod`
- `app/(consumer)/compte/paiements/actions.ts` : type `Stripe.Customer`
- `lib/checkout/classify-stripe-error.ts` : type `StripeError` import depuis `@stripe/stripe-js`

### Tests qui mockent Stripe (15 fichiers)
- 10 tests `lib/stripe/*.test.ts` (handlers webhook + customer + cleanup + payouts + sync-account-flags)
- 4 tests `tests/app/api/stripe/*.test.{ts,tsx}` (webhook, refund, ensure-default-pm, create-payment-intent, connect/onboard)
- 3 tests crons (`weekly-payout`, `order-timeout`)
- 2 tests refund-incidents (`classify-error`, `retry-incident`)
- 1 test `tests/app/api/orders/[id]/cancel/route.test.ts`

**Pattern de mock** : `vi.mock("@/lib/stripe/server", () => ({ stripe: { ... } }))`. La plupart re-mockent la classe `Stripe.errors.StripeXxxError` au cas par cas pour reproduire les `instanceof` runtime (cf. `tests/lib/refund-incidents/classify-error.test.ts:5-6` et `tests/app/api/stripe/create-payment-intent/route.test.ts:22-44`).

**Risque tests post-bump** :
- Si v22 change le constructeur des classes d'erreur (peu probable, mais à valider) : les mocks `new MockStripeRateLimitError()` peuvent casser.
- Si la signature `stripe.refunds.create(params, options)` change runtime → tous les `vi.mocked(stripe.refunds.create).toHaveBeenCalledWith(...)` à valider.
- Pour `classify-error.test.ts:432` (`isStripeError(new Stripe.errors.StripeRateLimitError())`) : runtime stable, OK.

## 7. Plan d'exécution recommandé (Lot 2)

### Stratégie : bump groupé + 1 PR atomique

Argument pour le bump groupé : les peerDeps `@stripe/react-stripe-js@2.x` plafonnent stripe-js à v4. Un upgrade séquentiel (server d'abord, client ensuite) ferait sauter ce verrou peerDeps en 2 étapes pour rien — autant tout bumper en 1 PR.

Argument contre split (rejeté) : « ça multiplie les sources de bug ». Compte tenu que côté server le seul fix code est `classify-error.ts`, et que côté client/React aucun fix n'est requis, le risque de régression est porté quasi-exclusivement par l'apiVersion bump. 1 PR garde l'atomicité de validation.

### Ordre des changements

1. **Bumps `package.json`** (1 commit)
   - `stripe: ^17.2.0` → `^22.1.0`
   - `@stripe/stripe-js: ^4.8.0` → `^9.4.0`
   - `@stripe/react-stripe-js: ^2.9.0` → `^6.3.0`
   - `npm install` → vérifier `package-lock.json` (pas de nouvelles deps Stripe transitive parasites)

2. **Bump `apiVersion` 4 sites** (1 commit)
   - `lib/stripe/server.ts:10`
   - `scripts/backfill-stripe-connect-flags.ts:65`
   - `scripts/audit-cleanup-orphan-customers.ts:118`
   - `scripts/audit-cleanup-orphan-pms.ts:87`
   → `"2025-02-24.acacia"` → `"2026-04-22.dahlia"`

3. **Fix v22 `Stripe.errors.StripeError` type predicate** (1 commit)
   - `lib/refund-incidents/classify-error.ts:99` : `e is Stripe.errors.StripeError` → `e is InstanceType<typeof Stripe.errors.StripeError>` (ou `Stripe.ErrorType` si exporté)
   - `lib/refund-incidents/classify-error.ts:169` : signature `extractBase` idem

4. **Vérification TS strict** (`npm run type-check`)
   - Si erreur sur `Elements options` shape (§3.4) → adapter au discriminated union v8.
   - Si erreur sur autres fields (`pi.invoice` etc.) → cross-référencer §2.1.

5. **Run vitest** (`npm test`)
   - 1662 tests doivent rester verts.
   - Si `classify-error.test.ts` ou `create-payment-intent/route.test.ts` échouent (mocks `Stripe.errors.*`) → ajuster les fakes runtime.

### Tests à étendre vs adapter

| Test | Action |
|---|---|
| `tests/lib/refund-incidents/classify-error.test.ts:432` | Pas d'extension. Vérifier que `new Stripe.errors.StripeRateLimitError(...)` reste constructible côté runtime v22. |
| `tests/app/api/stripe/create-payment-intent/route.test.ts:22-44` | Vérifier que la classe mockée `Stripe.errors.StripeIdempotencyError` reproduit toujours l'`instanceof` du code prod. |
| Autres `vi.mock("@/lib/stripe/server", ...)` | Aucune signature changée → no-op probable. |
| **Nouveau test à ajouter (recommandé Lot 2)** | Smoke unit test sur `classify-error.ts` : importer Stripe v22 directement (sans mock) et instancier les 11 classes d'erreur pour valider que `isStripeError()` les détecte toujours. Évite le piège où le runtime change silencieusement. |

### Smoke tests E2E recommandés (Lot 3)

Périmètre minimal pour valider le bump avant merge :

| Test | Outil | Validation |
|---|---|---|
| **PI creation** : `/api/stripe/create-payment-intent` POST avec order pending valide | curl + DB check | `pi.client_secret` retourné, `orders.stripe_payment_intent_id` persisté |
| **Checkout golden path** : Phase 6 nouveau CB + 3DS challenge (carte test `4000003800000446`) + ensure-default-payment-method | UI + `/compte/confirmation/{orderId}` | `paymentIntent.status === succeeded`, dedupe fingerprint si applicable |
| **Webhook fire payment_intent.succeeded** | Stripe CLI `stripe trigger payment_intent.succeeded` | DB `audit_logs` event_type=`order_payment_succeeded`, no `[WEBHOOK_*_ERR]` log |
| **Refund admin manuel** | UI back-office | `refund.id` retourné, `orders.statut=refunded`, `closure_reason=admin_refund` |
| **Cron weekly-payout dry-run** | manuel `npx tsx` ou stub mode | `processWeeklyPayouts()` retourne sans throw, `stripe.transfers.create` accepte `idempotencyKey` |
| **Cron disputes-deadline-check** | curl avec test row dispute fixture | logs `[DISPUTES_DEADLINE_*]` cohérents |
| **Connect onboarding Express** | UI back-office producer | `accounts.create({type:'express', capabilities})` accepté en dahlia, `accountLinks.create` retourne URL valide, webhook `account.updated` propage `charges_enabled/payouts_enabled/details_submitted` |
| **Script `backfill-stripe-connect-flags --apply`** sur env Test | manuel | Aucun `account_invalid` lié au bump |
| **Script `audit-cleanup-orphan-customers`** dry-run | manuel | Pagination `starting_after/has_more` toujours fonctionnelle, T-453 Connect Merchant skip toujours actif |

### Risques résiduels (non détectés par TS)

1. **`Elements options` shape v8 discriminated union** : si TS strict accepte la shape `{ clientSecret, locale, appearance }` sans modif, il reste un risque runtime que stripe-js v9 exige `mode: 'payment'`. Validation : monter le checkout en dev local + ouvrir DevTools console, traquer warning `[Stripe.js] elements options...`.
2. **`stripe.confirmCardPayment` legacy** : non listé comme retiré v9, mais marqué deprecated. Risk : un avertissement console ou une dégradation silencieuse. Smoke test branche "CB enregistrée" Phase 7 obligatoire.
3. **Capabilities API risk requirements (Connect)** : nouveaux fields `requirements.errors[]` peuvent apparaître côté `account.updated`. TerrOir lit uniquement les 3 booléens haut niveau → pas d'impact direct. Mais si Stripe ajoute une capability qui auto-disable `card_payments` lors d'un re-onboarding, un producer pourrait basculer `charges_enabled=false` post-bump. Surveillance des logs `[STRIPE_ACCOUNT_UPDATED]` 48h post-deploy.
4. **Webhook event payload** : événements existants conservent leur shape (le pinning `apiVersion` côté client SDK ne change PAS l'apiVersion des events webhook reçus, qui dépend du **endpoint webhook configuré côté Dashboard Stripe**). À valider que l'endpoint Webhook côté Dashboard Stripe pointe sur la bonne version (recommandé : laisser sur "default" qui suit le compte) ou bumper l'endpoint en même temps via Dashboard.

## 8. Backlog ouvert (post-upgrade, V1.x)

- **Migrer `stripe.confirmCardPayment` (branche CB enregistrée Phase 7)** vers `stripe.confirmPayment` + Payment Element flow, pour cohérence avec le SDK moderne et anticiper un éventuel removal v10+ de `confirmCardPayment`.
- **Supprimer le stub `loadEnv` côté scripts maintenance** : 3 scripts répliquent `loadEnv({ path: resolve(process.cwd(), ".env.local") })`. Refactor en helper partagé `lib/scripts/env-bootstrap.ts`.
- **Ajouter test runtime classify-error.ts contre v22** : importer `Stripe` v22 directement dans un test dédié (sans mock) pour valider que les 11 classes d'erreur sont toujours instanciables — détecte un changement silencieux de constructeur.
- **Centraliser apiVersion** : extraire la chaîne `"2026-04-22.dahlia"` en constant exporté depuis `lib/stripe/server.ts` et l'importer dans les 3 scripts maintenance, pour éviter la divergence à chaque future bump.
- **Audit `@stripe/react-stripe-js/checkout` import path** : si Phase 2 H-2 introduit `useCheckout` ou `CheckoutProvider`, importer depuis le sous-path conformément au split v4.

## 9. Questions / ambiguïtés rencontrées

1. **`Stripe.errors.StripeError` type vs `Stripe.ErrorType`** : le changelog v22 propose 2 alternatives (`typeof Stripe.errors.StripeError` ou `Stripe.ErrorType`). Préférer `InstanceType<typeof ...>` pour minimiser la dépendance à un export précis qui peut bouger en v23. À valider TS strict en Lot 2.
2. **`stripe.confirmCardPayment` deprecation status v9** : pas de mention explicite dans le changelog dahlia. Hypothèse : conservé runtime, deprecated par doc. À confirmer en smoke test Lot 3.
3. **Webhook endpoint apiVersion côté Dashboard Stripe** : non géré par le code TerrOir. Recommandation : vérifier en Dashboard que l'endpoint pointe sur "default" (suit l'apiVersion compte) et pas sur une version pinned ancienne. Hors scope code, mais à inclure dans la checklist Lot 3.
4. **react-stripe-js@7 ETA ?** : v6.3.0 deprecate `useCheckout` au profit de `useCheckoutElements`/`useCheckoutForm` (planned removal v7). TerrOir n'utilise aucun de ces hooks → no-op pour l'instant, mais à reflag si Phase 2 H-2 Connect v2 introduit Checkout Sessions.
