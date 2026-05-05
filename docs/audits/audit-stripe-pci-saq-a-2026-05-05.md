# Audit PCI DSS SAQ-A — TerrOir 2026-05-05

> **Périmètre** : Self-Assessment Questionnaire A (SAQ-A) — applicable aux marchands qui externalisent **intégralement** la collecte/traitement/stockage des données de carte à un tiers PCI-validé. C'est le scope le plus light de PCI DSS, accessible aux intégrations e-commerce qui utilisent **Stripe Checkout**, **Stripe Elements iframe-only**, ou redirect-style.
> **Méthode** : audit READ-ONLY sur la base de code TerrOir + grep ciblés. Aucune modification appliquée.
> **Lié à** : audit Stripe phase A `audit-stripe-2026-05-05.md`, plan phase B pré-launch.
> **Décision finale** : ✅ **TerrOir est éligible SAQ-A** sous réserve des 2 WARN documentés ci-dessous (headers de sécurité, rate-limiting endpoints Stripe).

---

## Synthèse

| Catégorie                                                           | Statut | Commentaire                                                            |
|---------------------------------------------------------------------|:------:|------------------------------------------------------------------------|
| 1. Aucune CB ne transite par les serveurs TerrOir                   |   OK   | Stripe Elements iframe-only (PaymentElement)                           |
| 2. HTTPS partout en production                                      |   OK   | Vercel auto-issue Let's Encrypt + force HTTPS sur les domaines custom  |
| 3. Headers de sécurité applicatifs (CSP, X-Frame, etc.)             | WARN   | next.config.js n'expose pas de `headers()` — uniquement HSTS via Vercel|
| 4. Aucun stockage local de données carte (localStorage/Storage)     |   OK   | Zustand stocke uniquement le panier (productId, qty), pas de PAN       |
| 5. Aucun log applicatif de données carte                            |   OK   | Grep `card_number/cvv/cvc` = 0 hit applicatif                          |
| 6. Stripe webhook signature vérifiée                                |   OK   | `stripe.webhooks.constructEvent` (cf. Phase 1)                         |
| 7. Stripe webhook IP allowlist (defense-in-depth)                   |   OK   | LOT 1 phase B — `lib/stripe/ip-allowlist.ts` (this audit)              |
| 8. Cookies session sécurisés (HttpOnly, Secure, SameSite)           |   OK   | Géré par `@supabase/ssr` — défauts production-safe                     |
| 9. `STRIPE_SECRET_KEY` jamais exposé côté client                    |   OK   | Uniquement `lib/stripe/server.ts` + scripts + tests E2E                |
| 10. Idempotency-key sur opérations Stripe write                     |   OK   | Audit phase A §L-6, doc `docs/conventions/stripe-idempotency.md`       |
| 11. Rate-limiting endpoints Stripe critiques                        | WARN   | Uniquement signup/login/recovery — `/api/stripe/*` non rate-limité     |
| 12. Anti-CSRF                                                       |   OK   | Cookies Supabase `SameSite=Lax` par défaut + `@supabase/ssr` SSR-side  |

**Verdict counts** : 10 OK / 2 WARN / 0 FAIL → SAQ-A éligible. Les 2 WARN sont des durcissements defense-in-depth, pas des bloqueurs PCI SAQ-A.

---

## OK — détail des contrôles validés

### 1. Aucune donnée de carte ne transite par TerrOir

**Preuve** : tous les composants checkout TerrOir utilisent `<Elements>` + `<PaymentElement>` de `@stripe/react-stripe-js`. Le PAN, l'expiration et le CVC sont saisis dans une iframe servie depuis `https://js.stripe.com` — TerrOir ne voit jamais ces champs.

| Fichier                                                              | Composant Stripe                | Rôle                                |
|----------------------------------------------------------------------|---------------------------------|-------------------------------------|
| `app/(consumer)/compte/checkout/page.tsx:6`                          | `<Elements>` + `<PaymentElement>` | Saisie carte au paiement            |
| `app/(consumer)/compte/paiements/_components/AddCardModal.tsx:5,93`  | `<Elements>` + `<PaymentElement>` | Save-card hors checkout (SetupIntent)|

**Implication SAQ-A** : c'est précisément le scénario que le SAQ-A couvre. TerrOir n'a aucune obligation PCI sur le stockage ou la transmission du PAN.

### 2. HTTPS en production

Les 3 domaines de production (`www.terroir-local.fr`, `pro.terroir-local.fr`, `admin.terroir-local.fr`) sont servis par Vercel qui :
- Émet et renouvelle les certificats Let's Encrypt automatiquement.
- Force la redirection HTTP→HTTPS au niveau edge.
- Pose le header `Strict-Transport-Security: max-age=63072000; includeSubDomains` sur tous les domaines custom (Vercel doc).

**Implication SAQ-A** : OK, exigence "Encryption of cardholder data when transmitted over open public networks" satisfaite par défaut.

### 3. (voir WARN ci-dessous)

### 4. Aucun stockage local de données carte

**Grep** `localStorage|sessionStorage` :
- `lib/store/cart.ts` (Zustand persist) : uniquement `{ productId, quantite, producerId }` → pas de PAN.
- `app/(public)/producteurs/[slug]/_components/DistanceWidget.tsx` : sessionStorage des distances géoloc.
- Tests E2E : `localStorage.removeItem('cart-store')` (cleanup).

Aucune trace de carte/PAN/CVC dans le storage navigateur.

### 5. Aucun log applicatif de données carte

**Grep** `card_number|cardNumber|card_no|cvv|cvc` (case insensitive) :
- `lib/checkout/classify-stripe-error.ts:71-72` : matching de **codes d'erreur Stripe** (`incorrect_cvc`, `card_declined`, `expired_card`, `processing_error`). Aucune valeur de carte n'est manipulée — uniquement des codes d'erreur publics.
- `docs/fixes/post-apply-checks-rls-2026-05-05.md` : doc, hors code.

Les logs côté serveur n'incluent que :
- `payment_intent.id` (`pi_*`) — public, OK.
- `customer.id` (`cus_*`) — public, OK.
- Codes d'erreur Stripe (`payment_intent_authentication_failure`, etc.) — publics, OK.

**Implication SAQ-A** : OK, requirement 3.4 ("Render PAN unreadable") n'est pas applicable parce qu'aucun PAN n'est jamais en mémoire/log côté TerrOir.

### 6. Webhook signature vérifiée

`app/api/stripe/webhook/route.tsx:54` → `stripe.webhooks.constructEvent(rawBody, signature, secret)`. `STRIPE_WEBHOOK_SECRET` injecté via env. Reçu et confirmé dans audit phase A (Annexe C cross-ref). Tests vitest couvrent les cas signature manquante / invalide.

### 7. Webhook IP allowlist (defense-in-depth)

LOT 1 du présent audit phase B — `lib/stripe/ip-allowlist.ts` + check à l'entrée du handler. 15 IPs Stripe officielles whitelisées en production, bypass implicite en preview/dev. 17 tests vitest. Doc convention `docs/conventions/stripe-webhook.md`.

### 8. Cookies session sécurisés

**Géré par `@supabase/ssr` côté `lib/supabase/server.ts` + `middleware.ts`**. Les défauts du package en production posent :
- `HttpOnly: true` (côté serveur — cookie inaccessible via JS).
- `Secure: true` (HTTPS-only en prod, conditionné par le scheme detection).
- `SameSite: Lax` (défaut Supabase SSR — bloque les requêtes cross-site non-navigation).

`lib/supabase/cookie-domain.ts` configure le `domain=.terroir-local.fr` pour partager la session entre `www.*` et `pro.*` (cookie distinct sur `admin.*` pour isolation Chantier 4). Pas de `domain` en local pour ne pas casser le dev.

Confirmé Phase 1 LOT F — pas de re-validation nécessaire.

### 9. `STRIPE_SECRET_KEY` côté serveur uniquement

**Grep** `STRIPE_SECRET_KEY` :
- `lib/stripe/server.ts:3` (créateur du SDK serveur).
- `scripts/*.ts` (admin scripts, exécutés hors-app).
- `tests/e2e/stripe-*.spec.ts` (tests E2E avec clé `sk_test_*`).
- `.env.example`, `docs/`, `README` (placeholder).

Aucune référence dans `app/(consumer)/`, `app/(producer)/`, `components/`, ou tout autre code shipped au navigateur. Le préfixe non-`NEXT_PUBLIC_` garantit que Next.js ne pickle pas la valeur dans le bundle client.

`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_*`) est correctement marqué côté client — c'est par design, ce sont les clés publiables Stripe (pas une fuite).

### 10. Idempotency-key

Cf. `docs/conventions/stripe-idempotency.md` (créée audit phase A §L-6). Toutes les opérations Stripe write applicatives ont une clé idempotente dérivée de l'ID DB stable, audit phase A §M-2 a fixé le path revival.

### 12. Anti-CSRF

`SameSite=Lax` par défaut sur les cookies Supabase + lecture session SSR-side dans le middleware (la session est jugée sur cookie HttpOnly, pas sur header Authorization que JS pourrait poser). Les requêtes POST cross-origin sans navigation ne portent pas le cookie en SameSite=Lax → protection CSRF effective.

Pas de double-submit token explicite, mais SameSite=Lax + le passage par le middleware Supabase SSR couvrent l'OWASP CSRF cheat sheet 2024 pour ce niveau d'app.

---

## WARN — durcissements recommandés

### W-1 — `next.config.js` ne définit pas de `headers()`

**Preuve** : `next.config.js:1-22` → uniquement `reactStrictMode` + `images.remotePatterns`. Pas de `headers()` Next.js, pas de `middleware.ts` qui pose des headers de sécurité.

| Header                       | Source actuelle                           | Recommandation pour SAQ-A polish                |
|------------------------------|-------------------------------------------|-------------------------------------------------|
| `Strict-Transport-Security`  | Vercel par défaut (`max-age=63072000`)    | OK (déjà présent)                               |
| `X-Frame-Options`            | Aucune (Next.js + Vercel ne posent rien)  | `SAMEORIGIN` (clickjacking protect)             |
| `X-Content-Type-Options`     | Aucune                                    | `nosniff`                                       |
| `Referrer-Policy`            | Aucune (browser default = strict-origin-when-cross-origin) | `strict-origin-when-cross-origin` explicite     |
| `Content-Security-Policy`    | Aucune                                    | CSP avec `https://js.stripe.com` + `https://m.stripe.network` whitelistés (Stripe Elements requirement) |
| `Permissions-Policy`         | Aucune                                    | `camera=(), microphone=(), geolocation=(self)` (DistanceWidget géoloc OK) |

**Severity SAQ-A** : WARN, pas FAIL. Le SAQ-A n'exige pas explicitement ces headers (ils relèvent plus de l'hygiène générale OWASP). Mais Stripe Radar / la PSP marketplace TerrOir ferait remonter ces drapeaux dans n'importe quel pentest light.

**Fix recommandé V1.1** :

```js
// next.config.js
async headers() {
  return [
    {
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        // CSP plus complexe : Stripe Elements requiert frame-src + script-src
        // sur https://js.stripe.com et https://m.stripe.network. Mapbox aussi
        // a besoin d'un worker-src 'self' blob:. À élaborer en chantier dédié
        // pour ne pas casser la prod par typo CSP.
      ],
    },
  ];
}
```

**Estimé** : 1-2h pour les 4 headers simples. **2-4h** supplémentaires si on veut une vraie CSP testée (Stripe + Mapbox + Supabase + Resend tracking pixels). Pas bloquant pour go-live ; à inscrire au backlog V1.1.

### W-2 — Endpoints Stripe non rate-limités

**Preuve** : `lib/rate-limit.ts` expose 4 helpers (`signup`, `login`, `magic_link`, `recovery`). Aucun consommé dans `app/api/stripe/*` (grep `Ratelimit|rateLimit` dans `app/api/stripe/` = 0 hit, sauf `audit-stripe-2026-05-05.md` qui est doc).

**Endpoints concernés** :
- `POST /api/stripe/create-payment-intent` — abuse possible : un user authentifié pourrait créer N PaymentIntents en spam (chaque PI = 1 round-trip Stripe + log Audit). Pas de coût direct (Stripe ne facture pas la création), mais pollution Dashboard.
- `POST /api/stripe/refund` — déjà protégé par session admin / producer-owner, mais un admin compromis pourrait refund N orders en boucle.
- `POST /api/stripe/connect/onboard` — création comptes Connect en spam = impact reputation TerrOir auprès Stripe (KYC peut s'inquiéter d'un volume anormal).
- `POST /api/stripe/webhook` — protégé par signature + IP allowlist (LOT 1) — pas besoin de rate-limit applicatif.

**Severity SAQ-A** : WARN, le SAQ-A ne demande pas de rate-limit applicatif, mais le PSP Stripe peut suspendre TerrOir si un volume anormal est détecté côté API.

**Fix recommandé V1.1** :
- Ajouter un `getStripeWriteRateLimit()` dans `lib/rate-limit.ts` (ex. `10/min/user`).
- Consommer dans `/api/stripe/create-payment-intent`, `/api/stripe/refund`, `/api/stripe/connect/onboard`.
- Webhook restant exempté (signature suffit + IP allowlist).

**Estimé** : 2-3h. À inscrire au backlog V1.1.

---

## Cross-référence audit phase A

| Finding phase A     | Statut SAQ-A actuel                                                 |
|---------------------|---------------------------------------------------------------------|
| H-1 / H-3 SDK upgrade | ✅ FIXED phase 3 (commit 811d178) — apiVersion `2026-04-22.dahlia` |
| H-2 Connect controller props | ✅ FIXED phase 2 (commit bfc19c3)                           |
| M-1 dynamic payment methods | ✅ FIXED phase 2                                            |
| M-2 idempotency revival     | ✅ FIXED phase 2                                            |
| M-3 webhook events utiles   | ✅ FIXED phase 2 (commit be9f2ad)                           |
| M-4 cron deadline disputes  | ⏳ Non bloquant SAQ-A — backlog V1.1                        |
| M-5 test→live customer drift | ⏳ Décision cutover — runbook                              |
| M-6 guard charges_enabled   | ⏳ Mitigé par RLS, backlog V1.1                             |
| L-1 IP allowlist            | ✅ FIXED phase B (LOT 1)                                    |
| L-2/4/5/6 (low priority)    | ⏳ Backlog V1.1                                             |
| L-3 Apple Pay domain        | ✅ FIXED phase 2                                            |

**Aucun finding phase A ne contredit l'éligibilité SAQ-A.**

---

## Recommandations pour go-live

Aucune action bloquante PCI SAQ-A. Les 2 WARN (W-1 headers, W-2 rate-limit Stripe endpoints) sont à traiter en **V1.1** comme durcissement defense-in-depth, pas comme prérequis du go-live.

Sur le runbook de bascule test→live :
1. Confirmer que les variables `STRIPE_SECRET_KEY` (`sk_live_*`) et `STRIPE_WEBHOOK_SECRET` (whsec live) sont configurées **uniquement** sur l'environnement Production Vercel (pas Preview).
2. Vérifier que `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_live_*`) est configuré côté Production Vercel.
3. Apply `scripts/register-payment-method-domain.ts --apply` sur compte LIVE pour Apple Pay (cf. fix phase 2 M-1/L-3).
4. Cocher dans Dashboard Stripe LIVE webhook endpoint config les 3 events ajoutés phase 2 M-3 : `radar.early_fraud_warning.created`, `charge.refunded`, `account.application.deauthorized`.

---

## Liens

- [PCI SSC SAQ-A document (v4.0)](https://www.pcisecuritystandards.org/document_library/?category=saqs#results)
- [Stripe — qualifying for SAQ-A](https://docs.stripe.com/security/guide#stripe-elements)
- Audit Stripe phase A `audit-stripe-2026-05-05.md`
- LOT 1 IP allowlist : `lib/stripe/ip-allowlist.ts` + `docs/conventions/stripe-webhook.md`
- Audit RPC `audit-rpc-edge-2026-05-05.md` Annexe C (signature + dédup webhook)

---

**Aucune modification appliquée. Audit READ-ONLY pour arbitrage.**
