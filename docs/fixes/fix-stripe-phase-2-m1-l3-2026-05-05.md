# Fix Stripe phase 2 M-1 + L-3 — dynamic payment methods + Apple Pay/Google Pay (2026-05-05)

> Source audit : [`docs/audits/audit-stripe-2026-05-05.md`](../audits/audit-stripe-2026-05-05.md) §M-1 + §L-3.
> Investigation préalable : [`docs/audits/audit-stripe-m1-l3-investigation-2026-05-05.md`](../audits/audit-stripe-m1-l3-investigation-2026-05-05.md).
> Périmètre phase 2 M-1 + L-3 = activer Card + Apple Pay + Google Pay sur le
> checkout consumer (`www.terroir-local.fr`) via `automatic_payment_methods`,
> en remplaçant le `payment_method_types: ['card']` hardcodé. SEPA, Bancontact,
> Klarna : skip explicite (cf §Trade-offs).

## Synthèse

| Lot | Périmètre | Fichiers principaux | Tests |
|---|---|---|---|
| LOT 1 | Script registration domain Stripe | `scripts/register-payment-method-domain.ts` | apply réel test mode (1 fois) |
| LOT 2 | Code change PI route + checkout UI | `app/api/stripe/create-payment-intent/route.ts`, `app/(consumer)/compte/checkout/page.tsx` | n/a |
| LOT 3 | Tests vitest étendus | `tests/app/api/stripe/create-payment-intent/route.test.ts` (+2 tests M-1) | 14/14 verts |
| LOT 4 | Extension E2E Playwright | `tests/e2e/stripe-smoke-phase3.spec.ts` (+ assert `automatic_payment_methods`) | smoke étendu |

## Évolution vitest

| Avant | Après | Delta |
|---|---|---|
| 1673 tests / 144 fichiers | **1675 tests** / 144 fichiers | **+2 tests** |

Tous verts. Détail :
- M-1-A : assert PI créé avec `automatic_payment_methods: { enabled: true, allow_redirects: 'never' }`.
- M-1-B : assert `payment_method_types` n'est plus passé (Stripe Dashboard pilote le set).

## Évolution E2E Playwright

| Avant | Après | Delta |
|---|---|---|
| 2 specs stripe (smoke phase 3 + webhooks-m3) | **2 specs stripe** (smoke phase 3 étendu + webhooks-m3) | **+1 step assert** |

Cas Apple Pay / Google Pay E2E non couverts (skip explicite). Justification : la
modal Wallet Apple Pay requiert un iPhone Safari physique + carte sandbox + biométrie ;
Google Pay requiert Chrome avec compte Google + carte sandbox. Aucun environnement
Playwright headless ne peut authentifier ces flows. Couverture E2E indirecte via
`stripe.paymentIntents.retrieve` qui valide que `automatic_payment_methods.enabled`
est bien `true` côté Stripe → Apple/Google sont proposés par le PaymentElement
si le device les supporte.

---

## Détail par lot

### LOT 1 — Script registration `payment_method_domains`

**Nouveau fichier** : `scripts/register-payment-method-domain.ts` (~150 lignes).

**Découverte clé** (cf investigation §3) : depuis avril 2025, Stripe gère la
vérification Apple Pay sans fichier `.well-known/apple-developer-merchantid-
domain-association`. La registration via `payment_method_domains` API suffit —
Stripe joue le rôle d'Apple Merchant et signe la verification en interne.

Logique idempotente :
1. `stripe.paymentMethodDomains.list({ domain_name, limit: 10 })` → check existence.
2. Si trouvé → log statuses (apple_pay/google_pay/link/paypal) + warn si statuses inactive.
3. Sinon → `stripe.paymentMethodDomains.create({ domain_name })`.
4. Validation post-create : si `apple_pay.status === 'inactive'` ou
   `google_pay.status === 'inactive'` → exit code 2 (signal de problème de config).

Usage :
```bash
npx tsx scripts/register-payment-method-domain.ts                 # dry-run
npx tsx scripts/register-payment-method-domain.ts --apply         # create si absent
npx tsx scripts/register-payment-method-domain.ts --apply --domain shop.terroir-local.fr
```

**Apply réel test mode** (compte `acct_1TNw9nGuakpserKp`) :
```
[REGISTER_PMD] mode=APPLY domain=www.terroir-local.fr secret=test
[REGISTER_PMD] account=acct_1TNw9nGuakpserKp (Environnement de test TerrOir)
[REGISTER_PMD] NOT FOUND — domain à enregistrer.
[REGISTER_PMD] CREATED id=pmd_1TTpcUGuakpserKpzxh2ic0E enabled=true
[REGISTER_PMD] STATUSES apple_pay=active | google_pay=active | link=active | paypal=active
[REGISTER_PMD] OK ✓
```

→ Tous les statuses `active` du premier coup. Le compte test était déjà
provisionné Apple Pay côté Stripe (capabilities par défaut sur compte test EU).

**Action restante** : relancer `--apply` une fois sur le compte LIVE le jour du
cutover (cf §6 actions Romain).

### LOT 2 — Code change PI + checkout

**Fichier 1** : `app/api/stripe/create-payment-intent/route.ts:148-167`.

Avant :
```ts
pi = await stripe.paymentIntents.create({
  amount,
  currency: "eur",
  customer: customerId,
  payment_method_types: ["card"],
  // ...
});
```

Après :
```ts
pi = await stripe.paymentIntents.create({
  amount,
  currency: "eur",
  customer: customerId,
  automatic_payment_methods: {
    enabled: true,
    allow_redirects: "never",
  },
  // ...
});
```

Commentaires inline mis à jour : décision documentée en référence audit M-1
+ L-3, justification `allow_redirects:'never'` (préserve flow single-page,
SEPA reste OUT en V1.1), Link désactivable côté Dashboard sans hardcode.

**Fichier 2** : `app/(consumer)/compte/checkout/page.tsx:625-637`.

Avant :
```tsx
<PaymentElement options={{
  layout: 'tabs',
  wallets: { applePay: 'never', googlePay: 'never' },
}} />
```

Après :
```tsx
<PaymentElement options={{ layout: 'tabs' }} />
```

Le PaymentElement détecte automatiquement le support device-side (Safari iOS
pour Apple Pay, Chrome avec compte Google pour Google Pay). En mode 'saved'
(branche `confirmCardPayment`), aucun changement : la confirmation est card-
only par construction (CB déjà attachée au Customer).

**Fichier 3** : `app/(consumer)/compte/paiements/_components/AddCardModal.tsx`
**INTACT volontairement** : le SetupIntent pour ajout CB durable conserve
`wallets: { applePay: 'never', googlePay: 'never' }`. Apple Pay et Google Pay
ne se persistent pas comme un PaymentMethod card classique (les wallets délèguent
à un device + fingerprint biométrique). Donc le flow "Ajouter une carte" doit
rester card-only.

**Fichier 4** : `app/(consumer)/compte/paiements/actions.ts` **INTACT** :
le SetupIntent action conserve `payment_method_types: ["card"]` pour la même
raison (cohérent avec le AddCardModal).

### LOT 3 — Tests vitest

**Fichier** : `tests/app/api/stripe/create-payment-intent/route.test.ts`.

Ajout d'un nouveau bloc `describe("C'. Audit Stripe M-1 ...")` après le bloc
T-404 idempotency :

```ts
it("M-1-A PI cree avec automatic_payment_methods.enabled=true et allow_redirects='never'", ...);
it("M-1-B payment_method_types n'est plus passe (laisse Stripe Dashboard piloter le set)", ...);
```

Les autres tests (T-406 statut guard, M-6 charges_enabled guard, T-404 idempotency,
T-405 race protection, etc.) restent inchangés et continuent de valider leurs
invariants respectifs.

### LOT 4 — Extension E2E Playwright

**Fichier** : `tests/e2e/stripe-smoke-phase3.spec.ts:230-256`.

Ajout après l'expect `client_secret` :
```ts
const piId = piBody.client_secret.split('_secret_')[0]!;
const pi = await stripe.paymentIntents.retrieve(piId);
expect(pi.automatic_payment_methods?.enabled).toBe(true);
expect(pi.automatic_payment_methods?.allow_redirects).toBe('never');
expect(pi.payment_method_types).toEqual(expect.arrayContaining(['card']));
```

Validation de bout en bout : le PI réellement créé côté Stripe (pas seulement
le mock vitest) a bien la config `automatic_payment_methods` attendue. Le set
de méthodes proposées (visible dans `pi.payment_method_types` côté retrieve)
inclura `card` au minimum, et selon Dashboard config également `apple_pay`,
`google_pay`, `link`.

---

## §6 actions manuelles Romain (Dashboard Stripe)

### Avant deploy code (test mode)

| # | Action | URL Dashboard | Vérification |
|---|---|---|---|
| 1 | Vérifier méthodes activées au niveau compte | https://dashboard.stripe.com/test/settings/payment_methods | Card ✓, Apple Pay ✓, Google Pay ✓, Link (selon préférence), **SEPA Debit ✗** explicitement désactivé. |
| 2 | Vérifier payment method configuration par défaut | https://dashboard.stripe.com/test/settings/payment_method_configurations | Configuration "default" comprend Card + Apple Pay + Google Pay. SEPA absent. |
| 3 | Vérifier domain registration | https://dashboard.stripe.com/test/settings/payment_method_domains | `www.terroir-local.fr` présent + verified, statuses Apple/Google Pay = active. **Déjà fait via script LOT 1**. |
| 4 | (Rappel M-3) Webhook events cochés | https://dashboard.stripe.com/test/webhooks | `radar.early_fraud_warning.created`, `charge.refunded`, `account.application.deauthorized` cochés (déjà documenté M-3). |

### Le jour du cutover live (avant bascule prod)

| # | Action | URL Dashboard live | Vérification |
|---|---|---|---|
| 1 | Apply script registration sur compte LIVE | n/a (CLI) | `STRIPE_SECRET_KEY=sk_live_... npx tsx scripts/register-payment-method-domain.ts --apply` → vérifier statuses=active. |
| 2 | Vérifier méthodes activées live | https://dashboard.stripe.com/settings/payment_methods | Idem test : Card + Apple Pay + Google Pay ✓, SEPA ✗. |
| 3 | (Rappel M-3) Webhook live | https://dashboard.stripe.com/webhooks | Endpoint live pointant sur `https://www.terroir-local.fr/api/stripe/webhook`, mêmes events cochés que test. |

---

## Test plan post-deploy (matrice manuelle)

| # | Méthode | Device | Test card | Vérification |
|---|---|---|---|---|
| 1 | Card no-3DS | n'importe (Chrome desktop suffit) | `4242 4242 4242 4242` | flow nominal succeeded, redirect `/compte/confirmation/{id}` |
| 2 | Card 3DS required | n'importe | `4000 0027 6000 3184` | modal 3DS Stripe in-page → succeeded |
| 3 | Card declined | n'importe | `4000 0000 0000 0002` | bandeau terra "Paiement refusé. Essayez une autre carte." |
| 4 | Card insufficient funds | n'importe | `4000 0000 0000 9995` | bandeau terra (decline_code spécifique) |
| 5 | **Apple Pay** | iPhone Safari réel (pas simulateur) | Carte sandbox Apple Pay | tab Apple Pay visible dans PaymentElement → modal Wallet → succeeded |
| 6 | **Google Pay** | Chrome desktop avec compte Google ou Android Chrome | Carte sandbox Google Pay | tab Google Pay visible dans PaymentElement → modal Wallet → succeeded |
| 7 | Save card cochée | n'importe | `4242 4242 4242 4242` + checkbox cochée | CB visible dans `/compte/paiements` après confirm |
| 8 | iOS Safari sans Apple Pay configuré | iPhone sans CB Apple Wallet | n/a | tab Apple Pay absente du PaymentElement (Stripe gère) |

> **Critère de succès go-live M-1 + L-3** : items 1-4 OK + au moins un de (5,6) OK.
> Items 5+6 sont nice-to-have mais matérialisent le ROI mobile attendu (+10-20%
> conversion sourced audit §170).

---

## Rollback procédure si régression

### Symptôme A : checkout `/compte/checkout` ne charge plus le PaymentElement

→ Possible incompatibilité SDK 22 / dahlia avec `automatic_payment_methods.allow_redirects`
(non observé en test mais defensive). **Action** :
```bash
git revert <SHA du commit M-1>
# Le revert restaure payment_method_types: ['card'] hardcodé.
# La domain registration côté Stripe reste en place mais inerte
# (les wallets ne seront pas proposés sans automatic_payment_methods).
```
Vercel rollback < 1 min.

### Symptôme B : taux d'erreur generic spike post-deploy

→ Méthode mal supportée côté UI. Greppable Vercel logs : `[CHECKOUT_GENERIC]`.
**Action** : revert idem ci-dessus, puis investiguer le code Stripe error spécifique
côté logs avant re-deploy.

### Symptôme C : Apple Pay accepté côté UI mais PI échoue côté serveur

→ Probablement domain registration tombée en `inactive` (peut arriver si Apple
révoque la verification Stripe-side). **Action** : re-run `npx tsx
scripts/register-payment-method-domain.ts --apply` pour re-trigger une
re-verification Stripe. Si `inactive` persiste après 5 min, contacter Stripe
support.

### Symptôme D : ordre de paiement reste pending sans webhook succeeded

→ **NE PEUT PAS être Apple/Google Pay** (settle instant comme Card). Si SEPA
était activé par erreur (allow_redirects:never devrait l'avoir filtré), revert
+ vérifier Dashboard `payment_methods` (étape Romain #1).

---

## Trade-offs assumés

1. **SEPA Direct Debit OFF**. Activer SEPA = chantier dédié V1.1 (handler
   `payment_intent.processing` + UI processing-state + cron `order-timeout`
   adapté + emails settlement-différés + tests). Estimé 8-12h. ROI moindre que
   Apple/Google Pay. → ticket V1.1 dédié recommandé.
2. **Bancontact / iDEAL OFF**. Marché TerrOir = France-FR. Bancontact (BE-only)
   et iDEAL (NL-only) n'apportent rien.
3. **Klarna OFF**. Commission Klarna ≈ 4-5% (vs 1.4% card) trop haute pour
   panier moyen 25€. Reconsidérer en V1.1 si paniers >50€ deviennent fréquents.
4. **Link désactivable Dashboard**. Le code ne hardcode plus `payment_method_types`
   donc le compte Stripe pilote 100% le set. Si Link n'est pas voulu, Romain le
   désactive Dashboard `settings/payment_methods`. Sinon Link sera proposé par
   le PaymentElement.
5. **AddCardModal SetupIntent reste card-only**. Apple Pay / Google Pay ne se
   persistent pas comme un PaymentMethod card. Le flow "Ajouter une carte"
   garde `wallets: never` volontairement.
6. **`allow_redirects: 'never'`** vs `'always'`. `'never'` filtre toutes les
   méthodes redirect-based pour préserver le flow single-page actuel et zero
   changement UX. Cohérent avec le comportement `confirmPayment({ redirect: 'if_required' })`
   côté UI : avec ce filtre serveur, "if_required" ne sera jamais déclenché.

**Aucun impact CHANGELOG.md immédiat** : pas de feature visible utilisateur
nouvelle (tant que Romain n'active pas explicitement Apple/Google Pay côté
Dashboard test puis live).
