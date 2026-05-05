# Fix — PCI headers Next.js + 3DS decline E2E (Session H, 2026-05-05)

> Pendant la phase B pré-launch Stripe, deux items du backlog ont été traités en anticipation :
> - **W-1 PCI** : durcissement headers de sécurité Next.js (`next.config.js`).
> - **3DS decline E2E** : couverture E2E du flow consumer quand un PaymentIntent est refusé.
>
> Aucun lot ne touche à du code Stripe applicatif (routes API, handlers webhook, libs). Les changements sont config (`next.config.js`) + spec test (`tests/e2e/stripe-decline.spec.ts`) + doc.

---

## Partie 1 — W-1 PCI headers Next.js

### Contexte

Audit `docs/audits/audit-stripe-pci-saq-a-2026-05-05.md` §W-1 : `next.config.js` n'exposait pas de `headers()`. Vercel posait HSTS automatiquement, mais X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, et CSP étaient absents. Pas un bloqueur SAQ-A (le PAN ne transite pas par TerrOir), mais un drapeau pentest light. Inscrit V1.1 ; remédié pré-launch.

### Changements appliqués

- `next.config.js` : ajout d'une fonction `async headers()` qui pose 5 headers sur `/:path*`.
- Aucune modification de `middleware.ts`, des routes API, ou des handlers webhook.

### Headers configurés

| Header                                    | Valeur                                                                                                                |
|-------------------------------------------|-----------------------------------------------------------------------------------------------------------------------|
| `X-Frame-Options`                         | `DENY`                                                                                                                |
| `X-Content-Type-Options`                  | `nosniff`                                                                                                             |
| `Referrer-Policy`                         | `strict-origin-when-cross-origin`                                                                                     |
| `Permissions-Policy`                      | `camera=(), microphone=(), geolocation=(self), payment=(self), interest-cohort=()`                                    |
| `Content-Security-Policy-Report-Only`     | Whitelist Stripe (js + hooks + m.stripe.network + api), Mapbox (api/tiles/events), Vercel Analytics, Supabase (URL projet via `NEXT_PUBLIC_SUPABASE_URL` parsé). frame-ancestors 'none'. `'unsafe-inline'` + `'unsafe-eval'` autorisés (Next.js bootstrap + Stripe.js — trade-off documenté). |

### Décision : Report-Only initial

CSP démarrée en **`Content-Security-Policy-Report-Only`** plutôt que enforce. Pourquoi :

- Une CSP enforce avec un trou (oubli d'un sous-domaine, mauvais directive) casse silencieusement la prod.
- Mode Report-Only : le browser logue les violations en console DevTools sans bloquer la ressource.
- Permet d'observer 7 jours sur le trafic réel avant de figer la policy.

**Date cible migration Report-Only → enforce : 2026-05-12.** Procédure dans `docs/conventions/security-headers.md`.

### Validation

- ✅ `npx tsc --noEmit` : 0 erreur.
- ✅ `npx next lint` : 0 erreur (1 warning préexistant sur `user-provider.tsx:118` non lié).
- ✅ `node -e "require('./next.config.js').headers().then(h => ...)"` : structure correcte.
- ✅ `npx vitest run` : 1732/1732 passants (même volume que l'état initial — `next.config.js` n'a pas de tests vitest).

### Risques / suivi

- **CSP en Report-Only** ne casse pas la prod, par design. Le risque est l'inverse : oublier la migration vers enforce. → Tickerable Romain : le 2026-05-12, ouvrir DevTools sur les pages clés (homepage, /carte, /compte/checkout) pour vérifier l'absence de violations critiques, puis swap la clé du header dans `next.config.js`.
- **`'unsafe-inline'` + `'unsafe-eval'`** dans `script-src` : concession nécessaire pour Next.js (hydratation, RSC payload) + Stripe.js. Migration vers nonce-based CSP = chantier V1.2+ (Next 14 middleware nonces).
- **Iframe Stripe Elements** : `X-Frame-Options: DENY` ne pose pas de problème car les iframes Stripe sont sourced depuis `js.stripe.com` — TerrOir n'est pas embed dans l'iframe Stripe, c'est l'inverse. Theoretical OK mais à smoke tester post-deploy via une vraie session checkout.
- **Mapbox tiles `/carte`** : risque de violation CSP en Report-Only si une URL de tile est servie depuis un sous-domaine non whitelisté. Couvert par `https://*.tiles.mapbox.com` mais à monitorer.

---

## Partie 2 — 3DS decline E2E

### Contexte

`tests/e2e/stripe-3ds-matrix.spec.ts` couvre les cas success (frictionless, optional, required success) mais le cas **decline** (carte refusée — sans challenge 3DS) restait uniquement en couverture unitaire (`tests/lib/stripe/handle-payment-failed.test.ts`). Audit phase B notait :

> Le user qui voit son paiement refusé doit voir une UX claire avec retry possible. Pas de test E2E qui valide la chaîne user-side (UI error display).

### Approche retenue

`tests/e2e/stripe-decline.spec.ts` — 2 tests :

#### Test 1 : `Decline API + webhook`

Validation API-level + handler chain :
- Setup order + PI via `/api/orders/create` + `/api/stripe/create-payment-intent`.
- Confirm PI server-side avec carte `4000 0000 0000 0002` → Stripe SDK throw `StripeCardError` code=`card_declined` decline_code=`generic_decline`.
- Vérifie `pi.status === 'requires_payment_method'` post-decline (Stripe ne cancel pas le PI, il le repasse en attente d'une autre méthode).
- Push un webhook synthétique signé `payment_intent.payment_failed` sur `/api/stripe/webhook`.
- Assert : order DB transite `pending → cancelled` + `closure_reason='payment_failed'` + `cancelled_at` posé (cf. `lib/stripe/handle-payment-failed.ts`).

#### Test 2 : `Decline UI`

Validation user-side iframe drive :
- Setup producer + product + slot + consumer + login.
- Hydrate panier zustand côté `localStorage` (clé `terroir-cart`).
- Navigation `/compte/checkout`. Le `useEffect` mount appelle `cart/validate` → `orders/create` → `stripe/create-payment-intent` → `setClientSecret`. PaymentElement monte ensuite via `<Elements>`.
- Drive iframe Stripe Elements (frame-locator par title FR `Champ de saisie sécurisé pour le paiement`) : fill `number`, `expiry`, `cvc`.
- Click `Payer 12,50 €`.
- Assert : message d'erreur affiché côté UI matche `/refus[ée]/i` (locale FR Stripe natif ou fallback `classifyStripeError` "Paiement refusé. Essayez une autre carte.").
- Assert : order DB reste `pending` (pas de webhook réel délivré en local — attendu).
- Cleanup : cancel le PI Stripe + purge DB rows.

### Trade-off : drive iframe instable

Le drive iframe Stripe Elements en headless est documenté instable (cf. `tests/e2e/stripe-3ds-matrix.spec.ts` ligne 19-26 : sélecteurs DOM Stripe non documentés, anti-bot CAPTCHA, race-conditions iframe). Si headless échoue côté CI ou local sans cookies persistés, fallback documenté :

```bash
npm run test:e2e:headed -- --grep "Decline UI"
```

Le Test 1 (API + webhook) reste 100% stable headless car il bypass complètement l'UI Stripe.

### Cas non couvert (volontairement)

- **Retry après decline avec carte success** : non testé E2E. Couvert indirectement par `stripe-3ds-matrix.spec.ts` (success cards) + `classifyStripeError.test.ts` (kind=`card_declined` → retry direct OK).
- **Decline post-challenge 3DS** (carte 4000 0082 6000 3178) : déjà documenté skip dans `stripe-3ds-matrix.spec.ts` (drive iframe `hooks.stripe.com` hors scope E2E stable). Couvert unitairement par `handle-payment-failed.test.ts`.

### Validation

- ✅ `npx tsc --noEmit` : 0 erreur.
- ✅ `npx next lint` : 0 erreur.
- ⏳ Run E2E : non exécuté dans cette session (Romain commit + deploy puis run sur dev local — pattern projet).

---

## Évolution couverture

| Mesure                           | Avant Session H | Après Session H | Note                                                  |
|----------------------------------|-----------------|-----------------|-------------------------------------------------------|
| Vitest                           | 1732            | 1732            | Pas de nouveau test vitest (config files non testables) |
| E2E specs Stripe                 | 3               | 4               | + `stripe-decline.spec.ts` (2 tests)                  |
| Headers de sécurité TerrOir      | 0 (HSTS Vercel) | 5 (X-Frame, X-Content, Referrer, Permissions, CSP-RO) | + 1 (HSTS Vercel) = 6 au total |
| Audit PCI SAQ-A verdict          | 11 OK / 1 WARN  | 12 OK / 0 WARN  | W-1 résolu                                             |

---

## Liens

- Audit PCI SAQ-A : `docs/audits/audit-stripe-pci-saq-a-2026-05-05.md` §W-1.
- Audit Stripe phase A : `docs/audits/audit-stripe-2026-05-05.md`.
- Convention headers : `docs/conventions/security-headers.md`.
- Spec E2E : `tests/e2e/stripe-decline.spec.ts`.
- Runbook go-live : `docs/runbooks/go-live-stripe.md`.

---

## Migration Report-Only → enforce — checklist Romain (2026-05-12)

1. Ouvrir https://www.terroir-local.fr en Chrome DevTools, onglet Console. Visiter homepage → /carte → /compte/panier (avec un produit) → /compte/checkout. Chercher des messages `Content-Security-Policy:` violation.
2. Idem en Firefox + Safari (mobile si possible).
3. Vercel logs : grep `[STRIPE_*]`, `[WEBHOOK_*]` sur la fenêtre observée pour vérifier qu'aucune feature critique n'est silencieusement cassée.
4. Si tout OK : dans `next.config.js`, swap la clé `Content-Security-Policy-Report-Only` → `Content-Security-Policy` (dernière entrée de `SECURITY_HEADERS`). Garder la même valeur. Commit + deploy.
5. Re-monitorer 24-48h en mode enforce. Rollback si feature edge-case casse.
