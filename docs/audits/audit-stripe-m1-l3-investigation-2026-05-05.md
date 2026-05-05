# Investigation M-1 + L-3 — Dynamic payment methods + Apple Pay / Google Pay

**Date** : 2026-05-05
**Périmètre** : pré-implémentation des findings M-1 (`payment_method_types: ['card']` hardcodé) et L-3 (Apple Pay / Google Pay non configurés) de [`audit-stripe-2026-05-05.md`](./audit-stripe-2026-05-05.md).
**Mode** : READ-ONLY. Aucune modification de code, aucun commit.
**Source live** : MCP Stripe `read-only` sur compte test `acct_1TNw9nGuakpserKp`. MCP n'expose pas `payment_method_configurations` ni `payment_method_domains` → vérification config Dashboard reportée à Romain (manuel).

> **TL;DR** : feu vert pour Apple Pay + Google Pay (≈3-5h, ROI fort), feu rouge pour SEPA dans cette phase (changement majeur du modèle de confirmation order, à isoler en V1.1). Domain verification Apple Pay = 1 appel API Stripe + 1 ajustement middleware si on garde le fallback fichier. Tests vitest impactés : aucun (les tests `create-payment-intent/route.test.ts` ne contraignent pas `payment_method_types`). Tests E2E Playwright : 1 spec à étendre.

---

## 1. Flow checkout actuel

### Composant et librairies

- **Page** : `app/(consumer)/compte/checkout/page.tsx` (sur `www.terroir-local.fr`).
- **Modal "Ajouter une carte"** (Phase 4) : `app/(consumer)/compte/paiements/_components/AddCardModal.tsx`.
- **SDK frontend** : `@stripe/react-stripe-js` 2.9.0 + `@stripe/stripe-js` 4.10.0 (post-bump 9.x = Phase 3 lot 2 dahlia déjà mergée).
- **Composant Stripe utilisé** : `<Elements>` + `<PaymentElement layout="tabs">`. Pas de `<CardElement>` legacy.

### Pattern 3DS

Deux branches dans `CheckoutForm.onSubmit` (`page.tsx:469`):
- **CB enregistrée** (mode='saved') : `stripe.confirmCardPayment(clientSecret, { payment_method: selectedPmId })`. Stripe affiche la modal 3DS in-page si requise.
- **Nouvelle CB** (mode='new') : `stripe.confirmPayment({ elements, confirmParams: { return_url }, redirect: 'if_required' })`. `if_required` évite la redirection sortante si la CB ne nécessite pas de redirect (cas card 3DS classique). Si la méthode exige un redirect (futur SEPA, iDEAL, Bancontact), Stripe redirige.
- Test `paymentIntent?.status === 'succeeded'` post-confirm. Tout autre statut (notamment `processing`) → `setProcessing(false)` sans navigation.

### Path success / error UI

- **Succès** : `clear()` du panier puis `router.push('/compte/confirmation/${orderId}')`.
- **Échec** : `classifyStripeError()` → 6 ErrorKind dont `init_409` (order morte → redirect commandes), `3ds_abandoned`, `card_declined`, `pi_invalid`, `network`, `generic`. Bandeau terra inline sous le PaymentElement.
- **Wallets désactivés explicitement** dans 2 endroits (à mettre à jour pour M-1) :
  - `page.tsx:629` → `<PaymentElement options={{ wallets: { applePay: 'never', googlePay: 'never' } }} />`
  - `_components/AddCardModal.tsx:186` → idem.

### Setup intent (CB sans paiement)

- `paiements/actions.ts:64` → `stripe.setupIntents.create({ payment_method_types: ["card"], usage: "off_session" })`. Hardcodé "card" aussi mais hors périmètre M-1 (un SetupIntent dédié à la sauvegarde CB ne doit pas exposer Apple/Google Pay puisque ces wallets ne « se sauvegardent » pas en CB classique côté UX TerrOir).

---

## 2. Implications SEPA (decision : SKIP cette phase)

### Settlement timing

SEPA Direct Debit est un **paiement asynchrone** :
- `confirmPayment` côté client → PI passe en `processing` (pas `succeeded`).
- Stripe émet `payment_intent.processing` immédiatement.
- 4 à 5 jours ouvrés plus tard, settlement bancaire SEPA :
  - succès → `payment_intent.succeeded`
  - échec → `payment_intent.payment_failed` (le client a fait un mandat invalide, fonds insuffisants, etc.)

### Comportement webhook actuel TerrOir vs SEPA

`app/api/stripe/webhook/route.tsx` n'écoute PAS `payment_intent.processing`. Conséquences si SEPA était activé tel quel :
- **Côté UI checkout** : `confirmPayment` retourne `paymentIntent.status === 'processing'` → branche else `setProcessing(false)`, le user reste sur la page de paiement sans confirmation, sans message clair. **Casse UX**.
- **Côté DB** : aucun UPDATE `orders.statut`. L'order reste `pending`. Si le settlement réussit 5 jours plus tard, `payment_intent.succeeded` arrive et le flow nominal `pending → confirmed` se déclenche tardivement. Mais entre temps :
  - Le cron `order-timeout` (`vercel.json:13`, daily 9h UTC) cancelle toute order pending depuis +24h → **refund déclenché sur un PI `processing` (non encore settled) → erreur Stripe `charge_already_refunded` ou refund différé qui annule le débit avant qu'il ait eu lieu**.
  - L'order pending pollue les compteurs admin / dashboards.

### Risque order confirmation prématurée

Le code actuel passe `pending → pending_to_notify` au reçu de `payment_intent.succeeded` (cf. `lib/stripe/handle-payment-succeeded.ts:118-138`). Pour SEPA le `succeeded` arrive **après** settlement — donc pas de risque de prep producer prématurée si on garde le modèle actuel.

**Mais** : il faudrait ajouter un état `processing_sepa` côté UI pour indiquer au user que sa commande est en attente de validation bancaire (5j). Sinon il croit que ça a échoué et re-tente, ou contact le support.

### Verdict SEPA

- **Activer SEPA aujourd'hui** = chantier ≈ 8-12h : nouveau handler `payment_intent.processing` + UI "paiement en cours, validation sous 5 jours" + state machine order `pending` éventuellement enrichie + adaptation cron `order-timeout` (skip orders avec PI processing) + emails de confirmation différés + tests.
- **Ne PAS activer SEPA dans la phase M-1** = limiter l'apply à `card + apple_pay + google_pay` (+ Bancontact instant si Romain le souhaite, BE-only). Garder SEPA pour V1.1 dédiée. Cohérent avec le scope go-live serré.

> **Recommandation forte** : exclure SEPA de M-1. Le passage à `automatic_payment_methods: { enabled: true, allow_redirects: 'never' }` filtre déjà les méthodes redirect-based — mais SEPA débit instant n'est pas redirect-based, donc il faut explicitement l'exclure côté Dashboard ou via `payment_method_types` whitelist (anti-pattern à éviter).
>
> **Solution propre** : configurer le set des méthodes activées côté **payment method configuration Dashboard Stripe**, et désactiver SEPA explicitement. C'est le seul moyen 2026 (skill payments.md `:42-44`). À faire par Romain manuellement avant déploiement code.

---

## 3. Implications Apple Pay (L-3)

### Domain verification — méthode 2026

Bonne nouvelle découverte par MCP `search_stripe_documentation` :

> **As of April 2025, merchants do not need to store a verification file for Apple Pay on the web anymore. As long as they have registered their domain via the PaymentMethodDomains API, Apple Pay will work the same way as other wallets such as Google Pay or Link.**
> (source : Stripe DevHelp KB)

Donc 2 méthodes possibles :
1. **API `payment_method_domains`** (recommandé 2026, sans fichier) :
   ```
   POST /v1/payment_method_domains
   { domain_name: "www.terroir-local.fr" }
   ```
   Stripe gère la vérification Apple en interne. Pas de fichier à servir. Plus simple, plus robuste (pas de risque de cache/CDN bouffant le fichier).
2. **Fichier `.well-known/apple-developer-merchantid-domain-association`** (méthode classique, encore documentée Salesforce/etc.) : registration via Dashboard → download domain association file → servir sur HTTPS.

### Sous-domaines TerrOir concernés

Inventaire (`middleware.ts:10-16` + `.env.example`) :
- `www.terroir-local.fr` — apex consumer, **CHECKOUT EST ICI** → seul sous-domaine à enregistrer.
- `pro.terroir-local.fr` — interface producer, pas de checkout consumer → pas besoin.
- `admin.terroir-local.fr` — interface admin, pas de checkout consumer → pas besoin.

→ **1 seul domaine à enregistrer** : `www.terroir-local.fr`.

### Risque middleware (CRITICAL si fichier .well-known retenu)

Le `middleware.ts` (`config.matcher`) exclut uniquement les fichiers statiques (`_next/static`, `_next/image`, `favicon.ico`, images, fonts) :
```ts
matcher: [
  "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf)$).*)",
],
```
**`.well-known/...` n'est PAS exclu**. Si on choisit la méthode fichier :
- Le middleware s'applique sur la requête Apple/Stripe vers `/.well-known/apple-developer-merchantid-domain-association`.
- Le path n'est pas dans `PUBLIC_PATHS` ni dans `isPublicPath()` (préfixes `/auth/`, `/invitation/`, `/api/public/`).
- Sans session, le user n'est pas authentifié → middleware redirige vers `/connexion`.
- **La vérification Apple échoue silencieusement.**

→ Si méthode fichier retenue : ajouter `/.well-known/` à `isPublicPath()` ou au matcher exclusion.
→ Si méthode API retenue : aucun changement middleware (plus simple).

### Effort Apple Pay

- **Méthode API** : ≈ 30 min (1 script ou 1 appel curl + `payment_method_domains.activated` à vérifier + smoke iPhone Safari).
- **Méthode fichier** : ≈ 1h (download fichier + `public/.well-known/...` + ajustement middleware + redeploy + verify).

→ **Recommandation : méthode API**. Pas de fichier physique versionné, pas d'ajustement middleware, et c'est le path Stripe pousse en 2026.

---

## 4. Implications Google Pay

- **Pas de domain verification requise** côté Google. Stripe gère via le `payment_method_domains` (utilise même endpoint donc one-shot avec Apple Pay).
- **HTTPS requis** : OK sur `www.terroir-local.fr` (Vercel HTTPS auto).
- **Marche immédiatement** dès lors que `automatic_payment_methods: { enabled: true }` est passé au PI create.

### Effort Google Pay

≈ 5 min en plus de la registration Apple (le même endpoint registre les 2). Aucun fichier, aucun setting.

---

## 5. Configuration Dashboard Stripe

### Ce que le MCP voit

- `acct_1TNw9nGuakpserKp` (test mode) — confirmé.
- `payment_method_configurations` non exposé via MCP (`stripe_api_search` ne retourne que `payment_links`/`payment_intents`).
- `payment_method_domains` non exposé via MCP.

### Ce que Romain doit vérifier manuellement (Dashboard test ET live)

| Vérification | URL Dashboard | Attendu |
|---|---|---|
| Méthodes activées au niveau compte | `https://dashboard.stripe.com/settings/payment_methods` | Card ✓, Apple Pay ✓, Google Pay ✓, **SEPA Debit ✗** (à désactiver explicitement). |
| Payment method configurations | `https://dashboard.stripe.com/settings/payment_method_configurations` | 1 config par défaut. Ajuster set selon décision SEPA. |
| Domain registration | `https://dashboard.stripe.com/settings/payment_method_domains` | `www.terroir-local.fr` enregistré + verified après l'apply. |
| Webhook endpoints (rappel audit M-3) | `https://dashboard.stripe.com/webhooks` | 3 events à cocher (`radar.early_fraud_warning.created`, `charge.refunded`, `account.application.deauthorized`). Ne pas oublier `payment_intent.processing` SI SEPA est un jour activé. |

→ **Action manuelle Romain pré-deploy** : 4 vérifications ci-dessus, dans test mode d'abord pour valider, puis live au moment du cutover.

---

## 6. Tests existants impactés

### Tests vitest

Recherche `payment_method_types|automatic_payment_methods|confirmCardPayment|wallets:` dans `tests/` :
- **0 hit**. Le test `tests/app/api/stripe/create-payment-intent/route.test.ts` valide l'idempotency-key et le path race protection mais ne contraint pas le contenu de `payment_method_types`. Donc pas de test à modifier pour M-1.

→ **Aucun test vitest existant à adapter**. Pour la rigueur, ajouter 1-2 tests :
- `paymentIntents.create` est appelé avec `automatic_payment_methods: { enabled: true, allow_redirects: 'never' }` (ou la valeur retenue) au lieu de `payment_method_types: ['card']`.
- Le SetupIntent (paiements/actions.ts) reste `payment_method_types: ['card']` (ne pas régresser sur ce path).

### Tests E2E Playwright

`tests/e2e/stripe-smoke-phase3.spec.ts:230` exerce `POST /api/stripe/create-payment-intent` mais ne valide pas la liste des méthodes proposées par le PaymentElement (smoke focalisé sur SDK 22 + connect onboard). Si on ajoute `automatic_payment_methods`, le test passe sans modification.

→ **Étendre 1 spec** (optionnel mais recommandé) : assert que le PI créé a `automatic_payment_methods.enabled = true` côté Stripe response.

### Tests inexistants à créer

- E2E Apple Pay : impossible à automatiser proprement (pas de mock Apple Wallet en CI). Test manuel Romain sur iPhone Safari.
- E2E Google Pay : idem (mock Chrome Wallet difficile). Test manuel Chrome Android ou Chrome desktop avec carte test enregistrée.

→ **Plan de test post-deploy** = matrice manuelle :
| Méthode | Device | Test card | Vérification |
|---|---|---|---|
| Card 3DS | n'importe | `4000 0027 6000 3184` (3DS required) | flow nominal succeeded |
| Card no-3DS | n'importe | `4242 4242 4242 4242` | flow nominal succeeded |
| Card declined | n'importe | `4000 0000 0000 0002` | classify-stripe-error `card_declined` |
| Apple Pay | iPhone Safari | carte sandbox Apple Pay | flow nominal succeeded |
| Google Pay | Chrome desktop ou Android | carte sandbox Google Pay | flow nominal succeeded |
| Save card | n'importe | `4242 4242 4242 4242` + checkbox cochée | CB visible dans `/compte/paiements` après confirm |

---

## 7. Recommandation finale

### Périmètre proposé pour M-1 + L-3

**IN** :
- `automatic_payment_methods: { enabled: true, allow_redirects: 'never' }` au PI create.
- Retirer `wallets: { applePay: 'never', googlePay: 'never' }` du `<PaymentElement>` checkout (pas du AddCardModal SetupIntent).
- Registration domaine `www.terroir-local.fr` via API `payment_method_domains` (1 appel).
- Ajustement Dashboard Stripe par Romain : activer Apple Pay + Google Pay au niveau compte, désactiver SEPA (et autres méthodes redirect indésirables).

**OUT** :
- SEPA Direct Debit (chantier dédié V1.1).
- Bancontact, iDEAL, etc. (redirect, pas le mode UX TerrOir).
- Apple Pay côté `pro.*` et `admin.*` (pas de checkout consumer là-bas).

### Ordre d'apply (commits/PR)

1. **PR1 — Domain registration Apple Pay/Google Pay** :
   - 1 script idempotent `scripts/register-payment-method-domain.ts` qui appelle `stripe.paymentMethodDomains.create({ domain_name: 'www.terroir-local.fr' })` puis log le statut. Idempotent : si already-registered, retrieve + log.
   - Script lancé manuellement (test puis live) — pas de cron.
   - **0 changement code applicatif**, 0 risque régression.
2. **PR2 — Code change** :
   - `app/api/stripe/create-payment-intent/route.ts:155` : remplace `payment_method_types: ["card"]` par `automatic_payment_methods: { enabled: true, allow_redirects: 'never' }`.
   - `app/(consumer)/compte/checkout/page.tsx:629` : retire `wallets: { applePay: 'never', googlePay: 'never' }` (ou met `'auto'`).
   - `app/(consumer)/compte/paiements/_components/AddCardModal.tsx:186` : **garder** wallets never (SetupIntent CB seulement).
   - 1-2 tests vitest pour le PI create.
3. **PR3 (optionnel)** — étendre `stripe-smoke-phase3.spec.ts` pour assert `automatic_payment_methods.enabled` sur le PI.

### Stratégie de rollback

- **Rollback rapide** = revert PR2 (1 commit). PR1 (domain registration) reste, c'est inerte côté flow user si PR2 est revert (les wallets ne seront pas proposés sans `automatic_payment_methods` côté PI).
- **Feature flag** non nécessaire : le revert git est immédiat (Vercel rollback en 30s sur build cache hit).
- **Monitoring post-deploy** : surveiller le log `[CHECKOUT_CARD_DECLINED]` et `[CHECKOUT_GENERIC]` pendant 24-48h. Spike anormal de generic = méthode mal supportée → revert.

### Trade-off SEPA — verdict

**SKIP**. Activer SEPA dans la phase M-1 = chantier ≈ 8-12h supplémentaires (handler `payment_intent.processing`, UI processing-state, cron order-timeout adapté, tests). Plus risqué, ROI moindre que Apple Pay (qui apporte instantanément +10-20% conversion mobile).

→ Ouvrir un ticket V1.1 dédié `T-XXX SEPA Direct Debit` avec brief technique pré-réfléchi : 4 changements clés (handler + UI + cron + email).

### Test plan post-deploy

- [ ] Test card no-3DS sur iPhone Safari → succeeded
- [ ] Test card 3DS sur Chrome desktop → modal 3DS succeeded
- [ ] Apple Pay sur iPhone Safari réel (pas simulateur) → succeeded
- [ ] Google Pay sur Chrome desktop avec compte Google + carte sandbox → succeeded
- [ ] Save card cochée → CB visible dans `/compte/paiements`
- [ ] Card declined `4000 0000 0000 0002` → bandeau "Paiement refusé"
- [ ] Mobile Safari iOS sans Apple Pay configuré → tab Apple Pay absente du PaymentElement (Stripe gère)
- [ ] Vérif Dashboard Stripe `webhook events recent` : aucun event `payment_intent.processing` non-handlé (= SEPA bien désactivé)

---

## 8. Estimation effort total M-1 + L-3 (ROI)

| Bloc | Effort |
|---|---|
| Investigation (ce doc) | 1h ✓ |
| PR1 script registration domain + smoke test | 30 min |
| PR2 code change PI + UI wallets + tests vitest | 1h30 |
| PR3 extension E2E (optionnel) | 30 min |
| Action manuelle Romain Dashboard Stripe (test + live) | 30 min |
| Test plan post-deploy manuel | 1h |
| **Total** | **≈ 4-5h dev + 30 min Romain** |

**ROI estimé** (sourced audit M-1 §170) : conversion mobile +10-20%, soit sur un funnel de 500 visites mobile/jour avec 30% propension Apple Pay = **+15-30 commandes/mois** en plus à panier moyen 25€ = **+375 à 750€ CA/mois** dès le 1er mois post-go-live.

→ **ROI : 4-5h de dev contre +375-750€/mois récurrent**. Top finding du backlog phase 2.

---

## 9. Questions / ambiguïtés

1. **SEPA exclusion confirmée par Romain ?** Le verdict ci-dessus est tranché techniquement, mais Romain peut vouloir le forcer pour V1 (paniers >50€ marketplace food, 0% fee consumer). Si oui → reprioriser un chantier dédié, **pas dans la même PR**.
2. **`allow_redirects: 'never'` vs `'always'` ?** `'never'` filtre Bancontact/iDEAL/SEPA-redirect, garde card+ApplePay+GooglePay+Klarna (sans redirect). `'always'` ouvre tout. Recommandation : **`'never'`** pour cohérence avec le flow single-page actuel et zero changement UX. À reconfirmer.
3. **Bancontact (BE-only) souhaité ?** Marché TerrOir = France-FR. Bancontact n'apporte rien. Skip.
4. **Klarna BNPL ?** Disponible mais pas dans la demande actuelle. Décision à reporter — Klarna change le risk profile (post-paid → recovery côté Klarna, pas côté TerrOir, mais commission Klarna ≈ 4-5% > 1.4% card). À benchmarker en V1.1.

---

## Annexe — Liens utiles pour la PR d'apply

- Stripe API : `POST /v1/payment_method_domains` — https://docs.stripe.com/api/payment_method_domains/create
- Doc dynamic payment methods + automatic_payment_methods — https://docs.stripe.com/payments/payment-methods/integration-options
- Doc Apple Pay 2026 (sans fichier) — https://docs.stripe.com/payments/payment-methods/pmd-registration?dashboard-or-api=api
- Stripe test cards — `4242 4242 4242 4242` (no-3DS), `4000 0027 6000 3184` (3DS), `4000 0000 0000 0002` (decline). Doc : https://docs.stripe.com/testing
- Best-practice payments.md `:42-44` (skill stripe-best-practices) — "Advise users to enable dynamic payment methods in the Stripe Dashboard rather than passing specific payment_method_types."

**Aucune action n'a été appliquée. Liste pour arbitrage.**
