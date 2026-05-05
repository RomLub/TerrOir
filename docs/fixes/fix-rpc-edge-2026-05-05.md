# Fix Audit RPC & Edge Functions — 2026-05-05

## Contexte

- **Audit source** : [`docs/audits/audit-rpc-edge-2026-05-05.md`](../audits/audit-rpc-edge-2026-05-05.md) (rédigé tôt 2026-05-05, AVANT les chantiers RLS / Auth / Perf / Migrations bouclés ce jour-là).
- **Verdict global post-vérification** : la majorité des findings CRITICAL et HIGH étaient déjà fermés ; cette session a fixé 7 résiduels MEDIUM/HIGH plus la documentation des 4 LOW.
- **MCP Supabase actif** : 2 migrations apply via `apply_migration` en read-write sur prod, reconstituées localement pour cohérence repo↔prod.

### Chantiers antérieurs ayant fermé l'essentiel

| SHA / source | Chantier | Findings fermés |
|--------------|----------|-----------------|
| `4490c64` | RLS Lots 1-7 (ACL hardening) | C-1, C-2, M-5, H-3 (scan global), L-3 trigger ACL |
| `21a120d` | Auth régression | (hors périmètre RPC) |
| `9ea5f80` `54f9c58` `1429fee` | Perf Postgres | M-1 partiel (embeds N+1 sur order-timeout + reminder-consumer ; boucles Stripe/Resend laissées) |
| `2d570c5` `6c82afa` | Migrations T-241 + rate-limit producer_interests | H-2 trigger rate-limit, M-3 cleanup migration historique |
| **Cette session** | Audit RPC & Edge | **H-1, M-1 (5 crons), M-2, M-3 search_path INVOKER, M-4 retry cap, doc L-1..L-4** |

---

## Tableau des findings — statut post-vérification

| ID  | Sévérité | Description                                                                 | Statut        | Fixé par                          |
|-----|----------|-----------------------------------------------------------------------------|---------------|-----------------------------------|
| C-1 | CRITICAL | RPC `revive_order_with_stock_check` ACL PUBLIC                              | **FIXED**     | `4490c64` (chantier RLS)          |
| C-2 | CRITICAL | RPC `record_refund_attempt` ACL PUBLIC                                      | **FIXED**     | `4490c64` (chantier RLS)          |
| H-1 | HIGH     | `/api/stock-alerts/{confirm,unsubscribe}` GET prefetch RGPD                 | **FIXED**     | LOT 1 (cette session)             |
| H-2 | HIGH     | `/api/producer-interests` POST anonyme sans rate limit                       | **FIXED**     | `6c82afa` (chantier Migrations)   |
| H-3 | HIGH     | Pattern « DEFINER + ACL PUBLIC » sans garde                                 | **FIXED**     | `4490c64` (scan global → 0 ligne) |
| M-1 | MEDIUM   | Crons séquentiels Stripe/Resend = risque timeout Vercel                     | **FIXED**     | LOT 2 (cette session, 5 crons)    |
| M-2 | MEDIUM   | `/api/reviews/create` admin client + check applicatif                       | **FIXED**     | LOT 3 (cette session)             |
| M-3 | MEDIUM   | Triggers INVOKER sans `SET search_path` verrouillé                          | **FIXED**     | LOT 4 (cette session, migration)  |
| M-4 | MEDIUM   | `generate_order_code()` retry loop sans cap                                 | **FIXED**     | LOT 5 (cette session, migration)  |
| M-5 | MEDIUM   | `restore_product_stock_on_order_cancel()` ACL PUBLIC trigger                | **FIXED**     | `4490c64` (chantier RLS)          |
| L-1 | LOW      | `/api/health` ne check pas la DB                                            | **DOC ONLY**  | LOT 6 (décision : liveness pure)  |
| L-2 | LOW      | Idempotency keys Stripe conventionnelles                                    | **DOC ONLY**  | LOT 6 (convention documentée)     |
| L-3 | LOW      | Pas d'Edge Functions Supabase                                               | **DOC ONLY**  | LOT 6 (décision archi)            |
| L-4 | LOW      | Pas de webhook Resend entrant                                               | **BACKLOG**   | LOT 6 (Phase 8 observabilité)     |

**Synthèse compteurs** : 10 FIXED · 3 DOC ONLY · 1 BACKLOG · 0 OPEN.

---

## Pré-audit programmatique (vérification avant fix)

Les findings supposés fermés ont été re-vérifiés avant d'attaquer les résiduels :

```sql
-- C-1 / C-2 / M-5 : ACL service_role only
SELECT proname, proacl::text FROM pg_proc
WHERE pronamespace='public'::regnamespace
  AND proname IN ('revive_order_with_stock_check','record_refund_attempt','restore_product_stock_on_order_cancel');
-- → {postgres,service_role,supabase_auth_admin} pour les 3 (pas de PUBLIC)

-- H-2 : trigger rate-limit producer_interests
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid='public.producer_interests'::regclass;
-- → trg_producer_interests_rate_limit, tgenabled='O' (origin/enabled)

-- H-3 : scan global DEFINER + ACL PUBLIC sans garde
SELECT proname, proacl::text FROM pg_proc
WHERE pronamespace='public'::regnamespace
  AND prosecdef=true
  AND (proacl::text ~ '(\{|,)=X/' OR proacl IS NULL);
-- → 0 ligne
```

---

## LOT 1 — H-1 stock-alerts 2-step GET→POST

**Risque** : Outlook Safe Links / Gmail Image Proxy / Microsoft ATP / Mimecast / Proofpoint scannent les liens email à la livraison. Le GET actuel exécutait l'effet (confirm opt-in / unsubscribe) au premier hit, donc :
- L'opt-in alerte stock pouvait être validé sans intention utilisateur (consentement non-actif → risque RGPD).
- Un scan email pouvait désinscrire silencieusement, l'user s'étonnait de ne pas recevoir l'alerte.

**Fix** : pattern aligné sur `app/(public)/desabonnement` (Server Action 2-step déjà en place pour les opt-out RGPD producer_interests).

| Avant | Après |
|-------|-------|
| `GET /api/stock-alerts/confirm?token=xxx` → exécute `confirmStockAlert` → 303 redirect | `GET` → renvoie HTML 200 avec form POST (token en input hidden, no-store, noindex) ; `POST` (form-encoded) → exécute `confirmStockAlert` → 303 redirect |
| Idem pour `/api/stock-alerts/unsubscribe` | Idem pattern dual GET/POST |

**Tests** : 22/22 vert, dont nouveaux tests pour HTML escaping (XSS prevention) + headers anti-cache/anti-index.

**Fichiers** :
- `app/api/stock-alerts/confirm/route.ts` (réécriture totale)
- `app/api/stock-alerts/unsubscribe/route.ts` (réécriture totale)
- `tests/app/api/stock-alerts/confirm/route.test.ts` (12 tests)
- `tests/app/api/stock-alerts/unsubscribe/route.test.ts` (10 tests)

**Compatibilité emails déjà envoyés** : préservée — les liens `<base>/api/stock-alerts/confirm?token=xxx` pointent toujours vers le GET, qui renvoie maintenant la page de confirmation au lieu d'exécuter l'effet. L'utilisateur clique le bouton → POST → effet appliqué.

---

## LOT 2 — M-1 crons séquentiels → mapWithConcurrency

**Risque** : 4 crons (et un 5ème embarqué post-N+1) bouclaient séquentiellement sur N rows avec un appel Stripe / Resend / DB par row. Vercel coupe la fonction serverless à 60s (Pro). 1 round-trip Stripe ≈ 200-500ms → 100 incidents = 50s. Si Vercel kill à mi-batch, log partiel et drop silencieux.

**Fix** : helper `lib/concurrency/p-limit.ts` (~40 lignes, zéro dépendance externe) — `mapWithConcurrency(items, limit, worker)` qui retourne `PromiseSettledResult<R>[]`. Pattern : N workers tirent en parallèle depuis un curseur partagé.

| Cron                           | Cap    | Justification                              | Effet attendu sur 100 items |
|--------------------------------|--------|--------------------------------------------|------------------------------|
| `retry-failed-refunds`         | 10     | Stripe-only, accepte 25 req/s              | 50s → ~5s                   |
| `weekly-payout`                | 5      | Mixte DB+Resend, plus restrictif que Stripe | 50s → ~10s                  |
| `weekly-badges`                | 10     | DB-only (pas d'appel externe)              | 30s → ~3s                   |
| `order-timeout`                | 5      | Mixte Stripe+Resend, plus restrictif       | 50s → ~10s                  |
| `reminder-consumer`            | 5      | Resend uniquement                          | 30s → ~6s                   |

**Pour `retry-failed-refunds`** : ajout du log `[CRON_BATCH_TRUNCATED] cron=retry-failed-refunds processed=1000 limit=1000` quand on tape la limite (signal d'incident plus large : Stripe down, RGPD purge massive, etc.).

**Pour les 5 crons** : `export const maxDuration = 60` ajouté (cap explicite Vercel Pro).

**Tests** : 60/60 vert sur les 5 crons + helper :
- `tests/app/api/cron/retry-failed-refunds/route.test.ts` : 10 tests existants, ordre `mockResolvedValueOnce` préservé (cap=10 > 3 items donc invocation parallèle dans l'ordre des items).
- `tests/app/api/cron/order-timeout/route.test.ts` : 27 tests existants.
- `tests/app/api/cron/reminder-consumer/route.test.ts` : 4 tests existants.
- `tests/app/api/cron/weekly-badges/route.test.ts` : 7 tests existants.
- `tests/app/api/cron/weekly-payout/route.test.ts` : **5 nouveaux tests smoke** (auth + envoi parallèle + skip already_exists/error + producer orphan).
- `tests/lib/concurrency/p-limit.test.ts` : **7 nouveaux tests** (vide, ordre préservé, cap respecté avec mesure peak inflight, throw non-bloquant, limit > items, limit=1 sériel, index correct).

**Fichiers modifiés** :
- `lib/concurrency/p-limit.ts` (nouveau)
- `app/api/cron/retry-failed-refunds/route.ts`
- `app/api/cron/order-timeout/route.tsx`
- `app/api/cron/reminder-consumer/route.tsx`
- `app/api/cron/weekly-payout/route.tsx`
- `app/api/cron/weekly-badges/route.ts`

---

## LOT 3 — M-2 /api/reviews/create user client + RLS-driven

**Risque** : admin client + check applicatif `order.consumer_id !== session.id` (ligne 36-38 ancienne version). Si un futur refactor bug le check (typo, condition inversée, perte de la colonne dans le SELECT), c'est un contournement RLS direct.

**Fix** : aligné avec le pattern `/api/orders/create` (user client SELECT, RLS naturelle).

| Avant | Après |
|-------|-------|
| `admin.from("orders").select(...)` puis check `consumer_id` applicatif | `supabase.from("orders").select(...)` (user client) → RLS "orders parties read" (`auth.uid() = consumer_id OR owns_producer`) filtre. 0 row → 404. |
| `admin.from("reviews").insert(...)` (bypass RLS) | `supabase.from("reviews").insert(...)` (user client) → RLS "reviews consumer insert after completed order" valide `auth.uid() == consumer_id AND is_completed_order_of_caller(order_id)` (defense-in-depth) |
| `admin.from("notifications").insert(...)` | **Inchangé** — RLS notifications n'autorise que self-read côté authenticated, INSERT vers admins requiert service_role |

**Notes** :
- Le check applicatif `order.consumer_id !== session.id` est **conservé** côté route pour différencier 404 (l'order n'existe pas / pas accessible) vs 403 (l'user est producer-owner et a pu lire l'order via l'autre branche RLS, mais ne peut pas reviewer). Sans ce check, un producer-owner aurait reçu un 500 RLS au lieu d'un 403 lisible.
- Pas de TOCTOU introduit : on ne re-fetch jamais l'order entre check et insert (le INSERT review utilise les colonnes lues lors du SELECT initial).

**Tests** : 12 nouveaux tests (auth, validation Zod, RLS-driven SELECT, happy path + notifications admin).

**Fichiers** :
- `app/api/reviews/create/route.ts` (refactor)
- `tests/app/api/reviews/create/route.test.ts` (nouveau, 12 tests)

---

## LOT 4 — M-3 search_path INVOKER (migration)

6 fonctions custom `SECURITY INVOKER` n'avaient pas `SET search_path` verrouillé. Risque actuel : nul (INVOKER = pas d'élévation possible). Risque futur : si l'une est promue en `SECURITY DEFINER` un jour, l'absence de `search_path` créerait une faille immédiate.

**Migration** : `20260505154054_rpc_lock_search_path_invoker_functions` (apply via MCP `apply_migration`).

```sql
ALTER FUNCTION public.compute_order_commission()      SET search_path = public, pg_temp;
ALTER FUNCTION public.enforce_user_exclusive()        SET search_path = public, pg_temp;
ALTER FUNCTION public.set_order_code()                SET search_path = public, pg_temp;
ALTER FUNCTION public.set_updated_at()                SET search_path = public, pg_temp;
ALTER FUNCTION public.slot_rules_set_updated_at()     SET search_path = public, pg_temp;
ALTER FUNCTION public.generate_order_code()           SET search_path = public, pg_temp;
```

`ALTER FUNCTION SET search_path` est non destructif : ne touche pas l'ACL, ne reset pas les triggers attachés, ne casse pas les references.

**Sanity post-apply** :
```sql
SELECT proname, proconfig FROM pg_proc
WHERE pronamespace='public'::regnamespace
  AND proname IN ('compute_order_commission','enforce_user_exclusive','set_order_code',
                  'set_updated_at','slot_rules_set_updated_at','generate_order_code');
-- → 6/6 avec proconfig = ['search_path=public, pg_temp']
```

**Reconstitution locale** : `supabase/migrations/20260505500000_rpc_lock_search_path_invoker_functions.sql` (préfixe `500000` = audit RPC, suite logique 100xxx RLS / 200xxx Auth / 300xxx Perf / 400xxx Migrations).

---

## LOT 5 — M-4 generate_order_code retry cap

**Risque** : `loop ... exit when not exists_already; end loop` — boucle infinie. Aujourd'hui 17 orders, prob collision 0.00005% par INSERT (négligeable). À 1M orders, ~3% (boucles parfois > 1 retry). À 10M : ~30%.

**Migration** : `20260505154131_rpc_generate_order_code_retry_cap` (apply via MCP).

Choix architectural : **CREATE OR REPLACE** (pas DROP+CREATE). Évite le piège du Lot 8 chantier Perf qui avait ré-attribué PUBLIC EXECUTE en regrant. CREATE OR REPLACE préserve l'ACL exact actuelle (`{postgres,service_role,supabase_auth_admin}`).

**Body** : `FOR attempt IN 1..10 LOOP ... IF NOT exists_already THEN RETURN candidate; END IF; END LOOP; RAISE EXCEPTION '... after % attempts ...' USING ERRCODE = 'P0002';`.

**Sanity post-apply** :
```sql
SELECT proname, proacl::text, proconfig FROM pg_proc
WHERE pronamespace='public'::regnamespace AND proname='generate_order_code';
-- → ACL inchangée, proconfig = ['search_path=public, pg_temp']

SELECT public.generate_order_code();
-- → 'TRR-MU9UJ' (format préservé)
```

**Reconstitution locale** : `supabase/migrations/20260505500100_rpc_generate_order_code_retry_cap.sql`.

---

## LOT 6 — Documentation des LOW

### L-1 — `/api/health` ne check pas la DB

**Décision** : garder en l'état. L'endpoint sert de **liveness** (le serveur Next répond), pas de **readiness** (toutes les deps sont up). Un check DB ajouterait une latence systématique sur ce qui est appelé toutes les 30s par les uptime monitors.

**Convention** : si un futur monitoring readiness est requis, créer `/api/ready` séparé (ne pas modifier `/api/health`).

### L-2 — Idempotency keys Stripe conventionnelles

**Pattern observé** : `pi_create_${order.id}`, `refund_${order.id}_admin`, `refund_${order.id}_timeout`, `refund_${order.id}_revival`.

**Convention** : `<context>_${order_uuid}_<discriminator>` (UUID v4 stable + suffix qualifiant le path d'appel). Toute nouvelle clé Stripe DOIT contenir un UUID stable comme racine — pas de timestamp, pas de séquence (ces deux options sont vulnérables à des collisions et n'apportent rien).

À inscrire dans `METHODOLOGY.md` lors d'une passe documentaire ultérieure.

### L-3 — Pas d'Edge Functions Supabase

**Décision architecturale** : tout l'API edge passe par Next.js routes (Vercel). `supabase/functions/` reste vide.

**Rationale** :
- Cohérence du runtime (un seul environnement de logs, 1 seul système de déploiement, 1 seul auth).
- Vercel + Next.js gère déjà toutes les routes API du projet.
- Edge Functions Supabase apporterait une latence DB-locale mais doublerait la complexité ops.

À inscrire dans `METHODOLOGY.md` comme convention « pas d'Edge Functions Supabase ».

### L-4 — Pas de webhook Resend entrant (BACKLOG)

**Constat** : Resend est utilisé en sortie uniquement (`lib/resend/send.ts`). Aucun handler `email.bounced`, `email.complained`, `email.delivery_delayed`. Conséquence : `notifications.statut` reflète uniquement le « accepté par Resend » (200 du POST), pas le statut réel de delivery.

**Statut** : **BACKLOG Phase 8** (observabilité). Pas une faille de sécurité, mais une dette de visibilité côté délivrabilité.

---

## Migrations apply via MCP — version_ids tracker

| Version Supabase  | Nom (DB)                                            | Filename local                                                                  |
|-------------------|-----------------------------------------------------|---------------------------------------------------------------------------------|
| `20260505154054`  | `rpc_lock_search_path_invoker_functions`            | `supabase/migrations/20260505500000_rpc_lock_search_path_invoker_functions.sql` |
| `20260505154131`  | `rpc_generate_order_code_retry_cap`                 | `supabase/migrations/20260505500100_rpc_generate_order_code_retry_cap.sql`      |

Les fichiers locaux utilisent le préfixe sémantique `500xxx` (convention projet : `100xxx` RLS, `200xxx` Auth, `300xxx` Perf, `400xxx` Migrations, `500xxx` RPC). Le mismatch avec le timestamp DB est documenté en en-tête de chaque fichier — pattern déjà en place pour les migrations T-241 et le chantier Migrations.

---

## Trade-offs assumés

1. **`maxDuration = 60`** : cap Vercel Pro. Si le repo migrait en Hobby (10s) ou Enterprise (900s), ce cap devrait être ajusté. Pas de blocker actuel.
2. **Helper `mapWithConcurrency`** : implémenté inline plutôt que d'installer `p-limit` (économise une dep externe pour ~40 lignes de code). Si on a besoin de fonctionnalités plus avancées (cancel, dynamic limit, weighted), on pourra installer `p-limit` ou `bottleneck`.
3. **HTML inline dans les routes stock-alerts** : style Tailwind compact, pas de Server Component. Compromis : duplication mineure du style mais évite d'introduire un Server Component dédié pour une page éphémère sans réutilisation.
4. **`generate_order_code` cap=10** : conservateur. À 1M orders avec collision ~3%, prob de hit le cap = 3%^10 ≈ 6e-15. À 10M (~30% collision/attempt), ~6e-6 = 1 INSERT sur 170k pourrait raise. Acceptable.
5. **Reviews/create check applicatif `consumer_id !== session.id` conservé** : permet un 403 lisible vs 500 RLS si l'user est producer-owner. Coût : 3 lignes redondantes vs RLS (mais defense-in-depth si l'orgue de la RLS reviews change un jour).

---

## Procédure de rollback par lot

### LOT 1 (stock-alerts 2-step)

Revert applicatif uniquement (pas de DB). `git revert` sur les 4 fichiers route + tests. Les tokens existants restent valides — l'effet GET au premier hit redeviendra opérant.

### LOT 2 (5 crons concurrence)

Revert applicatif. Les crons reviennent en boucles séquentielles. Risque latent timeout Vercel sur batch large mais pas de drift d'état.

### LOT 3 (reviews/create)

Revert applicatif. Retour au admin client + check applicatif. La RLS reviews acceptait déjà l'INSERT user client, donc le passage avant→après→avant est sans drift d'état.

### LOT 4 (search_path INVOKER) — DB

```sql
ALTER FUNCTION public.compute_order_commission()  RESET search_path;
ALTER FUNCTION public.enforce_user_exclusive()    RESET search_path;
ALTER FUNCTION public.set_order_code()            RESET search_path;
ALTER FUNCTION public.set_updated_at()            RESET search_path;
ALTER FUNCTION public.slot_rules_set_updated_at() RESET search_path;
ALTER FUNCTION public.generate_order_code()       RESET search_path;
```

### LOT 5 (generate_order_code retry cap) — DB

CREATE OR REPLACE avec le body précédent (`loop ... exit when ... end loop`). Migration de rollback à reconstituer si nécessaire ; le diff est trivial.

---

## Scan de garde final

```sql
SELECT proname, proacl::text FROM pg_proc
WHERE pronamespace='public'::regnamespace
  AND prosecdef=true
  AND (proacl::text ~ '(\{|,)=X/' OR proacl IS NULL);
-- → 0 ligne (cohérent avec post-chantier RLS)
```

Aucune régression introduite.

---

## Leçons apprises

1. **Cohérence ACL CREATE OR REPLACE** : confirmé pour la 2ème fois sur ce projet (après le piège Lot 8 Perf) que `CREATE OR REPLACE FUNCTION` préserve l'ACL existante alors que `DROP + CREATE` la réinitialise à PUBLIC EXECUTE par défaut. Préférer `CREATE OR REPLACE` ou `ALTER FUNCTION` chaque fois que c'est techniquement possible.

2. **Pré-audit programmatique avant fix** : la majorité de cet audit RPC était déjà fermée par les chantiers RLS / Migrations / Perf antérieurs du même jour. Un re-scan SQL au début de session a évité 4-5 fix redondants.

3. **`mapWithConcurrency` avec `Promise.allSettled`** : pattern préférable à `Promise.all` pour les boucles de batch qui ne doivent pas casser sur 1 row foireux. Les crons existants avaient déjà des try/catch internes — le helper retourne `PromiseSettledResult` quand même pour capturer les exceptions inattendues introduites par la parallélisation (racing conditions, etc.).

4. **2-step opt-in/opt-out RGPD** : pattern à standardiser. `lib/(public)/desabonnement` était déjà en place pour producer_interests, et n'avait pas été appliqué à stock-alerts (audit-RPC H-1). Pour toute future route email-driven, vérifier que GET ne fait pas d'effet de bord.
