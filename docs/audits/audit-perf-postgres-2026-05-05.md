# Audit Perf Postgres — 2026-05-05

**Source live** : MCP Supabase `read-write` sur prod (Postgres 17.6, projet `exsxharjqqpohkbznhss`).
**Source repo** : `supabase/migrations/*.sql` (50 fichiers), code Next.js (`app/`, `lib/`).
**Périmètre** : flux commande/panier/créneaux, requêtes admin, listings producteurs/produits côté `www`, indexes, RLS perf, planning stats, pooling.
**Méthode** : taxonomie 8 catégories de `supabase-postgres-best-practices` (query / conn / security / schema / lock / data / monitor / advanced). Lecture seule, pas d'`EXPLAIN ANALYZE` joué.

---

## Synthèse priorisée

| Sévérité | Compte | Type d'enjeu                                                                  |
|----------|--------|-------------------------------------------------------------------------------|
| CRITICAL |   4    | RLS `auth.uid()` non-wrappé · indexes doublons exacts · N+1 cron · RPC search |
| HIGH     |   4    | Dashboard 11 queries séquentielles · indexes composites manquants · sub-EXISTS RLS · pas d'`idle_in_transaction_timeout` |
| MEDIUM   |   4    | FK non indexées · listings sans pagination · stats périmées · indexes inutilisés |
| LOW      |   5    | `track_io_timing=off` · pas de slow query log · pas d'extension `pg_trgm` · cosmétique |

**Volumétrie courante (à connaître pour pondérer)** : `slots` 981 rows (seule table > 100), `orders` 17, `products` 16, `producers` 10, `users` 11, `audit_logs` 96, `notifications` 53. Le DB pèse ~2 MB total. **À ce stade, aucune query ne timeout en prod.** Tous les findings ci-dessous sont des dettes qui basculent en problème dès qu'un compteur dépasse ~10 K rows, et il vaut mieux les corriger pendant que c'est encore une tranche de migration légère.

---

# CRITICAL

## C-1 — `auth.uid()` non-wrappé dans **toutes** les RLS policies (perf, pas sécurité)

**Pattern** : 14 policies sur 9 tables utilisent directement `auth.uid()` au lieu de `(select auth.uid())`. Documenté Supabase comme l'optimisation #1 (`security-rls-performance.md`).

```
admin_users self read           : id = auth.uid()
notifications owner read        : auth.uid() = user_id
orders consumer insert          : auth.uid() = consumer_id
orders parties read / update    : (auth.uid() = consumer_id) OR owns_producer(producer_id)
producers owner read/insert/update : auth.uid() = user_id
reviews author read/update      : auth.uid() = consumer_id
reviews consumer insert         : (auth.uid() = consumer_id) AND EXISTS(...)
users self read/insert/update   : auth.uid() = id
```

**Pourquoi** : `auth.uid()` est `STABLE` mais Postgres ne hisse pas l'expression hors-row sans le wrap explicite. Sans `(select ...)`, la fonction est ré-évaluée pour chaque row scannée par la policy. Avec wrap, le planner produit un `InitPlan` exécuté **une fois** et réutilise le résultat (≈ équivalent constant).

**Impact quantifié** :
- Tables actuelles : ~negligible (981 slots × ~50ns = 50µs perdus).
- Projection à 100 K orders pour un consumer : ~5 ms gaspillés par `SELECT * FROM orders WHERE auth.uid() = consumer_id` × N requêtes/jour. **Mesures Supabase publiées : 10× à 100× sur tables 100 K+ rows.**
- Effet composé sur les sub-SELECT (`order_items via order` réplique le pattern via `EXISTS (... auth.uid() = o.consumer_id ...)`).

**Fix** : remplacer mécaniquement dans toutes les policies (`auth.uid()` → `(select auth.uid())`). Côté `is_admin()` / `owns_producer()` : déjà des fonctions SECURITY DEFINER, OK telles quelles.

**Pas de risque sémantique** : `STABLE SECURITY DEFINER` garantit l'idempotence dans une transaction.

---

## C-2 — Indexes redondants exacts (4 paires) — gaspille writes + RAM

Quatre paires d'indexes couvrent la même clé avec une variante sur la contrainte unique. Postgres écrit dans **tous** les indexes à chaque INSERT/UPDATE de la colonne indexée.

| Table | Index redondant | Index canonique conservé | Taille gaspillée |
|-------|-----------------|--------------------------|------------------|
| `slots` | `slots_producer_starts_at_idx` (btree non-unique, 80 kB, 97 scans) | `slots_producer_starts_at_unique` (UNIQUE, 80 kB, 6820 scans) | 80 kB |
| `producer_invitations` | `producer_invitations_token_idx` (btree, 16 kB, 31 scans) | `producer_invitations_token_key` (UNIQUE, 16 kB, 0 scans) | 16 kB |
| `disputes` | `disputes_stripe_dispute_id_idx` (btree) | `disputes_stripe_dispute_id_key` (UNIQUE) | 8 kB |
| `refund_incidents` | `refund_incidents_order_id_idx` (btree sur `order_id`) | `refund_incidents_order_id_kind_key` (UNIQUE sur `(order_id, kind)`) — préfixe couvre lookups par `order_id` | 16 kB |

**Pourquoi un doublon est strictement néfaste** : `INSERT INTO slots (...)` → 4 indexes maintenus au lieu de 3 = ~25% de write-amplification sur cette table. Sur l'`upsert` batch slot generation (lib/slots/generate.ts:147) qui peut écrire 200+ rows à chaque exécution, c'est mesurable.

**Cas particulier `slots`** : c'est l'index UNIQUE qui sert au `onConflict: 'producer_id,starts_at'` du upsert (6820 scans). Le btree non-unique est mort (97 scans, probablement collateral damage du planner sur quelques queries). À DROP en priorité — table la plus écrite (981 rows + cron de matérialisation).

**Cas `producer_invitations_token_idx`** : ironique, c'est le btree non-unique qui prend les scans (31), pas le UNIQUE (0). Postgres choisit l'index le moins coûteux à scanner — mais les deux pointent sur exactement les mêmes clés. À unifier sur le UNIQUE (DROP du non-unique).

**Impact quantifié** : 120 kB de RAM/disque + ~25% de write-cost sur 4 tables. **Pas de gain de read** (le canonique seul sert).

**Fix** :
```sql
DROP INDEX public.slots_producer_starts_at_idx;
DROP INDEX public.producer_invitations_token_idx;
DROP INDEX public.disputes_stripe_dispute_id_idx;
DROP INDEX public.refund_incidents_order_id_idx;
```

À exécuter en heures creuses (les 3 derniers sont sans risque, le `slots` doit être validé qu'aucune query ne s'appuie spécifiquement sur le non-unique — improbable mais vérifier).

---

## C-3 — N+1 dans crons `order-timeout` et `reminder-consumer`

**Fichier** : `app/api/cron/order-timeout/route.tsx:195-204` et `app/api/cron/reminder-consumer/route.tsx:41-50`.

Pour chaque order de la boucle :
```ts
for (const order of orders) {
  // ... Stripe I/O ...
  const { data: producer } = await admin.from('producers').select('nom_exploitation').eq('id', order.producer_id).maybeSingle();
  const { data: consumer } = await admin.from('users').select('email').eq('id', order.consumer_id).maybeSingle();
  // ... sendTemplate ...
}
```

= **1 + 2N queries DB** au lieu de 1 (jointures embedées au SELECT initial).

**Impact quantifié** :
- 100 orders en timeout sur un cron run = 200 round-trips DB inutiles, ~6 secondes de latence cumulée à 30 ms/RT.
- À 1 000 orders/jour, ça déborde le `statement_timeout` du cron (souvent 30-60s sur Vercel) → **cron qui timeout silencieusement et laisse des orders en limbo**. Risque P0 dès que la volumétrie monte.

**Fix** (exemple `order-timeout`) :
```ts
const { data: orders } = await admin.from('orders')
  .select(`
    id, code_commande, consumer_id, producer_id, montant_total, stripe_payment_intent_id,
    producer:producer_id ( nom_exploitation ),
    consumer:consumer_id ( email )
  `)
  .eq('statut', 'pending')
  .lt('created_at', cutoff);
// Plus de SELECT dans la boucle.
```

PostgREST batch les jointures via un seul SQL avec sub-array — gain mesurable dès N=10.

**Bonus** : la requête initiale du cron `reminder-consumer` filtre `WHERE statut='confirmed' AND date_retrait=$1` sans index composite. À 10 K orders/an, l'index simple `orders_statut_idx` (haute selectivity) suffit aujourd'hui ; à 1 M, il faut un index `(date_retrait, statut)` ou `(statut, date_retrait)`.

---

## C-4 — RPC `search_producers` : haversine ×2 + sous-SELECT count par row

**Fichier** : migration `20260421000000_search_producers_product_count.sql` (signature canonique).

```sql
SELECT
  p.id, ..., (6371 * acos(...lat/lng calc...)) AS distance_km,
  (SELECT count(*)::int FROM products pr WHERE pr.producer_id = p.id AND pr.active = true) AS product_count
FROM producers p
WHERE p.statut = 'public'
  AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL
  AND (p_especes IS NULL OR p.especes && p_especes)
  AND (p_labels IS NULL OR p.labels && p_labels)
  AND (6371 * acos(...même calc...)) <= p_radius_km
ORDER BY distance_km;
```

Trois problèmes superposés :

1. **Haversine recalculée en double** (SELECT + WHERE). Postgres ne factorise pas les expressions identiques sur des fonctions volatiles ; ici c'est `STABLE`, donc en théorie il pourrait, mais en pratique le planner ne le fait pas avec `acos/cos/sin`. → 2× CPU sur chaque row scannée.
2. **Sub-SELECT count(*) corrélé** : 1 query supplémentaire par producer retourné. À 10 producers actuels = négligeable. À 1 000 producers publics dans le rayon = 1 000 sub-queries (avec `products_producer_id_idx` → ~0.1 ms × 1000 = 100 ms).
3. **Pas d'index spatial**. Seq scan obligatoire sur `producers` filtré par `statut='public'`, puis filtre haversine par row. Avec 10 000 producers : ~50 ms juste pour le scan + filtre.

**Impact quantifié** (projection 1 000 producers, rayon 50 km, 100 retours) :
- Sans index spatial : ~80 ms (seq scan + filtre + sort + 100 sub-counts).
- Avec extension `cube` + `earthdistance` + index GIST `ll_to_earth(lat, lng)` : ~5 ms (index range scan) + 100 ms sub-counts = 105 ms global.
- Avec sub-count remplacé par `LEFT JOIN LATERAL (...) GROUP BY` : 30-50 ms global.
- **Combiné (spatial + LATERAL) : 10-20 ms.** Soit un gain ~5-8× à 1 000 producers, ~50× à 10 000.

À volumétrie actuelle (10 producers) : aucun problème mesurable. **Préparer la refonte avant d'atteindre 100 producteurs publics** — l'extension `cube`/`earthdistance` est dispo dans la liste Supabase mais non installée.

**Fix progressif suggéré** (par ordre de complexité) :
- Étape 1 : factorise distance via CTE/LATERAL (gain 30-40%).
- Étape 2 : remplacer sub-count par `LEFT JOIN products + GROUP BY` (gain 50%+ à fort volume).
- Étape 3 : installer `earthdistance` + `cube` + index GIST quand le seq scan domine (>5 K producers).

---

# HIGH

## H-1 — Dashboard producer : 11 queries séquentielles sans `Promise.all`

**Fichier** : `app/(producer)/dashboard/page.tsx:66-275`.

Le Server Component enchaîne **11 requêtes DB séquentielles** :
```
users (prenom/nom)
→ count(orders today)
→ count(orders yesterday)
→ orders this week (montant, statut)
→ orders last week (montant, statut)
→ producers (badges)
→ orders pending (avec embeds order_items + products)
→ orders next pickup (confirmed/ready)
→ slots this week
→ orders week pickups (date, slot_id, statut)
→ products low stock
```

Aucune dépendance entre les 10 dernières → toutes parallélisables. La 1ère (`fetchProducerForUser`) reste séquentielle puisqu'elle fournit `producer.id` aux suivantes.

**Impact quantifié** :
- Latence Vercel ↔ Supabase = ~30 ms/RT (us-east-1 ↔ eu-west).
- Séquentiel : 30 × 11 = **330 ms de latence pure réseau**, indépendamment de la perf DB.
- Avec `Promise.all` : ~30-60 ms (max(parallel) + un round-trip de tête).
- **Gain : 5-10× sur le TTFB du dashboard producer**, c'est mesurable côté UX.

**Fix** : wrap les 10 queries indépendantes dans un seul `Promise.all` après la résolution `producer.id`. Pattern déjà utilisé proprement dans `app/(producer)/creneaux/page.tsx:40-78` — référence interne.

---

## H-2 — Indexes composites manquants pour les filtres récurrents

| Query (fichier) | Filtre | Index actuel utilisé | Index optimal |
|------------------|--------|----------------------|---------------|
| Dashboard `count(orders today)` (`dashboard/page.tsx:73`) | `producer_id=X AND created_at BETWEEN ...` | `orders_producer_id_idx` puis filter | `orders(producer_id, created_at DESC)` partial `WHERE statut <> 'cancelled'` |
| Suivi commandes admin (`suivi-commandes/page.tsx:127`) | `ORDER BY created_at DESC LIMIT 200` | `orders_created_at_idx` | OK actuel (200 est petit) |
| Cart validate (`api/cart/validate/route.ts:92-97`) | `slot_id IN (...) AND statut IN ('pending','confirmed','ready')` | `orders_slot_id_idx` puis filter | `orders(slot_id, statut)` |
| Reminder cron (`api/cron/reminder-consumer/route.tsx:25-28`) | `statut='confirmed' AND date_retrait=X` | `orders_statut_idx` puis filter | `orders(statut, date_retrait)` partial `WHERE statut='confirmed'` |
| Dashboard next pickup (`dashboard/page.tsx:164-175`) | `producer_id=X AND statut IN(...) AND date_retrait>=today ORDER BY date_retrait, heure_retrait` | bitmap and 2 indexes + sort | `orders(producer_id, statut, date_retrait, heure_retrait)` partial |
| Dashboard week slots (`dashboard/page.tsx:204-210`) | `producer_id=X AND active=true AND starts_at BETWEEN` | `slots_producer_starts_at_unique` + filter `active` | OK car filter `active` post-index est cheap (981 rows) |

**Impact quantifié** :
- À 100 K orders : un `BitmapAnd` sur 2 indexes vs un index composite = ~3-10× plus lent.
- À 17 orders : aucune différence mesurable.
- **Recommandation : créer le composite `orders(producer_id, statut, date_retrait)` dès maintenant** — couvre dashboard, cron, et la page producer commandes (3 cibles), faible coût de maintenance (~16 kB).

```sql
CREATE INDEX CONCURRENTLY orders_producer_statut_date_idx
  ON public.orders (producer_id, statut, date_retrait DESC);
CREATE INDEX CONCURRENTLY orders_slot_statut_idx
  ON public.orders (slot_id, statut)
  WHERE statut IN ('pending','confirmed','ready');
```

Le second est partiel : minuscule (~50 kB à 100 K orders), couvre exactement le predicate de cart/validate.

---

## H-3 — Sub-EXISTS dans 3 RLS policies publiques

**Policies** :
```
slots public read when producer public      : EXISTS (SELECT 1 FROM producers p WHERE p.id = slots.producer_id AND p.statut = 'public')
products public read when producer public   : EXISTS (...) AND active = true
slot_rules public read when producer public : EXISTS (...)
```

À chaque row de `slots` (981 rows), Postgres résout le `EXISTS` via lookup index `producers_pkey`. C'est rapide individuellement (~10 µs) mais multiplié :
- 981 slots × 10 µs = ~10 ms par scan complet.
- Projection 100 K slots × 10 µs = ~1 s.

**Pourquoi un index aide peu** : c'est l'EXISTS qui est inefficace par design ; même avec un index parfait sur `producers(id) WHERE statut='public'`, on fait toujours N lookups.

**Solution canonique** : matérialiser un flag `producer_is_public` dans `slots` (denormalisé via trigger sur `producers`), policy devient `slots.producer_is_public = true`. Trade-off : trigger à maintenir + write-amplification sur `UPDATE producers SET statut`.

**Solution intermédiaire** : ajouter un index partial `producers(id) WHERE statut='public'` — réduit le coût du lookup mais ne change pas le N.

**Décision recommandée** : **ne rien faire pour l'instant** (981 rows) mais la flagger comme à reconsidérer dès `slots` ≥ 50 K rows (≈ 100 producers × 6 mois de matérialisation × 7 jours × 4 créneaux/jour). Valable aussi pour `products` (16 → projection ~1 K si chaque producer a 100 produits → reste OK).

---

## H-4 — `idle_in_transaction_session_timeout = 0` (jamais)

**Setting actuel** : `0` (= illimité). Côté Supabase Free/Small tier (`max_connections=60`).

**Risque** : une transaction laissée ouverte (bug applicatif, crash client sans cleanup) immobilise sa connexion + tous ses locks **indéfiniment**. Avec 60 conn max, 5 transactions zombies = 8% du pool down.

**Impact quantifié** : pas de mesure tant que rien ne crashe. Lors d'un incident : **DB qui refuse les nouvelles connexions, écrans blancs côté users**, indistinguable d'un outage backend.

**Fix** : `ALTER DATABASE postgres SET idle_in_transaction_session_timeout = '60s';` (Supabase ne permet pas le `ALTER SYSTEM` mais accepte le `ALTER DATABASE`). 60 s couvre largement les transactions légit (RPC `create_order_with_items`, etc. < 1 s).

**Bonus** : `lock_timeout=0` aussi. Une migration qui prend un `ACCESS EXCLUSIVE LOCK` peut attendre indéfiniment, derrière n'importe quelle long-running query. Recommandation : `lock_timeout='30s'` au niveau **session**, à mettre en début de chaque migration via `SET LOCAL`. Voir methodology.md.

---

# MEDIUM

## M-1 — 3 FK sans index sur la colonne enfant

| Table | Colonne | FK vers | Volume actuel | Risque |
|-------|---------|---------|---------------|--------|
| `producer_invitations` | `created_by` | `auth.users` | 11 rows | Faible — admin-only, lookup rare |
| `gms_prices` | `updated_by` | `auth.users` | 10 rows | Faible — admin-only |
| `product_stock_alerts` | `consumer_id` | `auth.users` | 0 rows | **Moyen** — feature consumer-facing à venir |

**Pourquoi c'est un problème générique** : sans index, un `DELETE FROM auth.users` (ou un cascade RGPD) doit faire un seq scan sur la table enfant pour vérifier la contrainte référentielle. Pas critique tant que les tables sont petites mais devient un loquet sur les workflows de suppression.

**Fix** :
```sql
CREATE INDEX CONCURRENTLY product_stock_alerts_consumer_id_idx ON public.product_stock_alerts (consumer_id);
-- Les deux autres : ROI faible, à laisser tomber sauf si la liste « invitations créées par X » devient une feature.
```

---

## M-2 — Listings sans pagination (commandes, producers admin)

**Fichiers** :
- `app/(consumer)/compte/commandes/page.tsx:83-91` : `select(...).eq('consumer_id', user.id).order(created_at)` — **pas de limit**.
- `app/(producer)/commandes/page.tsx:75-85` : idem côté producer.
- `app/(admin)/gestion-producteurs/page.tsx:115-122` : tous les producers, pas de limit.

**Impact quantifié** :
- Consumer power-user à 500 orders : ~200 KB JSON, 500-1 000 ms de parsing client + scroll lent. Encore acceptable.
- Consumer à 5 000 orders (rare mais possible sur un serial buyer 5 ans plus tard) : ~2 MB JSON, ~5 s, **freeze navigateur mobile**.
- Producer à 10 000 orders : effondrement complet de la page.

**Fix recommandé** : pagination cursor sur `created_at`. Pattern Supabase :
```ts
.order('created_at', { ascending: false })
.limit(50)
.lt('created_at', cursor)  // pour la page suivante
```

Pas urgent (on est à 17 orders total prod) mais **à intégrer avant tout passage en V1.0 publique**.

---

## M-3 — Statistiques de planning périmées sur tables faiblement écrites

**Tables** avec `mod_since_analyze` > `n_live_tup` (= les stats que le planner utilise sont basées sur un état démodé) :

| Table | live | mod_since_analyze | dead/live | last_autoanalyze |
|-------|------|-------------------|-----------|------------------|
| `email_change_otp_codes` | 1 | 31 | 1900% | jamais |
| `producers` | 10 | 38 | 430% | 2026-04-21 |
| `users` | 11 | 36 | 309% | 2026-04-21 |
| `orders` | 17 | 26 | 224% | 2026-04-27 |
| `slot_rules` | 7 | 23 | 200% | jamais |
| `producer_interests` | 8 | 25 | 138% | jamais |

**Pourquoi le planner ne triggers pas autovacuum** : seuils par défaut Postgres = `autovacuum_analyze_threshold=50 + 10% des live_tup`. Pour `producers` (10 rows) → seuil = 51 mods. On est à 38, donc autovacuum ne s'est pas déclenché.

**Impact quantifié** :
- Aujourd'hui : le planner peut choisir un mauvais plan (seq scan vs index) sur ces tables. À 10 rows, l'écart est imperceptible (0.1 ms vs 0.05 ms).
- Demain : si une table reste à 10 rows avec 1 000 mod/jour, l'autovacuum reste à la traîne et le planner peut faire des choix surprenants sur les jointures.

**Fix immédiat** :
```sql
ANALYZE public.producers, public.users, public.orders, public.producer_interests, public.slot_rules, public.email_change_otp_codes;
```

**Fix structurel** : ajuster les thresholds par table à fort taux d'UPDATE :
```sql
ALTER TABLE public.email_change_otp_codes SET (autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE public.producers SET (autovacuum_analyze_scale_factor = 0.05);
-- etc. pour les tables OLTP avec petite volumétrie
```

---

## M-4 — Indexes inutilisés (à surveiller sans agir)

Indexes avec `idx_scan = 0` après plusieurs semaines/mois en prod :

| Table | Index | Justification documentée | Décision |
|-------|-------|--------------------------|----------|
| `notifications` | `notifications_created_at_idx` | tri éventuel par date | **Garder** — sera utilisé par la page `/compte/notifications` à venir |
| `users` | `users_email_unique` | UNIQUE applicatif | **Garder** — contrainte fonctionnelle |
| `users` | `idx_users_stripe_customer_id` | lookup webhook Stripe | **Garder** — utilisé par `lib/stripe/handle-payment-*.ts` (race condition) |
| `producer_interests` | `producer_interests_email_key` | UNIQUE T-241 récent | **Garder** — contrainte |
| `producer_interests` | `producer_interests_created_at_idx` | tri admin liste | **Garder** — utilisé par `/admin/producer-interests` |
| `payouts` | 4 indexes | feature pas encore live | **Garder** — table vide, indexes pré-positionnés |
| `disputes` | 3 indexes | webhook Stripe charge.dispute.* | **Garder** — table vide, table opérationnelle |
| `gms_prices` | `idx_gms_prices_filiere` | lookup filiere | **Garder** — feature en cours |

**Pas de DROP recommandé sur ces indexes.** Tous ont une justification métier valide ; le `idx_scan=0` reflète juste l'âge récent (extension T-241, T-413 etc.) ou le faible trafic. À reconsidérer **après 6 mois en V1.0 live** seulement.

**Sauf** : les 4 indexes redondants exacts (cf. **C-2**) qui sont à DROP **maintenant**.

---

# LOW

## L-1 — `track_io_timing = off`

Sans ce setting, `EXPLAIN ANALYZE` ne reporte pas le temps passé sur l'IO disque vs le CPU. Sur SSD modernes l'overhead est ~0%. Recommandation : `ALTER DATABASE postgres SET track_io_timing = on;` — facilite le diagnostic des futurs slow queries (savoir si c'est CPU ou IO).

## L-2 — `log_min_duration_statement = -1` (slow query log désactivé)

Aucune query lente n'est loggée. Supabase Dashboard fournit pg_stat_statements en lecture mais ce log Postgres natif est plus détaillé (params, application_name). Recommandation : `log_min_duration_statement = 1000` (ms) — log uniquement les slow queries ≥ 1 s.

## L-3 — Extensions perf utilitaires non installées

| Extension | Disponible | Cas d'usage TerrOir | Décision |
|-----------|------------|---------------------|----------|
| `pg_trgm` | oui | recherche fuzzy admin (nom client/producer) — actuellement filtre client-side dans `suivi-commandes` | À installer quand `orders` ≥ 10 K rows |
| `cube` + `earthdistance` | oui | index spatial pour `search_producers` (cf. **C-4**) | À installer quand `producers` ≥ 100 |
| `index_advisor` | oui | suggestions d'indexes basées sur le workload réel | Utile en pre-V1.0 pour valider les recos de cet audit |
| `pg_repack` | oui | réorganisation tables sans `ACCESS EXCLUSIVE` | À garder en réserve pour la 1ère grosse table > 100 MB |

**Aucun install immédiat** — toutes ces extensions sont à activer just-in-time.

## L-4 — Indexes `created_at` sans direction explicite

`orders_created_at_idx`, `producers_created_at_idx`, `products_created_at_idx`, etc. sont btree ASC par défaut. Toutes les queries trient `DESC`. **Pas un problème** : btree est bidirectionnel, le scan inverse coûte ~0% de plus. Cosmétique pure.

## L-5 — Connection pooling : pas de configuration spécifique requise

L'app utilise exclusivement `@supabase/supabase-js` côté serveur (PostgREST HTTPS) — aucune connexion Postgres directe depuis Vercel. **Le pool est géré par Supabase côté infra (Supavisor / pgbouncer transparent).** Pas de `prepare`, pas de `LISTEN`, pas de transactions cross-request. Rien à régler côté app.

**Seul cas où ça change** : si on ajoute un cron ou worker qui ouvre une connexion directe (`pg`/`postgres-js`) → utiliser **Supavisor port 6543 transaction mode** + désactiver les prepared statements (`prepare: false`). Aucun usage actuel de ce type dans le repo.

---

## Annexe — Checklist de remédiation prioritaire

Si le temps est limité, attaquer dans cet ordre (ROI décroissant) :

1. **C-2 (DROP 4 indexes redondants)** — 5 minutes, risque ~0, gain immédiat sur write-amplification.
2. **C-1 (wrap `auth.uid()` dans toutes les RLS)** — 1 h pour la migration + tests, gain 10-100× à scale.
3. **H-4 (`idle_in_transaction_session_timeout`)** — 1 ligne SQL, garde-fou critique pour prod.
4. **H-1 (Promise.all dashboard producer)** — 30 min code change, gain UX immédiat.
5. **C-3 (N+1 dans crons)** — 1 h, prévient des cron timeouts en prod future.
6. **M-3 (ANALYZE manuel + thresholds)** — 5 min, maintient la qualité du planner.
7. **H-2 (composite indexes)** — 30 min, à faire avant V1.0.
8. **C-4 (search_producers refactor)** — 2-4 h, à différer jusqu'à ~50+ producers.

Total : ~6 h de travail pour éliminer toute la dette CRITICAL+HIGH **avant** que la volumétrie la rende douloureuse.
