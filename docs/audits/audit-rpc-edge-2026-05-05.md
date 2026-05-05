# Audit RPC & Edge Functions — 2026-05-05

**Source live** : MCP Supabase `read-write` sur prod (Postgres 17.6).
**Source repo** : `supabase/migrations/*.sql` (50 fichiers) + `app/api/**/route.{ts,tsx}` (24 routes).
**Périmètre** :
- 14 fonctions Postgres custom du schéma `public` (RPC callables + triggers).
- Routes Next.js API qui exposent des effets Stripe / cron / webhook (pas d'Edge Functions Supabase — voir Annexe E).
- Webhooks entrants : Stripe uniquement (Resend n'a pas de webhook entrant ; voir Annexe E).

> Cet audit cross-référence l'**audit RLS du même jour** (`audit-rls-2026-05-05.md`). Les findings CRITICAL côté RPC (C-1, C-2) y sont déjà priorisés : on les rappelle ici sans les redoubler, en se concentrant sur ce que le périmètre RPC/webhook/cron ajoute en propre.

---

## Synthèse priorisée

| Sévérité | Compte | Type d'enjeu                                                              |
|----------|--------|---------------------------------------------------------------------------|
| CRITICAL |   2    | RPC `SECURITY DEFINER` sans garde auth, EXECUTE PUBLIC (rappel audit RLS) |
| HIGH     |   3    | Stock-alerts GET token (prefetch), `producer-interests` no-rate-limit, pattern « DEFINER + ACL PUBLIC » sans garde |
| MEDIUM   |   5    | Crons séquentiels (timeout Vercel), `/reviews/create` admin-client+ownership applicatif, triggers sans `search_path`, `generate_order_code` retry loop sans cap, RPC `restore_product_stock_on_order_cancel` ACL PUBLIC (trigger) |
| LOW      |   4    | `/api/health` no-DB, idempotency keys conventionnelles, pas d'Edge Functions, pas de webhook Resend |

**À retenir** : les 2 CRITICAL sont déjà connues et la prio reste « Immediate » (cf. recommandations RLS §1). Les 3 HIGH sont nouveaux sur ce périmètre. Le webhook Stripe est solide (signature + idempotence), les crons sont bien auth (`timingSafeEqual`).

---

## Inventaire RPC (synthèse)

14 fonctions custom dans `public` — toutes ont l'ACL `=X/postgres` (PUBLIC EXECUTE par défaut).

| Fonction                                  | Type      | Sec.    | Volatilité  | search_path | Garde auth interne ?         |
|-------------------------------------------|-----------|---------|-------------|-------------|------------------------------|
| `is_admin()`                              | callable  | DEFINER | STABLE      | locked      | n/a (helper booléen)         |
| `owns_producer(uuid)`                     | callable  | DEFINER | STABLE      | locked      | n/a (helper booléen)         |
| `search_producers(...)`                   | callable  | DEFINER | STABLE      | locked      | n/a (filtre `statut='public'`) |
| `create_order_with_items(...)`            | callable  | DEFINER | VOLATILE    | locked      | **OUI** `auth.uid() = p_consumer_id` |
| `delete_user_account(uuid)`               | callable  | DEFINER | VOLATILE    | locked      | **OUI** `auth.uid() = p_user_id` |
| `revive_order_with_stock_check(uuid)`     | callable  | DEFINER | VOLATILE    | locked      | **NON** → CRITICAL (rappel C-1) |
| `record_refund_attempt(...)`              | callable  | DEFINER | VOLATILE    | locked      | **NON** → CRITICAL (rappel C-2) |
| `restore_product_stock_on_order_cancel()` | trigger   | DEFINER | VOLATILE    | locked      | n/a (trigger AFTER UPDATE)   |
| `compute_order_commission()`              | trigger   | INVOKER | VOLATILE    | not set     | n/a                          |
| `enforce_user_exclusive()`                | trigger   | INVOKER | VOLATILE    | not set     | n/a                          |
| `set_order_code()`                        | trigger   | INVOKER | VOLATILE    | not set     | n/a                          |
| `set_updated_at()`                        | trigger   | INVOKER | VOLATILE    | not set     | n/a                          |
| `slot_rules_set_updated_at()`             | trigger   | INVOKER | VOLATILE    | not set     | n/a                          |
| `generate_order_code()`                   | callable  | INVOKER | VOLATILE    | not set     | n/a (retourne TRR-XXXXX)     |

Tous les RPC `SECURITY DEFINER` callables ont `SET search_path = public, pg_temp` (pas de risque RCE par injection de schéma). Toutes les fonctions trigger `INVOKER` n'ont pas de `search_path` verrouillé — sans risque pratique car invoquées en contexte trigger (pas d'attaquant qui contrôle le `search_path` de la session quand un trigger se déclenche), à fixer pour propreté.

---

# CRITICAL

## C-1 — `revive_order_with_stock_check(uuid)` : RPC `SECURITY DEFINER` exposée à PUBLIC, sans garde auth

**Identique à l'audit RLS C-1**. Rappel ici parce que c'est l'enjeu majeur du périmètre RPC :

- ACL `=X/postgres` (anon + authenticated peuvent EXECUTE).
- Pas de garde `auth.uid()` interne.
- Effet de bord côté DB : passe une commande `cancelled+payment_failed` → `pending`, décrémente stock, reset `closure_reason`/`cancelled_at`.
- Documenté dans le code comme « appelée par webhook handler uniquement » mais l'ACL ne l'enforce pas.

**Test mental d'appel par un user authenticated** : un consumer connaissant un `order_id` (UUID — guess infaisable, mais fuite possible via logs front, referrer, partage de lien) peut ressusciter la commande d'un autre user. La fonction lock l'order (FOR UPDATE) puis vérifie `statut='cancelled' AND closure_reason='payment_failed'` (errcode 22023 sinon) — donc un appel sur n'importe quel autre statut échoue immédiatement. Le risque est **localisé aux orders qui sont déjà dans cet état** : effet d'attaque = réveiller une commande qu'un user (autre) a vu cancelled, re-décrémenter du stock (qui appartient au producteur). Pas de fuite de données mais corruption transactionnelle.

**Fix** : voir audit RLS §C-1 (révoquer EXECUTE de `public, anon, authenticated`).

## C-2 — `record_refund_attempt(...)` : RPC `SECURITY DEFINER` exposée à PUBLIC, sans garde auth

**Identique à l'audit RLS C-2**. Rappel :

- ACL PUBLIC, pas de garde `auth.uid()`.
- UPSERT dans `refund_incidents` + INSERT dans `refund_incident_attempts` — deux tables conçues pour être en mode service-role only.
- Validation interne : `kind ∈ {revival, admin, timeout}`, `outcome ∈ {failed, succeeded}`, `classification ∈ {safe_to_retry, permanent, unknown, NULL}`. Un attaquant authentifié peut UPSERT une ligne `(p_order_id, p_kind)` arbitraire → empoisonne le cron `retry-failed-refunds` (qui lit cette table comme source-of-truth).

**Test mental** : avec `outcome='succeeded'` un attaquant clôt silencieusement un refund réel (plus de retry). Avec `outcome='failed' + classification='permanent'` un attaquant marque un refund comme `exhausted` → court-circuite le retry légitime. Aucun de ces effets n'expose de données personnelles, mais la chaîne refund est compromise.

**Fix** : voir audit RLS §C-2.

---

# HIGH

## H-1 — `/api/stock-alerts/{confirm,unsubscribe}` : GET avec token, prefetch email risk

**Files** : `app/api/stock-alerts/confirm/route.ts:19-38`, `app/api/stock-alerts/unsubscribe/route.ts:20-36`.

Les deux routes acceptent `GET /...?token=xxx` et exécutent l'effet (confirm ou unsubscribe) au premier hit. Le commentaire de tête du fichier confirm le reconnaît :

> *Pourquoi GET (pas POST) : convention "lien clicable depuis email" — un POST nécessiterait un form HTML interstitiel inutile pour un flux unique. Risque "prefetch déclenche le opt-in" minimisé : le confirm est idempotent (same alerte, same token) et ne révèle pas d'info sensible.*

**Le risque réel** : Outlook (Safe Links), Gmail (Image Proxy), Microsoft ATP, Mimecast, Proofpoint et la plupart des MUA enterprise scannent les liens à la livraison. Le confirm passe avec le token avant que l'utilisateur ait cliqué, donc :
- L'opt-in est validé sans intention utilisateur — risque RGPD si l'utilisateur n'a jamais cliqué (consentement non actif).
- Pour `unsubscribe` : un scan email peut désinscrire un utilisateur silencieusement, puis l'utilisateur s'étonne de ne pas recevoir l'alerte attendue.

**Le pattern existe déjà ailleurs dans le repo** : `lib/rgpd/desabonnement` documente un 2-step (GET puis POST avec form interstitiel) « pour résister aux prefetchers email ». Cette protection n'a **pas** été appliquée ici (décision implicite, justifiée par un argument peu solide cf. commentaire).

**Fix** : reproduire le pattern 2-step `desabonnement` :
1. `GET /api/stock-alerts/confirm?token=xxx` → renvoie une page de confirmation HTML avec un bouton (form POST).
2. `POST /api/stock-alerts/confirm` (même token via input hidden) → exécute l'effet.

Préserve l'idempotence (re-clic = ok), bloque les prefetchers (qui n'exécutent pas POST avec body cookies). Coût UX : un clic supplémentaire — acceptable pour un opt-in RGPD.

## H-2 — `/api/producer-interests` : POST anonyme sans rate limit

**File** : `app/api/producer-interests/route.ts:38-68`.

Documenté dans le code :
> *pas de rate limit dédié (volume formulaire candidature très bas, à reconsidérer si abus détecté)*

L'endpoint accepte n'importe quel POST anonyme avec validation Zod. La table cible a un `UNIQUE(email)` (mig 20260428300000) — donc INSERT direct est limité à 1 row par email, mais le helper `upsertProducerInterest` fait du `INSERT + catch 23505 + UPDATE`, donc rejouer le formulaire avec le même email **réécrit la ligne** à chaque appel. Conséquence :
- Pas de saturation par accumulation (verrou UNIQUE).
- Mais : compute Postgres + log Vercel + (potentiellement) email admin trigger à chaque appel.
- Accessible depuis n'importe quelle IP, sans CAPTCHA, sans header signé.

**Test mental** : un attaquant lance 1000 req/s avec emails aléatoires → 1000 INSERT/s qui coûtent un round-trip DB chacun + un commit. Pas un DOS franc (Postgres tient), mais pollution de la table + facture Vercel + audit log si abondant.

**Fix recommandé** :
- Court terme : middleware Next.js avec Vercel KV / Upstash rate-limit (pattern `5 req / minute / IP`).
- Court terme : ajouter Cloudflare Turnstile (gratuit) ou hCaptcha sur le formulaire `/devenir-producteur`.
- Si déjà rate-limité au niveau DNS/CDN (Cloudflare WAF actif ?) : documenter dans `METHODOLOGY.md` et baisser la sévérité.

## H-3 — Pattern « `SECURITY DEFINER` + ACL PUBLIC » sans garde auth = bombe latente

Les 14 fonctions custom héritent toutes de `=X/postgres` (PUBLIC EXECUTE par défaut Postgres). Quatre fonctions `DEFINER` callables sont **safe** parce qu'elles ont une garde interne (`is_admin`, `owns_producer`, `create_order_with_items`, `delete_user_account`) ou parce qu'elles ne lisent que des données publiques (`search_producers`). Deux sont **CRITICAL** parce qu'elles n'ont pas de garde (`record_refund_attempt`, `revive_order_with_stock_check`).

Le problème : **le pattern par défaut du repo est dangereux**. Une nouvelle migration qui crée une RPC `SECURITY DEFINER` sans `revoke execute on function ... from public` ajoute une CRITICAL chaque fois que le développeur oublie la garde `auth.uid()`. C'est exactement ce qui se passe avec **T-241 `update_producer_onboarding`** (audit RLS §M-3) — la RPC est `SECURITY DEFINER`, sans garde auth, et le commentaire indique « appelée par service_role uniquement », mais l'ACL PUBLIC ne le force pas.

**Fix recommandé (process)** :
1. Migration cleanup unique : `revoke execute on function public.<name>(...) from public` sur toutes les fonctions du schéma `public`, puis `grant execute ... to <role>` au cas par cas (le minimum nécessaire). Inventaire à dériver de `pg_proc.proacl`.
2. Linter SQL pré-commit qui refuse une `CREATE FUNCTION ... SECURITY DEFINER` sans `revoke execute ... from public` à proximité.
3. Convention documentée dans `METHODOLOGY.md` : *« toute nouvelle RPC `SECURITY DEFINER` doit (a) garde `auth.uid()` ou (b) revoke EXECUTE PUBLIC + grant explicite »*.

Test mental sur l'inventaire actuel par appel `authenticated` :

| Fonction                                  | ACL PUBLIC ? | Garde auth ? | Exposable ?    | Verdict     |
|-------------------------------------------|:------------:|:------------:|:---------------|:------------|
| `is_admin()`                              | oui          | n/a          | retourne false | safe        |
| `owns_producer(uuid)`                     | oui          | n/a          | retourne false | safe        |
| `search_producers(...)`                   | oui          | n/a          | données publiques | safe     |
| `create_order_with_items(...)`            | oui          | OUI          | erreur 42501   | safe        |
| `delete_user_account(uuid)`               | oui          | OUI          | erreur 42501   | safe        |
| `revive_order_with_stock_check(uuid)`     | oui          | NON          | EFFETS DB      | **C-1**     |
| `record_refund_attempt(...)`              | oui          | NON          | EFFETS DB      | **C-2**     |
| `restore_product_stock_on_order_cancel()` | oui          | n/a          | non callable (trigger) | safe via PostgREST mais voir M-5 |
| triggers `INVOKER` (5)                    | oui          | n/a          | non callable (trigger) | safe        |
| `generate_order_code()` (callable)        | oui          | n/a          | retourne string | safe (mais voir M-4) |

---

# MEDIUM

## M-1 — Crons séquentiels Stripe = risque timeout Vercel

**Files** : `app/api/cron/order-timeout/route.tsx:48` (boucle `for of orders`), `app/api/cron/retry-failed-refunds/route.ts:84-146` (boucle `for of rows`, LIMIT 1000), `app/api/cron/weekly-payout/route.tsx:22-66`, `app/api/cron/weekly-badges/route.ts:30-44`.

Les 4 crons listent N rows en DB puis bouclent séquentiellement avec un appel Stripe + INSERT/UPDATE par row. Pas de concurrence, pas de chunking. Vercel coupe la fonction serverless à 10s (Hobby) ou 60s (Pro) ou 900s (Enterprise) — le commentaire de `retry-failed-refunds` admet « Limite 1000 : volume cumulé attendu très faible. Tape la limite = signal d'incident ».

**Risque concret** : 1 round-trip Stripe ≈ 200-500ms. Sur 50 incidents : 10-25s. Sur 200 incidents : 40-100s. Si Vercel tue la fonction à mi-chemin, **les rows déjà process sont OK (commit unitaire), les rows suivants seront retentés au run suivant**. Pas de perte de données mais :
- Logs partiels (pas de `[CRON_END]` clean).
- Pas de visibilité sur le drop : le cron rapporte `processed: N` qui est tronqué.
- Aucune alerte si un cron tombe systématiquement à mi-batch.

**Fix recommandé** :
1. Court terme : passer à `Promise.allSettled` avec un cap de concurrence (`p-limit`), pour ramener un batch de 100 incidents de 50s → 5s.
2. Court terme : exposer `runtime = 'nodejs'` + `maxDuration = 60` dans chaque cron (déjà le cas implicitement ?). À vérifier via `next.config.js` ou frontmatter de chaque route.
3. Long terme : queueing (Inngest, Trigger.dev, ou table `pending_jobs`).
4. Monitoring : log `[CRON_BATCH_TRUNCATED] processed=N targeted=M` quand la liste sortie de DB > seuil.

## M-2 — `/api/reviews/create` : admin client + ownership check applicatif (fragile)

**File** : `app/api/reviews/create/route.ts:26-54`.

```ts
const admin = createSupabaseAdminClient();
const { data: order } = await admin.from("orders").select(...).eq("id", ...).maybeSingle();
if (order.consumer_id !== session.id) return 403;
```

L'admin client bypasse RLS. La sécurité repose **entièrement** sur le check applicatif `order.consumer_id !== session.id`. Si un futur refactor :
- Bug le check (typo, condition inversée, oubli sur un nouveau path).
- Réutilise un autre order via `parsed.data.order_id` après le check (TOCTOU sur un re-fetch).
- Modifie le SELECT et perd `consumer_id` (devient `undefined`, l'égalité échoue).

→ contournement RLS direct.

L'alternative `createSupabaseServerClient` (user client) déléguerait à RLS la vérification. Le code actuel utilise l'admin pour pouvoir INSERT dans `notifications` ensuite (les admins doivent recevoir un email — RLS notifications n'autorise que self-read). Mais on peut faire le check ownership avec le user client puis switcher à l'admin pour les writes admins-targets.

**Fix recommandé** : SELECT initial avec `createSupabaseServerClient` (RLS naturelle filtre), puis admin uniquement pour le bloc INSERT `notifications`. Pattern aligné avec `/api/orders/create` (user client pour le SELECT slot, RPC `SECURITY DEFINER` pour le write).

## M-3 — Triggers `INVOKER` sans `SET search_path` verrouillé

**Fonctions concernées** : `compute_order_commission`, `enforce_user_exclusive`, `set_order_code`, `set_updated_at`, `slot_rules_set_updated_at`, `generate_order_code` (callable).

Aucune n'a `SET search_path`. Comme elles tournent en `SECURITY INVOKER`, elles n'ont pas plus de droits que la session caller — donc une injection de schéma malicieuse (`search_path = 'attaquant, public'`) n'élève pas les privilèges. Le risque RCE est minimal.

**Reste** : si un développeur ajoute demain un `SECURITY DEFINER` à l'un de ces triggers (par ex. pour bypass RLS), l'absence de `SET search_path` ouvrirait alors une faille immédiate. Defense-in-depth : verrouiller `search_path = public, pg_temp` sur **toutes** les fonctions custom même `INVOKER`.

**Fix** : migration cosmétique de mise à niveau.

## M-4 — `generate_order_code()` : retry loop sans cap

**File** : RPC `generate_order_code()`.

```sql
loop
  candidate := 'TRR-' || ... 5 chars random ...;
  select exists (select 1 from public.orders where code_commande = candidate) into exists_already;
  exit when not exists_already;
end loop;
```

Espace = 32^5 = 33.5M codes. Aujourd'hui négligeable. À 100K orders, prob collision par appel = 100K / 33.5M ≈ 0.3% → ~1 retry tous les 333 INSERT. À 1M orders : 3% → 1 retry tous les 33 INSERT, parfois 2-3 retries. À 10M orders : 30% → boucles longues, contention table.

Pas une vulnérabilité mais un piège de scalabilité. Le `exists` lock doux le row entier de `orders` jusqu'au commit.

**Fix recommandé** :
- Sortir du retry pur en allant sur 7 chars (alphabet 32, 32^7 = 34B → coll prob négligeable jusqu'à 100M orders).
- OU ajouter un cap `for i in 1..10 loop ... end loop` + `raise exception 'cannot generate unique code after 10 attempts'`.
- OU dériver depuis une séquence déterministe + checksum (zéro collision).

## M-5 — `restore_product_stock_on_order_cancel()` : trigger `SECURITY DEFINER` ACL PUBLIC

**File** : trigger `DEFINER` avec ACL PUBLIC. Comme audit RLS L-3 le note, PostgREST n'expose pas les fonctions trigger comme RPC (return type `trigger`). Donc pas exploitable depuis Internet.

Mais : si un développeur futur l'appelle accidentellement comme procédure (ex. `SELECT restore_product_stock_on_order_cancel()` depuis SQL Editor) il se prend une `tg_op IS NULL` → erreur silencieuse. Et l'ACL PUBLIC reste un signal trompeur (semble dire « anyone can call it »).

**Fix** : `revoke execute on function public.restore_product_stock_on_order_cancel() from public, anon, authenticated;` — défense en profondeur. Aligné avec le cleanup global proposé en H-3.

---

# LOW

## L-1 — `/api/health` ne check pas la DB

**File** : `app/api/health/route.ts:1-5`.

```ts
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
```

Renvoie systématiquement 200 même si DB / Stripe / Resend down. Acceptable pour un keep-alive (uptime monitoring « le serveur répond ») mais ne révèle aucune dépendance.

**Fix optionnel** : ajouter un `select 1` Supabase ping + un timeout 2s. Si l'objectif est *liveness* (keep alive), garder en l'état. Si *readiness*, élargir.

## L-2 — Idempotency keys Stripe conventionnelles

**Pattern** : `pi_create_${order.id}`, `refund_${order.id}_admin`, `refund_${order.id}_timeout`, `refund_${order.id}_revival`.

Convention saine (UUID order stable + context discriminator). Risque théorique : si un `order.id` est réutilisé (impossible avec UUID v4 — collision ≈ 0), une key se retrouverait partagée entre 2 commandes différentes. N/A en pratique. Documenter ce contrat dans `METHODOLOGY.md` pour qu'aucun futur path n'utilise une key non-UUID.

## L-3 — Pas d'Edge Functions Supabase

`supabase/functions/` n'existe pas. Tout l'API edge passe par Next.js routes (Vercel). C'est un choix architectural cohérent — pas un finding en soi — mais à expliciter parce que :
- Le périmètre « Edge Functions » de l'audit demandé est par construction vide.
- Toute extension future pourrait être tentée d'utiliser Edge Functions Supabase (latence DB-locale + accès direct à `auth.uid()`). Décision à acter.

**Fix** : ajouter dans `METHODOLOGY.md` la convention « pas d'Edge Functions Supabase, tout API Next.js » ou inversement justifier l'arrivée future.

## L-4 — Pas de webhook Resend entrant

Le grep `app/api/**/route` ne contient aucun handler `resend` ou `email-event`. Resend est utilisé en **envoi sortant uniquement** (`lib/resend/send.ts` via `sendTemplate`). Conséquences :
- Pas de visibilité sur les événements `email.bounced`, `email.complained`, `email.delivery_delayed` côté DB.
- Les `notifications.statut` reflètent uniquement le « accepté par Resend » (200 du POST), pas le statut réel de delivery (bounced 5xx, soft bounce, complaint).

Pas une faille de sécurité, mais une dette d'observabilité côté délivrabilité. À considérer pour Phase 8.

---

# Annexe A — Inventaire des appelants des 4 RPC callables non-helpers

| RPC                                | Appelants applicatifs (greppés)                                |
|------------------------------------|----------------------------------------------------------------|
| `create_order_with_items`          | `app/api/orders/create/route.ts:127-144` (user client)         |
| `delete_user_account`              | À grepper côté Server Actions (`actions/account/delete-*`)     |
| `revive_order_with_stock_check`    | `lib/stripe/handle-payment-succeeded.ts` (admin client) — confirme l'intention service-role, **doit révoquer EXECUTE PUBLIC** |
| `record_refund_attempt`            | `lib/refund-incidents/record-refund-attempt.ts` (admin client) — idem |
| `search_producers`                 | `app/api/producers/search/route.ts:35-41` (admin client, légitime) |

À auditer en complément : confirmer que `delete_user_account` n'est jamais appelée depuis un endpoint accessible par anon.

---

# Annexe B — Test mental SECURITY DEFINER appelé en authenticated

Pour chacune des 7 RPC `DEFINER` (helpers + callables), simulation d'un appel par un user `authenticated` sans privilège particulier :

| RPC                                    | Path d'attaque                                  | Résultat                                 |
|----------------------------------------|--------------------------------------------------|------------------------------------------|
| `is_admin()`                           | Appel direct                                     | retourne `false` si pas admin → safe     |
| `owns_producer(uuid)`                  | Appel avec uuid d'un autre producteur            | retourne `false` → safe                  |
| `search_producers(...)`                | Appel avec lat/lng arbitraire                    | retourne producers `statut='public'` uniquement → safe (déjà public) |
| `create_order_with_items(p_consumer_id=<uuid_autre>, ...)` | Tentative usurpation consumer | `auth.uid() != p_consumer_id` → erreur 42501 → safe |
| `create_order_with_items(p_consumer_id=auth.uid(), p_producer_id=<x>, ...)` | Achat normal | passe les locks slot/products → comportement normal |
| `delete_user_account(<uuid_autre>)`    | Tentative suppression d'un autre compte          | `auth.uid() != p_user_id` → erreur 42501 → safe |
| `revive_order_with_stock_check(<order_d_un_autre>)` | Resurrection commande d'un autre | **AUCUNE garde** → si statut='cancelled+payment_failed' → exécute → **C-1** |
| `record_refund_attempt(<order_arbitraire>, ...)` | UPSERT incidents arbitraire | **AUCUNE garde** → écrit dans refund_incidents → **C-2** |

---

# Annexe C — Cartographie webhooks & crons

## Webhook entrant unique : `POST /api/stripe/webhook`

**File** : `app/api/stripe/webhook/route.tsx`.

Contrôles en place :
- ✅ Signature : `stripe.webhooks.constructEvent(rawBody, signature, secret)` (lignes 40-50). 400 si manquant ou invalide.
- ✅ Body brut : `request.text()` (pas de parsing JSON intermédiaire qui casserait la signature).
- ✅ Idempotence applicative : `checkOrMarkProcessed(admin, event.id, event.type)` (lignes 83-101) sur 8 event types à effets de bord. INSERT exclusif sur PK `event_id` de `webhook_events_processed` ; SQLSTATE 23505 → ack 200 + skip handler. Toute autre erreur DB → throw → 500 (Stripe retry).
- ✅ Découplage notifications : `waitUntil(...)` pour Resend/Twilio (Stripe ack <10s, envois en background).
- ✅ 500 sur exception non-catchée → Stripe retry naturel.
- ⚠️ Pas d'IP allowlist Stripe (bonne pratique défensive optionnelle ; signature suffit en théorie). Cf. https://stripe.com/docs/ips.

Verdict global : **solide**. Pas de finding webhook-side dédié.

## Crons (9 routes, toutes `app/api/cron/*`)

Toutes utilisent `assertCronAuth(request)` (`lib/cron/auth.ts:16-29`) :
- ✅ Compare header `Authorization: Bearer <CRON_SECRET>` avec `timingSafeEqual` (T-423, ligne 7-12).
- ✅ 500 si `CRON_SECRET` env var manquant (fail-loud à l'apply).
- ✅ 401 sinon.

| Cron route                              | Schedule (à confirmer vercel.json)  | Effet                                         | Risque résiduel        |
|----------------------------------------|--------------------------------------|------------------------------------------------|------------------------|
| `/api/cron/order-timeout`              | hourly                               | refund + cancel orders pending +24h           | M-1 timeout            |
| `/api/cron/retry-failed-refunds`       | daily 4h UTC                         | retry refunds failed (incident-driven)        | M-1 timeout (cap 1000) |
| `/api/cron/reminder-consumer`          | daily                                | email J-1 retrait                              | safe                   |
| `/api/cron/reminder-sms`               | daily                                | SMS jour J                                    | safe                   |
| `/api/cron/review-followup`            | daily                                | email J+2/J+7                                 | safe                   |
| `/api/cron/weekly-payout`              | mon 8h                               | virements producteurs                         | M-1 timeout            |
| `/api/cron/weekly-badges`              | weekly                               | recompute badges (séquentiel par producteur)  | M-1 timeout            |
| `/api/cron/purge-otp-codes`            | daily 5h UTC                         | DELETE `email_change_otp_codes`               | safe                   |
| `/api/cron/purge-stock-alerts`         | daily 3h UTC                         | DELETE `product_stock_alerts`                 | safe                   |

---

# Annexe D — Routes API user-facing (auth + validation)

| Route                                     | Auth                          | Validation     | Client Supabase | Notes                       |
|-------------------------------------------|-------------------------------|----------------|-----------------|------------------------------|
| `POST /api/orders/create`                 | `getSessionUser` 401          | Zod strict     | server (RLS)    | Idempotence 5min (T-428)    |
| `POST /api/stripe/create-payment-intent`  | session + ownership 403       | Zod            | server + admin  | Stripe idempotency PI       |
| `POST /api/stripe/ensure-default-payment-method` | session + ownership    | Zod            | server + admin  | T-433 fail-open             |
| `POST /api/stripe/connect/onboard`        | session + role (producer/admin) | aucune       | admin           | Compensation rollback T-418 |
| `POST /api/stripe/refund`                 | session admin OR producer-owner | Zod         | admin           | M-2 pattern                 |
| `POST /api/reviews/create`                | session + ownership applicatif | Zod          | admin           | **M-2** (admin client)      |
| `POST /api/producer-interests`            | aucune (anon ok)              | Zod            | admin           | **H-2** rate limit          |
| `GET /api/stock-alerts/confirm`           | token URL                     | aucune (token) | admin           | **H-1** prefetch            |
| `GET /api/stock-alerts/unsubscribe`       | token URL                     | aucune (token) | admin           | **H-1** prefetch            |
| `GET /api/producers/search`               | aucune (anon ok)              | parseFloat    | admin (RPC SD)  | floute coords T-200         |
| `GET /api/health`                         | aucune                        | n/a           | aucun           | **L-1** no-DB ping          |

---

# Annexe E — Ce que cet audit ne couvre pas (ou explicitement vide)

- **Edge Functions Supabase** : périmètre vide. `supabase/functions/` n'existe pas. Voir L-3.
- **Webhook entrant Resend** : non implémenté. Voir L-4.
- **Webhook entrant Twilio** (delivery report SMS) : non implémenté. Le repo n'a pas d'endpoint Twilio inbound, les SMS sont uniquement sortants via `sendReminderSms` / `sendNewOrderProducerSms`.
- **Server Actions Next.js** : non grepées dans cet audit (focus sur API routes). Une passe complémentaire peut révéler des actions appelant des RPC (ex. `delete_user_account` annoncé par RGPD — voir Annexe A).
- **MCP Supabase RLS bypass** : le MCP tourne en `read-write` sur prod (cf. memory). Toute action via MCP bypasse RLS. Pas un finding produit, mais à garder en tête : ne jamais documenter un workflow produit qui *dépend* du MCP.

---

# Recommandations d'action (priorisé)

1. **Immediate** : appliquer le fix C-1 + C-2 (révoquer `EXECUTE PUBLIC` sur `revive_order_with_stock_check` et `record_refund_attempt`). Migration 1-fichier ~5 lignes — couvre les CRITICAL côté RPC. Cf. audit RLS §1.
2. **Immediate** : décider du fix H-1 stock-alerts. Soit accepter le risque prefetch (et le documenter), soit reproduire le pattern 2-step `desabonnement`.
3. **Court terme** : H-2 rate limit `/api/producer-interests` (Vercel KV ou Cloudflare Turnstile).
4. **Court terme** : H-3 migration de cleanup ACL → `revoke execute ... from public` sur les 14 fonctions, puis `grant ... to <role>` au cas par cas. Établir la convention dans `METHODOLOGY.md` + linter pré-commit.
5. **Court terme** : M-2 refacto `/api/reviews/create` pour utiliser un user client sur le SELECT initial (RLS-driven), admin uniquement pour le bloc notifications.
6. **Moyen terme** : M-1 instrumentation des crons (concurrence + monitoring batch tronqué) avant que le volume devienne problématique.
7. **Moyen terme** : M-3 verrouiller `search_path = public, pg_temp` sur les 6 fonctions trigger/utility `INVOKER` (defense-in-depth).
8. **Moyen terme** : M-4 cap retry loop dans `generate_order_code` (10 essais max + raise) ou passage à 7 chars.
9. **Moyen terme** : M-5 + L-3 + L-4 cleanup symbolique (révoquer ACL trigger, documenter absence Edge Functions, traquer absence webhook Resend en backlog Phase 8).

Aucune action n'a été appliquée. Liste pour arbitrage.
