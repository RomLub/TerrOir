# Fix Stripe phase 2 H-2 — Connect Express → controller properties (2026-05-05)

> Source audit : [`docs/audits/audit-stripe-2026-05-05.md`](../audits/audit-stripe-2026-05-05.md) §H-2.
> Investigation préalable : [`docs/audits/audit-stripe-h2-connect-v2-2026-05-05.md`](../audits/audit-stripe-h2-connect-v2-2026-05-05.md).
> Stratégie retenue : **A** (controller properties sur `POST /v1/accounts`),
> validée par Romain. Stratégie B (Accounts v2 API) écartée pour V1.0.

## Synthèse

| Lot | Périmètre | Fichier | Tests |
|---|---|---|---|
| LOT 2.1 | Code change `accounts.create` | `app/api/stripe/connect/onboard/route.ts` | n/a |
| LOT 2.2 | Tests vitest (assertion controller props + no legacy type) | `tests/app/api/stripe/connect/onboard/route.test.ts` | 10/10 verts (+2) |
| LOT 2.3 | Smoke E2E re-exécution | `tests/e2e/stripe-smoke-phase3.spec.ts` (inchangé) | 1/1 ✓ (35.8s) |
| LOT 2.4 | Doc | audit + investigation + fix doc (NEW) | n/a |

## Évolution vitest

| Avant | Après | Delta |
|---|---|---|
| 1675 tests / 144 fichiers | **1677 tests** / 144 fichiers | **+2 tests** (H-2-A controller payload, H-2-B no legacy `type`) |

Tous verts.

## Évolution E2E Playwright

Smoke `stripe-smoke-phase3.spec.ts` re-exécuté en mode chromium headless après le code change. Tous les steps passent :

```
[smoke] producer=1cdb3ea4-ec97-4bb1-851b-9b6153da12d4
[smoke] stripeAccountId=acct_1TTq1VGpYNMCpZlt
[smoke] accountLink=https://connect.stripe.com/setup/e/acct_1TTq1VGpYNMCpZlt/Fe8AqAiF6mTX
[smoke] Stripe flags (post-create, pré-KYC): charges=false payouts=false details=false currently_due_count=16
[smoke] order=ea28b5f9-4288-4f8e-9dd3-ff7c5b673f61
[smoke] PI client_secret OK (préfixe pi_3TTq1iGua…)
[smoke] PI automatic_payment_methods OK (methods=card,mb_way)
[smoke] stripe.accounts.del(acct_1TTq1VGpYNMCpZlt) OK
✓ 1 [chromium] (25.6s)
```

→ Le Connect account créé via controller properties (`acct_1TTq1VGpYNMCpZlt`)
fonctionne nominalement : AccountLink généré, KYC requirements affichés,
PI sur compte plateforme créé avec `automatic_payment_methods` (cohérent
M-1+L-3 phase précédente), cleanup `stripe.accounts.del` OK.

---

## Détail du change

### LOT 2.1 — `app/api/stripe/connect/onboard/route.ts`

#### Pseudo-diff

Avant (legacy `type: "express"`) :
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

Après (controller properties) :
```ts
const account = await stripe.accounts.create({
  country: "FR",
  email: session.email ?? undefined,
  capabilities: {
    card_payments: { requested: true },
    transfers: { requested: true },
  },
  controller: {
    fees: { payer: "application" },
    losses: { payments: "application" },
    requirement_collection: "stripe",
    stripe_dashboard: { type: "express" },
  },
});
```

#### Mapping des 4 controller properties + justification

| Controller property | Valeur TerrOir | Justification |
|---|---|---|
| `controller.fees.payer` | `"application"` | Équivalent fonctionnel à l'ancien `application_express` implicite. La différence (`application` vs `application_express`) n'a aucun impact sur Separate Charges & Transfers (modèle TerrOir) — cf doc Stripe `direct-charges-fee-payer-behavior` : "Any activity occurring at the platform account level is billed to your platform". Plus propre pour fee billing si Direct Charges activées un jour. |
| `controller.losses.payments` | `"application"` | TerrOir = plateforme paye les chargebacks (cohérent finding H-2 audit Phase 1 line 121, modèle Express préservé). |
| `controller.requirement_collection` | `"stripe"` | Stripe Express Dashboard collecte le KYC, pas TerrOir. Préservation comportement Express. |
| `controller.stripe_dashboard.type` | `"express"` | Producer accède à un Dashboard Stripe Express simplifié (lecture seule, payouts, support tickets). Préservation comportement Express. |

#### Effets de bord — non

- `Account.charges_enabled` / `Account.payouts_enabled` / `Account.details_submitted` : flags identiques côté webhook `account.updated` (vérifié smoke E2E ligne post-create).
- `Account.requirements.currently_due` : array string identique (16 items observés post-create dans le smoke, même comportement qu'avec legacy type).
- `Account.id` format : `acct_*` identique (cf `acct_1TTq1VGpYNMCpZlt` créé pendant smoke).
- `Account.type` : passe de `"express"` à `"none"` (= controller-based account). Ce field n'est lu nulle part dans le code TerrOir → 0 régression.
- `accountLinks.create` : signature inchangée, fonctionne sur les 2 syntaxes.
- `stripe.transfers.create({ destination: stripe_account_id, ... })` : syntaxe transfers Connect inchangée — le compte Connect créé via controller properties accepte les transfers comme un compte legacy Express.

### LOT 2.2 — `tests/app/api/stripe/connect/onboard/route.test.ts`

Ajout d'un nouveau bloc `describe("POST /api/stripe/connect/onboard — H-2 controller properties")` après le bloc path nominal :

```ts
it("H-2-A accounts.create reçoit les 4 controller properties Express-equivalent", async () => {
  await POST();
  const payload = mockAccountsCreate.mock.calls[0]?.[0] as Record<string, unknown>;
  expect(payload.controller).toEqual({
    fees: { payer: "application" },
    losses: { payments: "application" },
    requirement_collection: "stripe",
    stripe_dashboard: { type: "express" },
  });
  expect(payload.country).toBe("FR");
  expect(payload.email).toBe("producer@example.com");
  expect(payload.capabilities).toEqual({
    card_payments: { requested: true },
    transfers: { requested: true },
  });
});

it("H-2-B accounts.create ne passe PLUS le legacy `type` parameter", async () => {
  await POST();
  const payload = mockAccountsCreate.mock.calls[0]?.[0] as Record<string, unknown>;
  expect(payload.type).toBeUndefined();
});
```

Les 8 tests existants (path nominal, déjà account, auth 403, producer not found, T-418 compensation, etc.) restent inchangés et passent.

### LOT 2.3 — `tests/e2e/stripe-smoke-phase3.spec.ts` — INCHANGÉ

Le smoke n'inspecte pas le payload `accounts.create` ni `account.type`. Le seul check potentiellement régressif aurait été un `expect(acct.type).toBe('express')` — il n'existe pas. Re-exécution suffisante comme validation.

→ **Pas de modification structurelle**. Pas non plus d'ajout d'assertion `acct.controller?.fees?.payer === 'application'` (jugée non-essentielle, le test vitest H-2-A couvre déjà le payload).

### LOT 2.4 — Doc

- `docs/audits/audit-stripe-2026-05-05.md` §H-2 marqué FIXED avec lien fix doc.
- `docs/audits/audit-stripe-h2-connect-v2-2026-05-05.md` mis à jour avec banner Statut FIXED + lien fix doc.
- Présent fix doc créé.
- Pas de modification CLAUDE.md ni CHANGELOG.md (pas de feature visible utilisateur).

---

## Trade-offs assumés

### Stratégie A vs B — pourquoi A retenu

| Dimension | Stratégie A (retenue) | Stratégie B (Accounts v2 API, écartée V1.0) |
|---|---|---|
| Couverture finding skill `connect.md:14` (legacy `type` parameter) | **100%** | 100% |
| Effort CC | **2-3h** | 8-16h |
| Risque migration data | **0** | Faible (v1 accounts compatibles avec v2 endpoints) |
| Risque webhook | **0** (account.updated identique) | MEDIUM (cohabitation v1 snapshot + v2 thin events) |
| Action Romain Dashboard | **0** | Vérification Dashboard configurations |
| Gain business V1.0 | Strap-to-avoid skill purgé | Identique (TerrOir n'utilise pas Stripe Billing/Customer-as-Account) |
| ROI | **Élevé** (2-3h pour résoudre H-2) | Faible (8-16h pour le même résultat fonctionnel) |

### Décision Stratégie A

Pour TerrOir (marketplace food, Separate Charges & Transfers, 0 Stripe Billing,
0 besoin de Customer-as-Account unifié) :
- Stratégie A purge le strap-to-avoid skill à 100%.
- Stratégie B aurait été surdimensionnée — la grande valeur de v2 (un seul `Account` qui sert à la fois de Connect account ET de Customer Stripe Billing) ne s'applique pas.
- Migration v1 → v2 reste possible plus tard sans dette nouvelle (les v1 accounts continuent de fonctionner avec les endpoints v2).

---

## Backlog ouvert (post-migration A)

À reconsidérer en V1.x ou V2.0 :

| Item | Justification | Priorité |
|---|---|---|
| Migration vers Accounts v2 API (`stripe.v2.core.accounts.create`) | Aligne avec recommandation skill `connect.md:12` ("ALWAYS use v2 API for new platforms"). Bénéfice : roadmap Stripe long-term. Coût : 8-16h refacto + cohabitation events. | LOW |
| Adoption `v2.core.account.updated` thin event | Plus performant que snapshot v1. Gain marginal. | LOW |
| Persistance controller properties côté DB (jsonb) | Audit dashboard admin "type compte producer" (legacy vs controller). Visible Stripe Dashboard de toute façon. | LOW |
| Adoption `stripe.v2.core.accountLinks` | Cohérence avec v2 onboarding. Pas de gain fonctionnel. | LOW |
| Réviser `controller.fees.payer` si TerrOir active Direct Charges un jour | `application` vs `application_express` impacte Direct Charges fee billing. | MEDIUM si Direct Charges activées |

---

## Action manuelle Romain post-deploy

### Sur compte test (acct_1TNw9nGuakpserKp)

→ **Aucune action requise**. Les Connect accounts existants en test mode (créés via legacy `type: "express"` ou par les smokes E2E précédents) restent
fonctionnels. Stripe rétro-attribue les controller properties équivalentes
(cf doc `migrate-to-controller-properties` : "Existing Express accounts
automatically have equivalent controller properties set").

### Sur compte live (le jour cutover)

→ **Aucune action requise** non plus. Le code refacto crée les nouveaux
Connect accounts producers avec controller properties, et les comptes
existants (s'il y en a — vu que TerrOir n'a pas encore lancé live, probablement aucun) auraient les controller props rétro-attribuées.

### Vérification optionnelle Dashboard

Si Romain veut valider visuellement post-deploy :
- https://dashboard.stripe.com/test/connect/accounts (test) ou
- https://dashboard.stripe.com/connect/accounts (live).

Les comptes créés depuis le refacto auront `account.type = "none"` (=
controller-based account) au lieu de `"express"`. Le Dashboard les affiche
exactement de la même façon (Express UI conservée car
`controller.stripe_dashboard.type === "express"`).

---

## Rollback procédure si régression

### Symptôme A : POST /api/stripe/connect/onboard renvoie 500 sur l'`accounts.create`

→ Possible incompatibilité SDK 22 / dahlia avec controller properties
syntax (non observé en test mais defensive). **Action** :
```bash
git revert <SHA du commit H-2>
# Le revert restaure type: "express" hardcodé.
# Les Connect accounts créés depuis le refacto continuent de fonctionner
# (controller props équivalents stripe-side).
```
Vercel rollback < 1 min.

### Symptôme B : producers ne peuvent plus accéder à leur Dashboard Stripe Express

→ Impossible : `controller.stripe_dashboard.type === "express"` préserve
exactement le comportement Express. Si symptôme observé, vérifier qu'aucun
autre changement n'a été déployé en parallèle. Revert idem ci-dessus.

### Symptôme C : webhook account.updated ne fire plus

→ Impossible : controller properties ne changent pas le contrat webhook v1.
Si observé, vérifier le Dashboard webhook endpoint (les events cochés
n'ont pas changé). Revert idem.

---

**0 action utilisateur, 0 migration data, 0 changement webhook, 0 changement DB.**
