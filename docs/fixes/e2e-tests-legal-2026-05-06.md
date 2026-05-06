# Tests E2E Playwright legal — CGU/CGV

**Date** : 2026-05-06
**Scope** : Validation E2E continue de l'opposabilité juridique CGU (inscription) + CGV (checkout) implémentée par le commit `806fc87`.

## Couverture

`tests/e2e/legal/inscription-cgu.spec.ts` — 3 tests :
1. **Gate UI** : checkbox non cochée → bouton "Créer mon compte" reste désactivé.
2. **Liens nouvel onglet** : `/cgu` et `/politique-confidentialite` ont `target="_blank"` + `rel="noopener"`.
3. **Persistance DB** : cocher CGU + submit → row `public.users` créée avec `cgu_accepted_at` récent (fenêtre 60s) + `cgu_version = "1.0"`.

`tests/e2e/legal/checkout-cgv.spec.ts` — 3 tests :
1. **Gate auto-init** : avant cocher CGV → message "acceptez les CGV" visible, PaymentElement Stripe pas rendu, **0 order créée** en DB pour le consumer.
2. **Persistance DB** : cocher CGV → POST `/api/orders/create` 200, order créée avec `cgv_accepted_at` récent + `cgv_version = "1.0"` + `statut = "pending"` + `montant_total > 0`. PaymentElement Stripe initialisé.
3. **Lien nouvel onglet** : `/cgv` a `target="_blank"` + `rel="noopener"`.

**Total** : 6 tests, exécution ~36s sur ce setup local.

## Résultat exécution (2026-05-06)

```
Running 6 tests using 1 worker
  ✓ checkout-cgv : avant cocher CGV (8.8s)
  ✓ checkout-cgv : cocher CGV → order créée (10.1s)
  ✓ checkout-cgv : lien CGV nouvel onglet (4.9s)
  ✓ inscription-cgu : checkbox non cochée bloque submit (1.4s)
  ✓ inscription-cgu : liens nouvel onglet (713ms)
  ✓ inscription-cgu : cocher CGU → row users persistée (4.3s)
  6 passed (36.6s)
```

Cleanup post-run vérifié via MCP : `0 users / 0 producers / 0 products / 0 orders` résiduels matchant les patterns test.

## Modalités de cleanup

### Auto (fixture `ctx` afterEach)
- Tous les `userId` trackés (consumer + producer) sont purgés via `auth.admin.deleteUser` → cascade FK ON DELETE CASCADE sur `public.users`, `producers.user_id`, `email_change_otp_codes`, etc.

### Explicite (`finally` dans chaque spec checkout)
- `cleanupCheckoutData(setup)` :
  - `order_items` (FK order_id IN [...])
  - `orders` (FK consumer_id sur users — pas de cascade, ON DELETE NO ACTION)
  - `products` (par id)
  - `slots` (par id)

Pattern aligné `tests/e2e/stripe-3ds-matrix.spec.ts:cleanupSetup()`.

### Garde-fous emails

Tous les emails créés matchent le pattern allow-list strict : `^playwright-test-\d+(-[a-z0-9-]+)?@mailinator\.com$` (cf `tests/e2e/helpers/guards.ts`). Toute tentative d'écriture sur un autre email est bloquée par `assertSafeEmail()` au runtime — protection ceinture+bretelles vs un test mal écrit qui toucherait un email réel.

## Credentials nécessaires (`.env.local`)

| Var | Usage | Mode requis |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Helper `getRawAdminClient` | Prod URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypass RLS pour setup admin | Prod service_role |
| `STRIPE_SECRET_KEY` | (Indirect via `/api/stripe/create-payment-intent`) | **TEST mode obligatoire** (`sk_test_*`) |

Le serveur dev Next.js est lancé automatiquement par Playwright (`webServer.command = 'npm run dev'`, `reuseExistingServer: true`).

## Trade-offs et décisions autonomes

1. **Pas de saisie carte 3DS UI**. Le pattern `tests/e2e/stripe-3ds-matrix.spec.ts` documente que driver l'iframe Stripe Elements + iframe 3DS step-up via Playwright headless est instable (sélecteurs DOM Stripe non documentés, anti-bot, race-conditions). On valide la persistance `cgv_accepted_at` au moment de la création d'order (juste après le cocher CGV) — le flow paiement 3DS lui-même est déjà couvert par `stripe-3ds-matrix` (frictionless / optional / required) et `stripe-decline`.

2. **Inject panier via `localStorage` plutôt qu'UI add-to-cart**. Plus rapide (~5s gagnés/test), pas de dépendance sur la page produit qui pourrait évoluer indépendamment. Le format Zustand persist `terroir-cart` v1 est figé par le store (`lib/store/cart.ts:62-66`).

3. **Test inscription utilise UI réelle** (pas `createTestUser` bypass). L'enjeu est de valider le formulaire HTML + l'action server complète — `createTestUser` court-circuite tout ça. Coût : ~1 mail Resend par run du test happy path (~20-30 mails/mois si run quotidien, compatible quota 3000/mois).

4. **Pas de test "complétion magic link → DB"**. L'INSERT `public.users` avec `cgu_accepted_at` se fait IMMÉDIATEMENT au submit côté server action (cf `app/(consumer)/auth/inscription/actions.ts:102-110`), pas après le clic du magic link. Donc le test peut vérifier la persistance sans piloter Mailinator — gain de fragilité (Mailinator est un service externe avec des limites).

5. **Pas de test négatif "DB direct sans cocher"**. Le validator Zod `cgu_accepted` / `cgv_accepted: z.literal(true)` côté serveur est déjà couvert par les tests vitest (`tests/app/(consumer)/auth/inscription/actions.test.ts` cas CGU manquante / false ; `tests/app/api/orders/create/route.test.ts` cas B3/B4). Pas de duplication E2E.

## Pattern à reproduire pour futurs tests E2E légaux

### Cas "réacceptation après bump version 2.x"

Si on déploie `LEGAL_VERSIONS.CGU = "2.0"` et qu'on implémente le flow popup réacceptation au prochain login (out of scope V1), un test E2E pourrait :

1. Setup : `createTestUser` puis `safeUpdate("users", { cgu_accepted_at: new Date(...).toISOString(), cgu_version: "1.0" }, { id })` (simule un user pré-bump).
2. `loginAs(page, user)` → naviguer vers `/compte`.
3. Assert : modal/popup "Vous devez réaccepter…" visible.
4. Cocher + valider → query DB → `cgu_version = "2.0"`.
5. Cleanup auto via fixture afterEach.

### Cas "version snapshot CGV figé sur l'order"

Pour valider qu'une modification ultérieure de `LEGAL_VERSIONS.CGV` ne change PAS le `cgv_version` des orders existantes (snapshot juridique stable) :

1. Setup checkout + create order avec `cgv_version="1.0"`.
2. Patch `LEGAL_VERSIONS.CGV` vers `"2.0"` (ou simuler via env var override — chantier dédié).
3. Re-fetch l'order → `cgv_version` doit toujours être `"1.0"`.
4. Cleanup.

### Convention nommage

- Suffix email descriptif court : `cgu-gate`, `cgu-happy`, `cgv-cons-happy`. Apparaît dans le tracked email (`playwright-test-{ts}-cgu-happy@mailinator.com`) → debug post-run plus simple via audit log JSONL.
- `test.setTimeout()` explicite si > 30s (default config) : 60s pour les flows full UI, 90s si POST `/api/stripe/*` impliqué.
- `try / finally cleanupXxx(setup)` pour tout ce qui n'est pas tracké via cascade FK depuis `auth.users` (orders, products, slots).

## Risques connus

1. **Flakiness Stripe API** : si Stripe API est lent (>20s), le test "cocher CGV → order créée" peut timeout. Mitigation : `test.setTimeout(90_000)` + `waitForResponse` sur `/api/orders/create` plutôt que sur l'iframe Stripe.

2. **Quota Resend** : ~20-30 mails/mois à run quotidien. Si dépassement quota, le signUp échouera silencieusement (action retourne success mais pas de mail). Le test Playwright reste vert (il vérifie la DB, pas l'envoi mail) — cohérent avec le scope CGU mais à garder en tête.

3. **Mode Stripe LIVE par accident** : tous les tests utilisant Stripe ont un guard `test.beforeAll` qui vérifie `STRIPE_SECRET_KEY` commence par `sk_test_`. Mes tests legal utilisent indirectement Stripe via `/api/stripe/create-payment-intent` mais sans guard explicite ici — le call POST échouerait juste si LIVE car la carte test n'existe pas. Pas de risque de charge réelle.

## Out of scope V1

- Test E2E complétion 3DS challenge → cancel (couvert hors scope dans `stripe-3ds-matrix.spec.ts`).
- Test E2E réacceptation au login après bump majeur (chantier dédié quand le besoin se présente).
- Test négatif "client trafique le payload pour bypass cocher" — déjà couvert par les tests vitest backend (validator Zod).
