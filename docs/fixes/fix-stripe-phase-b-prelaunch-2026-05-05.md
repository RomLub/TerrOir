# Fix — audit Stripe phase B pré-launch (2026-05-05)

> **Périmètre** : 3 items résiduels de l'audit Stripe phase A (`audit-stripe-2026-05-05.md`) initialement classés post-launch, traités AVANT go-live pour partir avec 0 dette Stripe identifiée.
> **Branches** : direct master (cohérent avec workflow audits Stripe phase 1/2/3 — pas de feature branches dédiées).
> **Statut** : tous les lots ✅ FIXED. Aucun apply Stripe live.

## TL;DR

| Lot   | Item                                  | Statut    | Livrable                                                                                          |
|-------|---------------------------------------|-----------|---------------------------------------------------------------------------------------------------|
| LOT 1 | L-1 IP allowlist webhook Stripe       | ✅ FIXED  | `lib/stripe/ip-allowlist.ts` + check route + 17 tests vitest + doc convention                     |
| LOT 2 | PCI DSS SAQ-A audit léger             | ✅ AUDITED | `docs/audits/audit-stripe-pci-saq-a-2026-05-05.md` — 10 OK / 2 WARN / 0 FAIL → SAQ-A éligible    |
| LOT 3 | 3DS matrice Playwright exhaustive     | ✅ TESTED | `tests/e2e/stripe-3ds-matrix.spec.ts` — 4 tests E2E + 1 skip documenté (drive UI hors scope)     |
| LOT 4 | Doc fix + runbook update              | ✅ DONE   | Cette page + audit phase A markups + runbook go-live update                                       |

---

## LOT 1 — IP allowlist webhook Stripe (audit phase A §L-1)

### Diagnostic

L'audit phase A §L-1 documente le manque d'IP allowlist en defense-in-depth :
- Signature HMAC `stripe.webhooks.constructEvent` est la défense principale, mais consomme du compute Vercel pour TOUTE requête (y compris floods, scans, attaquants tentant de bruteforcer la signature).
- Une fuite future de `STRIPE_WEBHOOK_SECRET` (ex. log accidentel, leak Vercel envvar) bypass la signature ; l'IP allowlist est la 2e ligne.

### Implémentation

**`lib/stripe/ip-allowlist.ts`** — nouveau module avec :
- `STRIPE_WEBHOOK_IPS: ReadonlySet<string>` — 15 IPv4 officielles Stripe (cf. https://docs.stripe.com/ips section "Webhook notifications", capturées 2026-05-05).
- `isStripeWebhookIp(ip: string | null): boolean` — true si IP ∈ Set, ou bypass implicite quand `process.env.VERCEL_ENV !== 'production'` (preview / dev / CI).
- `extractWebhookClientIp(headers: Headers): string | null` — parse `x-forwarded-for` (1re entrée du CSV Vercel) avec fallback `x-real-ip`. Aligné sur le pattern `lib/audit-logs/log-auth-event.ts:158-167`.

**Pourquoi pas de CIDR / lib externe (`ip-cidr`)** : la doc Stripe ne liste que des IPv4 individuelles, pas de CIDR ranges ni IPv6. Un simple `Set<string>.has(ip)` suffit. 0 nouvelle dépendance npm.

**`app/api/stripe/webhook/route.tsx`** — check ajouté en début de POST, AVANT la vérif signature :

```ts
const clientIp = extractWebhookClientIp(request.headers);
if (!isStripeWebhookIp(clientIp)) {
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  console.warn(
    `[STRIPE_WEBHOOK_IP_REJECTED] ip=${clientIp ?? "null"} ua=${userAgent}`,
  );
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

Le `console.warn` log grep-able sur Vercel pour observer les rejets en prod (signal de scans / attaquants). 403 est volontaire (pas 5xx) parce que Stripe ne retry que sur 5xx — 403 est définitif côté l'attaquant, et n'a aucune raison d'arriver de Stripe en pratique.

### Bypass dev/preview — rationnel

Le bypass `VERCEL_ENV !== 'production'` est intentionnel :
- En **preview Vercel** : tests CI, rejouages locaux via `stripe listen --forward-to`. L'IP du forwarder Stripe CLI n'est pas dans la liste officielle (c'est l'IP du dev local après tunnel ngrok-style).
- En **dev local** (`next dev`) : les tests vitest de la route émettent des requêtes synthétiques sans header IP du tout. Un enforcement strict ferait échouer les tests existants.
- En **prod Vercel** : enforcement strict, fail-closed (403 si IP absente OU non whitelistée).

### Tests

| Fichier                                                       | Tests | Couverture                                                           |
|---------------------------------------------------------------|-------|----------------------------------------------------------------------|
| `tests/lib/stripe/ip-allowlist.test.ts`                       | 12    | Set source (count + IPs spécifiques) + gate env (production/preview/dev/undefined) + extraction headers |
| `tests/app/api/stripe/webhook/route.test.tsx` (suite L-1)     | 5     | IP Stripe OK → handler exécuté, IP non-Stripe → 403 + log + court-circuit total, x-real-ip fallback OK, no header → 403, preview bypass OK |

**Total : 17 tests vitest**, tous passants après TSC clean + lint clean (warning préexistant `user-provider.tsx` hors périmètre).

### Doc convention

`docs/conventions/stripe-webhook.md` (NEW) documente :
- La stack défense (IP allowlist → signature → dédup applicative).
- La grille comportement par environnement.
- La procédure de refresh trimestriel de la liste IP (`curl https://stripe.com/files/ips/ips_webhooks.txt` + diff).
- **Fail-mode désync explicite** : Stripe NE retry PAS les 4xx (uniquement 5xx). Une IP nouvelle non whitelistée = events perdus définitivement pendant la fenêtre de drift → mieux pécher par excès que par défaut.
- Alternative envisagée et **rejetée** (fetch dynamique de la liste) — risque d'init bloquée + surface MITM.

### Trade-offs LOT 1

- **Choix simple ≠ meilleure perf de scale** : la liste hardcodée demande un refresh manuel. Pour TerrOir V1 (volume webhooks ~1k/jour), c'est largement OK. À scale (>100k/jour), un fetch dynamique avec cache 24h aurait du sens.
- **Bypass preview pas idéal en théorie sécu** : si quelqu'un trouve l'URL preview du PR `https://terroir-pr-123.vercel.app/api/stripe/webhook`, il bypass. Mais l'URL preview est unguessable et le `STRIPE_WEBHOOK_SECRET` est différent en preview — donc même un appel non-Stripe va fail au constructEvent. Acceptable.
- **Pas de retry intelligent en cas de vrai drift** : si Stripe ajoute une 16e IP entre deux refreshes, on perd les events de cette IP. Mitigation : Stripe communique généralement sur leur changelog avant un changement IP. On pourrait wirer un Linear ticket cron-trimestriel pour le check.

---

## LOT 2 — PCI DSS SAQ-A audit léger (audit READ-ONLY)

### Périmètre

Self-Assessment Questionnaire A (SAQ-A) — applicable aux marchands qui externalisent **intégralement** la collecte/traitement/stockage des données de carte. C'est le scope le plus light de PCI DSS, accessible aux intégrations e-commerce qui utilisent Stripe Elements iframe-only (cas TerrOir).

### Méthode

Audit READ-ONLY pur. Aucune modification de code.

Vérifications (12 catégories) :
1. Aucune CB ne transite par les serveurs TerrOir → Stripe Elements iframe ✅
2. HTTPS partout en production → Vercel auto + force HTTP→HTTPS ✅
3. Headers de sécurité applicatifs (CSP, X-Frame, X-Content-Type, Referrer-Policy) → ⚠️ WARN
4. Aucun stockage local de données carte → grep `localStorage`/`sessionStorage` ✅
5. Aucun log applicatif de données carte → grep `card_number`/`cvv`/`cvc` = 0 hit applicatif ✅
6. Stripe webhook signature vérifiée → Phase 1 ✅
7. Stripe webhook IP allowlist (defense-in-depth) → LOT 1 phase B ✅
8. Cookies session sécurisés (HttpOnly, Secure, SameSite) → `@supabase/ssr` ✅
9. `STRIPE_SECRET_KEY` jamais exposé côté client → grep + structure `lib/stripe/server.ts` ✅
10. Idempotency-key sur opérations Stripe write → audit phase A §L-6 + doc ✅
11. Rate-limiting endpoints Stripe critiques → ⚠️ WARN (uniquement signup/login/recovery)
12. Anti-CSRF → SameSite=Lax + SSR session ✅

### Verdict

**10 OK / 2 WARN / 0 FAIL → SAQ-A éligible.**

Les 2 WARN ne sont PAS des bloqueurs SAQ-A. Ce sont des durcissements defense-in-depth optionnels :
- **W-1 — Headers de sécurité** : `next.config.js` ne définit pas de `headers()` Next.js. HSTS est posé automatiquement par Vercel, mais X-Frame-Options, X-Content-Type-Options, Referrer-Policy, CSP, Permissions-Policy sont tous absents. Recommandé V1.1, pas bloquant SAQ-A.
- **W-2 — Rate-limiting Stripe endpoints** : `lib/rate-limit.ts` expose 4 helpers (signup/login/magic_link/recovery) mais aucun n'est appliqué à `/api/stripe/create-payment-intent`, `/api/stripe/refund`, `/api/stripe/connect/onboard`. Recommandé V1.1, pas bloquant SAQ-A (le risque est plus reputational vis-à-vis Stripe que PCI direct).

### Livrable

`docs/audits/audit-stripe-pci-saq-a-2026-05-05.md` — détail des 12 contrôles + cross-référence audit phase A + recommandations go-live.

### Trade-offs LOT 2

- **Scope SAQ-A ≠ SAQ-D** : on a délibérément audité au scope minimal applicable (SAQ-A). Si Stripe ou une autorité demandait SAQ-D-EP plus tard (très improbable pour un marketplace iframe-only), il faudrait re-auditer 130+ contrôles. Out of scope phase B.
- **Non-vérification du Dashboard Stripe live** : l'audit est code-only. La config réelle du compte Stripe live (clés rotées régulièrement, restricted keys avec scopes minimaux, etc.) reste à vérifier au cutover via le runbook go-live.

---

## LOT 3 — 3DS matrice Playwright

### Périmètre

Étendre les tests E2E avec une matrice 3DS couvrant les cartes documentées Stripe https://docs.stripe.com/testing#regulatory-cards :

| Carte                | Scénario                                       |
|----------------------|------------------------------------------------|
| 4000 0084 0000 1629  | 3DS frictionless (no challenge)                |
| 4000 0000 0000 3055  | 3DS optional, succeed sans challenge           |
| 4000 0027 6000 3184  | 3DS required, succeed après challenge          |
| 4000 0000 0000 3220  | 3DS required (Visa générique)                  |
| 4000 0082 6000 3178  | 3DS required + DECLINED post-challenge         |

### Approche pragmatique

**Décision majeure** : ne PAS driver l'iframe Stripe Elements ni l'iframe 3DS challenge. Confirmer le PaymentIntent côté serveur via `stripe.paymentIntents.confirm` avec un `PaymentMethod` créé inline depuis raw card data (légitime en test mode `sk_test_*`, refus en live sauf SAQ-D).

**Pourquoi** :
- L'expérience smoke phase 3 a montré que driver Stripe UI (Connect Express en l'occurrence) est instable en headless : sélecteurs DOM non documentés, anti-bot CAPTCHA sur subdomain `hooks.stripe.com`, race-conditions iframe.
- Confirm server-side suffit à valider que **TerrOir** + **Stripe API** + **`apiVersion: 2026-04-22.dahlia` + SDK 22** parsent correctement les structures 3DS retournées (`requires_action`, `next_action.type`, `payment_method`, etc.).
- L'expérience consumer réelle (saisie carte + challenge) est testée manuellement par Romain au moment du cutover (cf. runbook étape 4 — smoke 1€ + refund).

### Livrable

`tests/e2e/stripe-3ds-matrix.spec.ts` — 4 tests Playwright actifs :

1. **3DS frictionless succeed** (4000 0084 0000 1629) → confirm direct retourne `succeeded`, simul webhook payment_intent.succeeded → order DB passe à 'pending'.
2. **3DS optional succeed** (4000 0000 0000 3055) → confirm direct retourne `succeeded`, idem webhook → 'pending'.
3. **3DS required success** (4000 0027 6000 3184) → confirm retourne `requires_action` + `next_action.type ∈ {use_stripe_sdk, redirect_to_url}`. Order reste en statut initial 'cart'. **Pas de complétion challenge** — drive UI hors scope.
4. **3DS required Visa** (4000 0000 0000 3220) → idem test 3 (carte alternative pour couvrir le path Visa générique).

**1 test skip documenté** :

5. **3DS required + DECLINED post-challenge** (4000 0082 6000 3178) → SKIP avec doc inline. Justification : la décline post-challenge nécessite de cliquer "Fail Test Payment" dans l'iframe Stripe `hooks.stripe.com/3d_secure_2/...` — drive instable. Couverture indirecte via `tests/lib/stripe/handle-payment-failed.test.ts` (transition `cancelled+payment_failed` sur webhook `payment_intent.payment_failed`).

### Helpers réutilisés

- `createTestProducer` (statut `'public'` + flags Stripe Connect bypass)
- `createTestUser` + `loginAs`
- `getRawAdminClient`
- `cleanupAllTrackedUsers` via `test-context.ts` afterEach
- Pattern signature webhook `makeSignedWebhookPost` aligné sur `stripe-webhooks-m3.spec.ts`

### Cleanup

Chaque test fait :
- `stripe.refunds.create` (idempotency-key `refund_<piId>_3ds_<scenario>` — convention `docs/conventions/stripe-idempotency.md`) si PI succeeded.
- `stripe.paymentIntents.cancel` si PI en `requires_*` (cas 3 + 4).
- DB rows purgés (`order_items`, `orders`, `products`, `slots`).
- `cleanupAllTrackedUsers` afterEach via `ctx`.

### Trade-offs LOT 3

- **4 tests sur 5 actifs (80%)** : on accepte un trou explicite sur le path decline post-challenge. C'est documenté inline + dans ce fix doc + dans le runbook.
- **Confirm server-side ≠ flow consumer réel** : le confirm via SDK Node bypass le flow `confirmPayment` côté Stripe.js. La validation que le **client** TerrOir fonctionne avec 3DS reste manuelle (smoke 1€ runbook). Acceptable parce que la chaîne TerrOir → Stripe API → DB est entièrement testée, et la chaîne navigateur → Stripe.js → Stripe API est garantie par Stripe.
- **Pas de cron CI configuré** : ces tests tournent à la demande (pas de schedule GitHub Actions automatique). Décision cohérente avec le pattern `stripe-smoke-phase3.spec.ts` (run manuel au moment des audits / cutover).

---

## LOT 4 — Doc fix + runbook update

### Mise à jour audit phase A

`docs/audits/audit-stripe-2026-05-05.md` : ajout du marker `✅ FIXED (Phase B pré-launch)` sur §L-1 + nouvelle section "Phase B pré-launch (traités 2026-05-05)" dans les recommandations finales avec les 3 livrables.

### Mise à jour runbook go-live

`docs/runbooks/go-live-stripe.md` : section "Items à compléter pendant phase B" mise à jour pour pointer les 3 items résolus, avec liens vers les nouveaux livrables.

### Cette page

`docs/fixes/fix-stripe-phase-b-prelaunch-2026-05-05.md` — récap complet des 3 lots avec rationale.

---

## Ce qui reste avant go-live

| Catégorie                          | Items résiduels                                                                                            |
|------------------------------------|------------------------------------------------------------------------------------------------------------|
| Audit phase A — non bloquant       | M-4 (cron deadline disputes), M-5 (test→live drift — runbook), M-6 (guard charges_enabled — mitigé RLS)    |
| Audit phase A — backlog V1.1       | L-2 (business_type prompt), L-4 (cron schedule alignment), L-5 (workflow refund producer), L-6 (idempotency conventions doc — déjà partiel) |
| Audit phase B — backlog V1.1       | W-1 PCI (headers de sécurité Next.js), W-2 PCI (rate-limit Stripe endpoints)                               |
| Apply Stripe live                  | Cf. runbook go-live étapes 1-4 (Vercel envvars + webhook endpoint + purge DB + smoke 1€)                   |

**Aucun item bloquant restant.** Le go-live peut être planifié dès que Romain est prêt côté communication producteurs (étape 5 du runbook).

---

## Liens

- Audit phase A : [`audit-stripe-2026-05-05.md`](../audits/audit-stripe-2026-05-05.md)
- Audit phase B PCI SAQ-A : [`audit-stripe-pci-saq-a-2026-05-05.md`](../audits/audit-stripe-pci-saq-a-2026-05-05.md)
- Convention webhook : [`stripe-webhook.md`](../conventions/stripe-webhook.md)
- Convention idempotency : [`stripe-idempotency.md`](../conventions/stripe-idempotency.md)
- Runbook go-live : [`go-live-stripe.md`](../runbooks/go-live-stripe.md)
- Spec E2E 3DS : [`tests/e2e/stripe-3ds-matrix.spec.ts`](../../tests/e2e/stripe-3ds-matrix.spec.ts)
- Module IP allowlist : [`lib/stripe/ip-allowlist.ts`](../../lib/stripe/ip-allowlist.ts)
