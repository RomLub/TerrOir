# Migration Connect Express v1 → v2 — plan d'audit (H-2) ✅ FIXED

> **Statut 2026-05-05** : Stratégie A (controller properties sur v1) **VALIDÉE
> par Romain et APPLIQUÉE**. Cf
> [`docs/fixes/fix-stripe-phase-2-h2-connect-controller-properties-2026-05-05.md`](../fixes/fix-stripe-phase-2-h2-connect-controller-properties-2026-05-05.md).
> +2 tests vitest. Smoke E2E re-exécuté OK. 0 action Romain Dashboard.

**Date** : 2026-05-05
**Source audit** : [`docs/audits/audit-stripe-2026-05-05.md`](./audit-stripe-2026-05-05.md) §H-2.
**Investigation préalable** : [`docs/audits/audit-stripe-m1-l3-investigation-2026-05-05.md`](./audit-stripe-m1-l3-investigation-2026-05-05.md), [`docs/audits/audit-stripe-sdk-upgrade-plan-2026-05-05.md`](./audit-stripe-sdk-upgrade-plan-2026-05-05.md).
**Mode** : READ-ONLY. Aucune modification, aucun apply Stripe, aucun bump.
**Sources lues** :
- skill `stripe-best-practices/references/connect.md` intégral (49 lignes).
- doc Stripe officielle :
  - https://docs.stripe.com/connect/migrate-to-controller-properties (migration v1 type → controller props sur v1)
  - https://docs.stripe.com/connect/accounts-v2 (v2 API GA/preview status)
  - https://docs.stripe.com/connect/accounts-v2/migrate-integration (migration v1 → v2 API)
  - https://docs.stripe.com/connect/direct-charges-fee-payer-behavior (impact `fees.payer` application vs application_express)
  - https://docs.stripe.com/connect/account-tokens (exemple controller props payload)
  - https://docs.stripe.com/api/v2/core/accounts (api reference partielle)
  - https://docs.stripe.com/billing/subscriptions/build-subscriptions (Accounts v2 in preview pour non-Connect users)
- SDK Stripe 22.1.0 : `node_modules/stripe/esm/resources/V2/Core/Accounts.d.ts` (6951 lignes types), `AccountLinks.d.ts`.

---

## Synthèse priorisée

### Découverte clé : H-2 a 2 stratégies, pas une seule

Le brief initial parle de "migration v1 Express → v2 API + controller properties". **Ce sont en réalité 2 chantiers distincts qui résolvent partiellement le même finding :**

| Stratégie | Endpoint | Dispo | Effort | Risque | Couvre H-2 ? |
|---|---|---|---|---|---|
| **A — Controller properties on v1** | `POST /v1/accounts` (= `stripe.accounts.create`) | **GA** | **1-2h** | **LOW** | **Oui à 100%** |
| **B — Accounts v2 API** | `POST /v2/core/accounts` (= `stripe.v2.core.accounts.create`) | **GA pour Connect** mais schéma massif (6951 lignes types) | **8-16h** | **MEDIUM/HIGH** | Oui mais surdimensionné |

> **La doc Stripe migrate-to-controller-properties est très explicite : la migration v1 type → controller properties est une stratégie standalone, qui RESTE sur v1. Aucune obligation de passer à v2 pour résoudre le strap-to-avoid du skill.**

### Recommandation forte

**Stratégie A (controller properties on v1)** pour TerrOir, V1.0 go-live.

Justification :
1. **Le finding H-2 strict est résolu à 100%** : le skill connect.md `:14` dit "Don't use the legacy `type` parameter (`type: 'express'`, ...) in `POST /v1/accounts` for new platforms". La stratégie A retire `type: "express"` et passe par controller properties — strap-to-avoid purgé.
2. **Aucun gain business côté Stratégie B** pour TerrOir : la grande valeur de v2 (un seul `Account` qui sert à la fois de connected account ET de Customer Stripe Billing) ne s'applique pas — TerrOir n'utilise pas Stripe Billing/subscriptions.
3. **Aucun gain d'architecture côté Stratégie B** pour Separate Charges & Transfers : la doc `migrate-integration` ne mentionne aucun changement sur les flows PI + transfer côté plateforme. v2 s'occupe de la représentation Account, pas du flow paiement.
4. **`fees.payer` impact nul** : le brief mentionne la "discrimination tracée pour fee billing" entre `application_express` (legacy type) et `application` (controller props), mais cette différence ne s'applique qu'aux Direct Charges, pas à Separate Charges & Transfers de TerrOir (cf doc `direct-charges-fee-payer-behavior` : "Any activity occurring at the platform account level is billed to your platform, regardless of which entity is responsible for collecting fees").
5. **Stratégie B peut attendre V1.x** sans dette nouvelle : la migration v1 → v2 reste possible plus tard et **les comptes Connect v1 existants restent compatibles avec les endpoints v2** ("The Accounts v2 API works with your existing v1 Accounts, without requiring any modifications").
6. **Risque preview v2** : v2 est en public preview pour des usages non-Connect (cf doc bank-transfers : "in public preview for other Stripe users"). Pour Connect, semble GA mais le SDK 22 expose un schéma extrêmement large (configuration merchant/customer/recipient) qui change l'invariant d'aujourd'hui (un Account = un producer). Risque d'introduction d'inconnues.

### Compteurs effort / fichiers / risque (Stratégie A)

| Dimension | Stratégie A |
|---|---|
| Code applicatif touché | 1 fichier (`onboard/route.ts`) |
| Tests touchés | 1 fichier vitest (`onboard/route.test.ts`) — pas de modification structurelle, juste mise à jour des assertions sur le payload `accounts.create` |
| Tests E2E touchés | 1 spec à ré-exécuter (`stripe-smoke-phase3.spec.ts`) sans modification |
| Webhook handler | **0 changement** (account.updated reste identique en v1+controller props) |
| DB schema | **0 migration** (stripe_account_id reste un string `acct_*`) |
| Backfill / migration de données | **0 action** (les producers existants restent valides — controller props sont équivalent fonctionnel à `type: "express"`) |
| Effort total CC | **2-3h** (incluant rédaction commit + tests) |
| Effort total Romain | **0 action manuelle Dashboard** (pas de bascule, pas de webhook update) |
| Risque global | **LOW** |

### Compteurs Stratégie B (rejetée pour V1.0 mais documentée pour V1.x ouvert)

| Dimension | Stratégie B |
|---|---|
| Code applicatif touché | 4-6 fichiers (onboard, sync-account-flags, handle-account-deauthorized, webhook switch, backfill script, peut-être payouts.tsx) |
| Tests touchés | 4-6 fichiers vitest (réécriture partielle des mocks Account) |
| Tests E2E | 1 spec à adapter (la signature `stripe.accounts.create` change pour `stripe.v2.core.accounts.create`) |
| Webhook handler | **CHANGEMENT** : v2 émet `v2.core.account.updated` en parallèle de `account.updated` (cf doc migrate-integration : "Both event types fire"). Décision : écouter v1 ou v2 ou les 2 ? |
| DB schema | Probablement 0 migration (ID format `acct_*` identique) mais à confirmer pour les controller properties stockées si on veut les persister |
| Backfill | Optionnel — les comptes v1 existants fonctionnent en v2 sans migration |
| Effort total CC | **8-16h** (parsing du nouveau schéma Account, configurations merchant, refacto sync-account-flags) |
| Effort total Romain | Vérification Dashboard (configurations enabled?), preview header pinning à confirmer |
| Risque global | **MEDIUM** (schéma 6951 lignes types, public preview pour certains usages) |

---

## 1. Mapping Connect v1 Express → v2 controller properties

### Mapping documenté (Stratégie A — sur v1)

Source : doc Stripe `connect/migrate-to-controller-properties`.

| Express implicite (legacy) | controller property explicite (recommandé) | Valeur TerrOir | Trade-off |
|---|---|---|---|
| `type: "express"` → `controller.fees.payer = "application_express"` | `controller.fees.payer = "application"` | `"application"` | Aucun impact Separate C&T (cf §Recommandation point 4). Plus propre pour fee billing si Direct Charges un jour. |
| `type: "express"` → `controller.losses.payments = "application"` | `controller.losses.payments = "application"` | `"application"` (inchangé) | TerrOir = plateforme paye chargebacks (cf audit H-2 line 121). Décision préservée. |
| `type: "express"` → `controller.requirement_collection = "stripe"` | `controller.requirement_collection = "stripe"` | `"stripe"` (inchangé) | Stripe Dashboard Express collecte le KYC, pas TerrOir. Préservé. |
| `type: "express"` → `controller.stripe_dashboard.type = "express"` | `controller.stripe_dashboard.type = "express"` | `"express"` (inchangé) | Producer accède à un Dashboard Stripe Express (lecture seule, simplifié). Préservé. |

**Résumé** : les 4 valeurs sont `application/application/stripe/express`. Seul `fees.payer` change réellement (`application_express` → `application`) et l'impact pratique est nul pour TerrOir.

### Capabilities — syntaxe identique

```ts
capabilities: {
  card_payments: { requested: true },
  transfers: { requested: true },
}
```
Ce bloc reste IDENTIQUE entre legacy `type: "express"` et controller properties. Pas de refacto.

### Country, email, business_type

- `country: "FR"` — IDENTIQUE.
- `email: session.email ?? undefined` — IDENTIQUE.
- `business_type` : déjà retiré en Phase 1 L-2 (commit `f56d95d`), aucun changement.

### Mapping Stratégie B (Accounts v2 API)

Pour information seulement — non recommandé V1.0.

| v1 controller-props | v2 configuration |
|---|---|
| `controller.fees.payer` | `configuration.merchant.fees.payer` (à confirmer) |
| `controller.losses.payments` | `configuration.merchant.losses.payments` (à confirmer) |
| `controller.requirement_collection` | `configuration.merchant.requirement_collection` (à confirmer) |
| `controller.stripe_dashboard.type` | `configuration.dashboard.type` (à confirmer) |
| `capabilities.card_payments.requested` | `configuration.merchant.capabilities.card_payments.requested` |
| `capabilities.transfers.requested` | `configuration.merchant.capabilities.stripe_balance.stripe_transfers.requested` (renommé v2) |

> Le SDK 22 expose `stripe.v2.core.accounts.create({ configuration: { merchant: {...}, customer: {...}, recipient: {...} }, identity: {...}, defaults: {...} })`. Le schéma exact est dans `node_modules/stripe/esm/resources/V2/Core/Accounts.d.ts:3388-3580` (param create) — 200+ lignes uniquement pour la signature de create. À étudier en détail uniquement si Stratégie B est retenue.

---

## 2. Code applicatif à modifier (Stratégie A)

### 2.1 `app/api/stripe/connect/onboard/route.ts:38-46` — diff

Avant :
```ts
const account = await stripe.accounts.create({
  type: "express",
  country: "FR",
  email: session.email ?? undefined,
  capabilities: {
    card_payments: { requested: true },
    transfers: { requested: true },
  },
});
```

Après (Stratégie A) :
```ts
const account = await stripe.accounts.create({
  controller: {
    fees: { payer: "application" },
    losses: { payments: "application" },
    requirement_collection: "stripe",
    stripe_dashboard: { type: "express" },
  },
  country: "FR",
  email: session.email ?? undefined,
  capabilities: {
    card_payments: { requested: true },
    transfers: { requested: true },
  },
});
```

Commentaire à ajouter (audit H-2 trace + skill best-practices) :
```ts
// Audit Stripe H-2 (2026-05-05) — controller properties au lieu du legacy
// `type: "express"`. Mapping fonctionnel équivalent (cf
// docs/audits/audit-stripe-h2-connect-v2-2026-05-05.md §1) : losses=application,
// fees=application (vs application_express en legacy — sans impact Separate
// Charges & Transfers pour TerrOir), requirement_collection=stripe, dashboard=
// express. Préserve KYC Stripe-side et Dashboard producer Express.
```

### 2.2 `lib/stripe/sync-account-flags.ts` — INCHANGÉ

L'objet `Stripe.Account` retourné côté webhook `account.updated` reste IDENTIQUE entre legacy type et controller properties (mêmes flags `charges_enabled`, `payouts_enabled`, `details_submitted`, `requirements.currently_due`). **0 modification**.

### 2.3 `app/api/stripe/webhook/route.tsx` — INCHANGÉ

Stratégie A reste sur les events v1 (`account.updated`, `account.application.deauthorized`, etc.). **0 modification**.

(Stratégie B obligerait à arbitrer entre `account.updated` v1 et `v2.core.account.updated`, et potentiellement à ajouter de nouveaux events comme `v2.core.account.configuration.updated`.)

### 2.4 `lib/stripe/handle-account-deauthorized.tsx` — INCHANGÉ

Idem : event `account.application.deauthorized` reste émis sur les comptes créés via controller properties. **0 modification**.

### 2.5 `scripts/backfill-stripe-connect-flags.ts` — INCHANGÉ

Le script appelle `stripe.accounts.retrieve(p.stripe_account_id)` qui renvoie un `Stripe.Account` v1, identique entre legacy type et controller props. **0 modification**.

### 2.6 `tests/app/api/stripe/connect/onboard/route.test.ts` — adaptation

Ligne 156-176 (test path nominal) : assertion sur `mockAccountsCreate` doit valider le NEW payload :
```ts
expect(mockAccountsCreate).toHaveBeenCalledWith(
  expect.objectContaining({
    controller: {
      fees: { payer: "application" },
      losses: { payments: "application" },
      requirement_collection: "stripe",
      stripe_dashboard: { type: "express" },
    },
    country: "FR",
    capabilities: expect.objectContaining({
      card_payments: { requested: true },
      transfers: { requested: true },
    }),
  }),
);
```
Et NE plus contenir `type: "express"`.

Ajout d'un test `H-2-A` explicite : "ne passe plus le legacy `type` parameter".

### 2.7 `tests/e2e/stripe-smoke-phase3.spec.ts` — INCHANGÉ

Le smoke onboarde un Connect account et `stripe.accounts.retrieve(stripeAccountId)` est utilisé pour valider l'ID. Pas de check sur `account.type`. **0 modification structurelle**.

> **Note** : le compte créé pendant le smoke aura désormais `account.type === "none"` (= controller-based account) au lieu de `"express"`. Si Romain veut tracer ça côté E2E pour défense en profondeur, ajouter `expect(acct.controller?.type).toBe('application')` ligne 119+ — mais c'est optionnel.

---

## 3. Migration des accounts existants

### Statut Stripe-side

> **Citation doc Stripe migrate-to-controller-properties** : "You don't need to update your connected accounts. When you update your integration to work with controller properties, you don't need to update your existing connected accounts. Existing Express accounts automatically have equivalent controller properties set."

→ **Aucune migration des Connect accounts v1 existants n'est nécessaire**. Stripe rétro-attribue les controller properties équivalentes sur les comptes legacy `type: "express"`.

### Compte test acct_1TNw9nGuakpserKp (TerrOir test)

→ Pas de migration Stripe-side. Reste utilisable tel quel après le code change.

### Smoke E2E (compte créé puis supprimé)

→ Le smoke `stripe-smoke-phase3.spec.ts` crée un account via le code refacto puis appelle `stripe.accounts.del(stripeAccountId)` en cleanup. **Aucun account test ne traîne** entre runs.

### Producers TerrOir réels

```
Audit côté DB (read-only via MCP Supabase) — à exécuter au moment de l'apply :
SELECT count(*) FROM producers WHERE stripe_account_id IS NOT NULL AND statut <> 'deleted';
```

→ À reporter au moment de l'apply. Vu le statut go-live (mai 2026, pas encore lancé live), le compte test contient probablement 1-3 Connect accounts test (Romain + smoke résiduels). **0 producer live n'existe encore**, donc aucun risque migration data.

### MCP Stripe — limitation

Le MCP `fetch_stripe_resources` n'accepte que les préfixes `pi_/ch_/in_/price_/prod_/sub_/cus_` — **PAS les Connect accounts (`acct_*`)**. Et `stripe_api_search` ne retourne pas l'opération `GetAccounts`. Conséquence : impossible de spot-check via MCP les Connect accounts existants. **Vérification manuelle Romain via Dashboard** (`https://dashboard.stripe.com/test/connect/accounts` + `https://dashboard.stripe.com/connect/accounts` après bascule live).

---

## 4. Webhook events v1 → v2

### Stratégie A (recommandée) — aucun changement webhook

| Event Stripe TerrOir actuel | Statut sur compte controller-properties |
|---|---|
| `account.updated` | ✅ identique (Account v1 schema) |
| `account.application.deauthorized` | ✅ identique |
| `payment_intent.succeeded` / `payment_intent.payment_failed` | ✅ identique (PI sur compte plateforme, pas Connect) |
| `charge.dispute.created/updated/closed` | ✅ identique |
| `payout.paid/failed` | ✅ identique |
| `radar.early_fraud_warning.created` (M-3) | ✅ identique |
| `charge.refunded` (M-3) | ✅ identique |

→ **DEDUP_TARGETS de webhook/route.tsx:64-91 INCHANGÉ**. 0 nouveau event à cocher Dashboard Stripe.

### Stratégie B (rejetée) — events à arbitrer

Pour information seulement — si Romain choisit B en V1.x.

| Event v1 | Event v2 équivalent | Décision | Risque |
|---|---|---|---|
| `account.updated` (snapshot) | `v2.core.account.updated` (thin event) | Écouter v1 OU v2 (pas les 2 — dédup applicative serait double-count). v1 plus simple à conserver. | LOW si on garde v1 |
| `account.application.deauthorized` | À confirmer (`v2.core.account.deauthorized` ?) | À investiguer | MEDIUM (pas trouvé dans le doc fetch) |

> **Citation doc Stripe migrate-integration** : "Accounts generate both v1 (snapshot) and v2 (thin) events". Donc v1 reste émis même sur des accounts v2. La cohabitation est possible. À documenter explicitement si Stratégie B retenue.

---

## 5. AccountLinks v1 vs v2

### v1 (actuel TerrOir)

```ts
const accountLink = await stripe.accountLinks.create({
  account: stripeAccountId,
  refresh_url: `${PRODUCER_URL}/connect/refresh`,
  return_url: `${PRODUCER_URL}/connect/done`,
  type: "account_onboarding",
});
```
→ Endpoint `POST /v1/account_links`. Reste GA, supporté en parallèle de v2.

### v2 (alternative pour Stratégie B)

SDK 22 expose `stripe.v2.core.accountLinks.create(...)` (cf `node_modules/stripe/esm/resources/V2/Core/AccountLinks.d.ts`). Endpoint `POST /v2/core/account_links`. Format params différent (à étudier si Stratégie B retenue).

### Recommandation

**Stratégie A → garder `stripe.accountLinks.create` v1**. Aucun changement. Le code TerrOir actuel continue de fonctionner avec un Connect account créé via controller properties.

---

## 6. DB schema impact

### Schéma actuel TerrOir

```sql
-- migration 20260424000000_producers_stripe_connect_flags.sql
alter table public.producers add column stripe_account_id text;
alter table public.producers add column stripe_charges_enabled boolean default false;
alter table public.producers add column stripe_payouts_enabled boolean default false;
alter table public.producers add column stripe_details_submitted boolean default false;
```

### Stratégie A — aucune migration

`stripe_account_id` reste un string `acct_*`. Format ID identique. Les 3 flags lus côté webhook restent les mêmes (Account v1 schema préservé). **0 migration DB**.

### Stratégie B — peut-être une migration

Si on veut persister les controller properties côté TerrOir (pour audit/dashboard admin), ajouter une colonne `stripe_account_controller jsonb`. Mais pas obligatoire — peut être lu live via `stripe.accounts.retrieve` à chaque besoin. **0 migration DB obligatoire** même en B.

---

## 7. Smoke E2E impact

### tests/e2e/stripe-smoke-phase3.spec.ts

Step A (ligne 71-98) : drive le POST `/api/stripe/connect/onboard` qui appelle indirectement `stripe.accounts.create({ ... controller props ... })` après refacto. Le smoke n'inspecte pas le payload, juste l'AccountLink retourné + l'`account_id` persistée DB.

→ **0 modification structurelle** du smoke. Le smoke continuera de passer après refacto.

Step B (ligne 116-156) : appelle `stripe.accounts.retrieve(stripeAccountId)` pour simuler le webhook account.updated. L'objet retourné reste un `Stripe.Account` v1 — le code de simul `syncStripeAccountFlags` reste identique.

→ **0 modification structurelle**.

Step C (ligne 158-256) : appelle `/api/stripe/create-payment-intent` (M-1+L-3 fix déjà mergé) qui crée un PI côté plateforme (pas sur le Connect account). Indépendant de Connect H-2.

→ **0 modification structurelle**.

Cleanup (ligne 248-264) : `stripe.accounts.del(stripeAccountId)` — endpoint v1, fonctionne sur tous les Connect accounts (legacy ou controller-props).

→ **0 modification structurelle**.

### Pas besoin d'un nouveau smoke "v2"

Le smoke actuel valide déjà le flow onboard → AccountLink → DB persist → PI create end-to-end. Refacto Stratégie A respecte le même flow : un seul changement de payload sur `stripe.accounts.create`.

### Recommandation

Re-exécuter le smoke après refacto comme validation. **0 nouveau test E2E nécessaire**.

---

## 8. Ordre d'exécution recommandé pour le Lot 2 (fix Stratégie A)

### Sous-lot 2.1 — code change (15 min)

- [ ] `app/api/stripe/connect/onboard/route.ts:38-46` : remplacer `type: "express"` par les 4 controller properties + comment audit H-2.
- [ ] `npx tsc --noEmit` → must pass.

### Sous-lot 2.2 — tests vitest (30 min)

- [ ] `tests/app/api/stripe/connect/onboard/route.test.ts:156-176` : adapter assertion `mockAccountsCreate` payload.
- [ ] Ajouter test `H-2-A` "ne passe plus le legacy `type` parameter" (1 it block).
- [ ] `npx vitest run tests/app/api/stripe/connect/onboard/route.test.ts` → must pass.
- [ ] `npx vitest run` (suite complète) → must pass.
- [ ] `npx next lint --fix` → must pass.

**STOP intermédiaire** ici si Romain veut review avant E2E.

### Sous-lot 2.3 — smoke E2E (10 min CC + 5 min run)

- [ ] Re-exécuter `tests/e2e/stripe-smoke-phase3.spec.ts` localement (npx playwright test) ou laisser CI le faire au push.
- [ ] Vérifier que les 4 steps passent (Onboard, account.updated simul, PI create, cleanup).
- [ ] Optionnel : ajouter `expect(acct.controller?.type).toBe('application')` ligne 119+.

### Sous-lot 2.4 — doc + commit (15 min)

- [ ] Marquer §H-2 FIXED dans `docs/audits/audit-stripe-2026-05-05.md`.
- [ ] Créer `docs/fixes/fix-stripe-phase-2-h2-connect-controller-properties-2026-05-05.md` (template = fix-stripe-phase-2-m1-l3).
- [ ] Pas de migration DB → pas de runbook update.
- [ ] Commit message style audit Phase 2.

### Risques résiduels Stratégie A

1. **Aucun risque sur les producers existants** : controller props sont rétro-équivalentes côté Stripe.
2. **Aucun risque webhook** : account.updated identique.
3. **Aucun risque Romain Dashboard** : aucune action manuelle requise.
4. **Risque mineur** : un test vitest mal mis à jour échoue → fix immédiat dans le sous-lot 2.2.

### Stratégie de rollback

`git revert <SHA>` du commit H-2 — restaure `type: "express"`. Les Connect accounts créés depuis le refacto continuent de fonctionner (controller props équivalents). Vercel rollback < 1 min.

---

## 9. Backlog ouvert (post-migration Stratégie A)

À reconsidérer en V1.x ou V2.0 :

| Item | Justification | Priorité |
|---|---|---|
| Migration vers Accounts v2 API (`stripe.v2.core.accounts.create`) | Aligner avec recommandation skill connect.md `:12` ("ALWAYS use v2 API for new platforms"). Bénéfice : roadmap Stripe long-term. | LOW |
| Adoption `v2.core.account.updated` (thin event) | Plus performant que snapshot v1 (smaller payload). Aligne avec event listening v2. | LOW |
| Persistance controller properties côté DB (jsonb) | Audit dashboard admin "type de compte producer" (legacy vs controller). Visible Stripe Dashboard de toute façon. | LOW |
| Adoption `stripe.v2.core.accountLinks` | Cohérence avec v2 onboarding. Pas de gain fonctionnel. | LOW |
| Réviser `controller.fees.payer` si Direct Charges activées un jour | `application` vs `application_express` impacte Direct Charges fee billing (pas Separate C&T). | MEDIUM si Direct Charges activées |

---

## 10. Décisions à prendre (pour Romain)

### D-1 : Stratégie A vs B

- **Recommandation CC** : **Stratégie A** (controller properties on `POST /v1/accounts`).
- Justifications synthétisées : couvre H-2 à 100% pour le strap-to-avoid skill, 1-2h vs 8-16h, 0 risque webhook/DB/migration, 0 action Romain Dashboard, valeur business v2 = nulle pour TerrOir (pas Stripe Billing, pas Customer-as-Account).
- **Décision Romain à confirmer**.

### D-2 : Si Stratégie A retenue — confirmation des 4 controller property values

Toutes les 4 valeurs sont les équivalents Express directs. Aucune décision nouvelle :
- `controller.fees.payer = "application"` ✓
- `controller.losses.payments = "application"` ✓ (cohérent audit H-2 line 121 : plateforme paye chargebacks)
- `controller.requirement_collection = "stripe"` ✓
- `controller.stripe_dashboard.type = "express"` ✓

**Décision Romain** : valider ou modifier. Si modification → arbitrer ailleurs (out of scope strict H-2).

### D-3 : Si Stratégie B (rejetée par défaut) — questions ouvertes

À considérer uniquement si Romain veut B :
1. Écouter v1 OR v2 events Account ? (recommandation : v1 = simpler).
2. `payouts.tsx` côté TerrOir utilise `stripe.transfers.create({ destination: producer.stripe_account_id, ... })` — fonctionne avec v2 accounts ? **À investiguer doc Stripe** (cf `https://docs.stripe.com/connect/separate-charges-and-transfers` + accounts-v2 specific).
3. SDK 22 + apiVersion `2026-04-22.dahlia` couvre v2 GA pour Connect ? Ou besoin d'un preview header `Stripe-Version` distinct ?
4. Effort réel CC ≥ 12h (le brief dit 8-16h, à valider).

---

## Estimation effort total

| Lot | Stratégie A | Stratégie B (pour info) |
|---|---|---|
| Lot 1 audit (ce doc) | **1h ✓** | 1h ✓ |
| Lot 2 fix (code + tests + lint + E2E) | **2-3h** | 8-16h |
| Lot 3 doc + commit | **30 min** | 1h |
| **Total CC** | **3-4h** | 10-18h |
| Action manuelle Romain | **0** | Vérification Dashboard configurations + decision events v1/v2 |
| Risque global | **LOW** | MEDIUM/HIGH |
| ROI go-live | Strap-to-avoid skill purgé, pas de dette technique au lancement | Identique + pivot vers roadmap Stripe long-term (mais TerrOir n'en a pas besoin V1.0) |

---

## Questions / ambiguïtés rencontrées

1. **Le brief utilise "v1 → v2 + controller properties" comme un seul chantier**, alors que la doc Stripe les sépare. Le rapport clarifie : controller props est sur v1, v2 est un autre chantier. → décision D-1 ci-dessus.
2. **MCP Stripe ne supporte pas `acct_*`** dans `fetch_stripe_resources`. Spot-check Connect accounts impossible via MCP. Reporté à Romain via Dashboard.
3. **WebFetch sur `https://docs.stripe.com/api/v2/core/accounts`** ne retourne pas la signature complète (probablement page documentation auto-générée non-indexée par le model). Compensé par lecture directe des types SDK 22 (`Accounts.d.ts:3388-3580`).
4. **Status Accounts v2 pour Connect** : la doc bank-transfers dit "GA for Connect users, public preview for other Stripe users". Donc v2 est GA pour notre cas, mais le SDK SDK 22 inclut un schéma extrêmement large (configurations merchant/customer/recipient). Nécessite étude détaillée si Stratégie B retenue.
5. **`payouts.tsx` compatibilité v2** : non investigué dans ce LOT 1 (out of scope strict H-2). Si Romain choisit B, à vérifier dans le LOT 2.
6. **Compte test (acct_1TNw9nGuakpserKp) flags actuels** : audit M-1+L-3 mentionne `livemode: false` ✓, mais le rapport actuel n'inspecte pas explicitement les flags `charges_enabled` / `payouts_enabled` du compte test plateforme (différent du Connect account créé pendant smoke). Romain peut le vérifier via Dashboard si besoin.

---

**Aucune action n'a été appliquée. Liste pour arbitrage.**
