# Rate-limiting applicatif — convention TerrOir

> **Source** : `lib/rate-limit.ts` (T-305 PR-A, étendu audit Stripe pré-launch W-2 2026-05-05).
> **Provider** : Upstash Redis (sliding window) via `@upstash/ratelimit` + `@upstash/redis`.
> **Fail-open** : si `UPSTASH_REDIS_REST_URL` / `_TOKEN` absent OU Redis throw au runtime → `success=true`. Un incident infra ne doit jamais bloquer un user légitime (DoS auto-infligé).

---

## Endpoints rate-limités actuels

| Domaine | Helper                                       | Cap     | Endpoint / call site                                     | Key            | Réponse over-cap                                                         |
|---------|----------------------------------------------|---------|----------------------------------------------------------|----------------|--------------------------------------------------------------------------|
| Auth    | `getSignupRateLimit`                         | 5/60s   | `app/(consumer)/auth/inscription/actions.ts` (signup)    | IP             | UI : `"Trop de tentatives. Réessayez dans quelques minutes."`            |
| Auth    | `getLoginRateLimit`                          | 5/60s   | `app/connexion/actions.ts` (loginAction)                 | IP             | UI : idem                                                                |
| Auth    | `getMagicLinkRateLimit`                      | 3/120s  | `app/connexion/actions.ts` (requestMagicLinkAction)      | IP             | UI : idem                                                                |
| Auth    | `getRecoveryRateLimit`                       | 3/60s   | `app/connexion/actions.ts` (requestPasswordResetAction)  | IP             | UI : idem                                                                |
| Stripe  | `getStripeCreatePaymentIntentRateLimit`      | 10/60s  | `app/api/stripe/create-payment-intent/route.ts`          | `userId`       | `429 { error: 'rate_limited', retry_after }` + header `Retry-After`      |
| Stripe  | `getStripeRefundRateLimit`                   | 5/60s   | `app/api/stripe/refund/route.tsx`                        | `userId` ∥ IP  | `429 { error: 'rate_limited', retry_after }` + header `Retry-After`      |
| Stripe  | `getStripeConnectOnboardRateLimit`           | 3/60s   | `app/api/stripe/connect/onboard/route.ts`                | `userId`       | `429 { error: 'rate_limited', retry_after }` + header `Retry-After`      |
| Pickup  | `getPickupValidationRateLimit`               | 10/60s  | `app/api/orders/[id]/complete/route.tsx` + `app/api/producer/orders/validate-pickup/route.ts` | `producerId`   | `429 { error: 'rate_limit', retry_after_seconds }` + header `Retry-After` + audit `pickup_attempt_rate_limited` |

`POST /api/stripe/webhook` est **exempté** : signature `stripe.webhooks.constructEvent` + IP allowlist (`lib/stripe/ip-allowlist.ts`) = double-defense suffisante.

---

## Pattern de key

| Scénario                                        | Key recommandée            | Rationnel                                                                                       |
|-------------------------------------------------|----------------------------|-------------------------------------------------------------------------------------------------|
| Endpoint pré-auth (signup, login, magic link)   | IP (`x-forwarded-for[0]`)  | Aucun userId disponible. Cap aligné sur le coût d'un mail / lookup DB.                          |
| Endpoint post-auth (Stripe write, RGPD action)  | `userId`                   | Évite de pénaliser une IP NAT (entreprise, réseau partagé). Auth obligatoire = userId garantie. |
| Endpoint mixte (anon possible mais rare)        | `userId ?? IP fallback`    | Cf. `/api/stripe/refund` : la session est lookupée en haut, fallback IP via `extractRequestContext`. |

> **Pourquoi pas IP-only sur les endpoints post-auth ?** Une IP NAT partagée (entreprise, restau, réseau public) consomme le même quota pour tous les users derrière. Pour les endpoints "1 action / user / minute", c'est une régression UX. Pour les endpoints pré-auth (signup / login), au contraire, IP-keying est la bonne primitive (attaquant qui crée 1000 comptes depuis 1 IP).

---

## Ajouter un nouveau rate-limit

### 1. Définir le cap

Choisir le cap en fonction de **3 critères** :

1. **Coût unitaire** de l'opération (round-trip réseau, écriture DB, send mail, charge Stripe). Plus c'est cher, plus le cap doit être bas.
2. **Pattern d'usage légitime** : combien de fois un user vrai déclenche cette action en 60s ? Multiplier par 2-3× pour absorber retries (réseau flaky, double-clic React, refresh).
3. **Surface d'abus** : un endpoint qui send un mail = flooding boîte cible (cap dur). Un endpoint qui crée une row DB sans coût direct = cap plus généreux.

| Coût élevé / abus haute   | 1-3 / 60s   |
|---------------------------|-------------|
| Action user normale       | 5-10 / 60s  |
| Action lecture / cache    | 30-60 / 60s |

### 2. Ajouter le helper dans `lib/rate-limit.ts`

```typescript
let _myFeatureLimiter: Ratelimit | null | undefined;

export function getMyFeatureRateLimit(): Ratelimit | null {
  if (_myFeatureLimiter === undefined) {
    _myFeatureLimiter = createRateLimiter(N, "60 s", "my_feature");
    //                                    ^   ^      ^
    //                                cap   window  prefix Redis (scope les clés)
  }
  return _myFeatureLimiter;
}
```

Le **prefix** Redis doit être unique : il scope les clés (`ratelimit:my_feature:<key>`) pour éviter les collisions entre flows.

### 3. Consommer dans le call site

**Server action (UI form)** :

```typescript
import { headers } from "next/headers";
import { extractRequestContext } from "@/lib/audit-logs/log-auth-event";
import { consumeRateLimit, getMyFeatureRateLimit } from "@/lib/rate-limit";
import { logAuthEvent } from "@/lib/audit-logs/log-auth-event"; // ou logPaymentEvent

const { ipAddress } = extractRequestContext(headers());
const rl = await consumeRateLimit(getMyFeatureRateLimit(), userId ?? ipAddress ?? "unknown");
if (!rl.success) {
  await logAuthEvent({
    eventType: "rate_limit_exceeded",
    userId: null,
    metadata: { route: "my_feature", cap: rl.limit, reset: rl.reset },
  });
  return { error: "Trop de tentatives. Réessayez dans quelques minutes." };
}
```

**Route API (JSON)** :

```typescript
import { consumeRateLimit, getMyFeatureRateLimit } from "@/lib/rate-limit";
import { extractRequestContext } from "@/lib/audit-logs/log-auth-event";

const key = session?.id ?? extractRequestContext(request.headers).ipAddress ?? "unknown";
const rl = await consumeRateLimit(getMyFeatureRateLimit(), key);
if (!rl.success) {
  const retryAfter = Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000));
  console.warn(`[MY_FEATURE_RATE_LIMITED] key=${key} cap=${rl.limit} retry_after=${retryAfter}`);
  return NextResponse.json(
    { error: "rate_limited", retry_after: retryAfter },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
```

### 4. Tester

Pattern type vitest (cf. `tests/app/api/stripe/{create-payment-intent,refund,connect/onboard}/route.test.ts`) :

```typescript
const { mockConsumeRateLimit } = vi.hoisted(() => ({
  mockConsumeRateLimit: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: mockConsumeRateLimit,
  getMyFeatureRateLimit: () => null,
}));

beforeEach(() => {
  mockConsumeRateLimit.mockReset().mockResolvedValue({
    success: true,
    limit: N,
    remaining: N - 1,
    reset: Date.now() + 60_000,
  });
});

it("rate-limit dépassé → 429 + retry_after", async () => {
  mockConsumeRateLimit.mockResolvedValueOnce({
    success: false,
    limit: N,
    remaining: 0,
    reset: Date.now() + 30_000,
  });
  // ... assert 429 + body.error === "rate_limited" + body.retry_after > 0
});
```

> **Important** : mocker `@/lib/rate-limit` dans les tests qui exercent une route consommant le helper évite le warn lazy-init `[RATE_LIMIT_WARN] UPSTASH_REDIS_REST_URL/TOKEN absent` qui peut casser des assertions `expect(consoleWarnSpy).not.toHaveBeenCalled()`.

### 5. Documenter

Ajouter une ligne au tableau « Endpoints rate-limités actuels » ci-dessus.

---

## Limites connues

- **Multi-instance Vercel** : Upstash Redis global → cohérence forte entre toutes les régions Vercel. Pas de problème de compteurs locaux par instance.
- **Fail-open en cas de panne Redis** : volontaire (cf. `lib/rate-limit.ts` §header). Le `console.error('[RATE_LIMIT_REDIS_ERROR]')` alimente les alertes Vercel pour réaction hors-bande.
- **IP NAT partagée** : un seul cap pour tous les users d'une grosse entreprise / NAT. Mitigé par userId-keying sur les endpoints post-auth.
- **Pas de cap progressif** : la fenêtre est sliding window simple, pas de back-off exponentiel. Si un endpoint mérite mieux, voir `Ratelimit.cachedFixedWindow` ou `Ratelimit.tokenBucket` côté `@upstash/ratelimit`.

---

## Liens

- Source : `lib/rate-limit.ts`
- Tests : `tests/lib/rate-limit.test.ts`
- Audit T-305 (infra) : `docs/CHANGELOG.md` (PR-A 2026-04, PR-B 2026-04)
- Audit Stripe pré-launch W-2 (extension) : `docs/audits/audit-stripe-pci-saq-a-2026-05-05.md`
- Doc Upstash : <https://upstash.com/docs/redis/sdks/ratelimit-ts/overview>
