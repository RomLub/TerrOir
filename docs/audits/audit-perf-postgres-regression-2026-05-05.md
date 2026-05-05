# Audit régression Perf Postgres — 2026-05-05

**Source live** : MCP Supabase `read-write` sur prod (Postgres 17.6, projet `exsxharjqqpohkbznhss`), lecture seule (SELECT + EXPLAIN sans ANALYZE).
**Source repo** : `supabase/migrations/20260505300000…600_*.sql` (7 fichiers reconstitués), code `app/`.
**Périmètre vérifié** : 4 CRITICAL (C-1, C-2, C-3, C-4 étape 1/3) + 4 HIGH (H-1, H-2, H-3, H-4) + 3 MEDIUM (M-1, M-2, M-3) du chantier Perf, plus stabilité du chantier RLS antérieur (trigger rate-limit producer_interests), plus scan de garde SECURITY DEFINER, plus cohérence repo↔prod.
**Méthode** : pour chaque finding initial, query DB + lecture code, statut FIXED / PARTIALLY FIXED / NOT FIXED / DEFERRED. Volumétrie inchangée depuis l'audit initial (`orders` 17, `slots` 981, `producers` 10, `users` 11).

---

## Section 5 — Verdict global

🟢 **GREEN — chantier propre, prod en bon état.**

- 4/4 CRITICAL : 3 FIXED + 1 PARTIALLY FIXED (C-4 étape 1/3, étapes 2+3 backlog assumé ≥ 50/5K producers).
- 4/4 HIGH : 4 FIXED.
- 3/3 MEDIUM traitées : 2 FIXED + 1 PARTIALLY FIXED (M-2 mitigation `.limit(100)`, cursor pagination V1.0 backlog).
- M-4 + L-1 à L-5 : DEFERRED, justifications métier valides.
- Scan de garde SECURITY DEFINER : 0 ligne PUBLIC explicite, 0 ligne PUBLIC implicite — clean.
- Régressions RLS C-1 + H-3 (chantier antérieur) : restent fermées, 0 ligne.
- Trigger rate-limit `producer_interests` : actif (`tgenabled=O`).
- Cohérence repo↔prod sur les 7 migrations : sémantique identique, ACL identique, reloptions identiques.
- 1 nouveau finding LOW (UX) sur la troncature silencieuse des listings `.limit(100)`.

**Recommandation prochaine étape** : pas de chantier perf prioritaire. Quand le compteur `producers` publics atteindra 50–100, planifier l'étape 2 de C-4 (LATERAL JOIN pour `product_count`). Avant le passage en V1.0 publique, traiter M-2 cursor pagination + le finding NEW-1 ci-dessous (banner "100 derniers"). Considérer aussi le backlog L-1/L-2 (`track_io_timing` + `log_min_duration_statement`) à ce moment-là pour outiller le diagnostic en prod live.

---

## Section 4 — Cohérence repo ↔ prod (7 migrations)

NB cadre : la version_id MCP (préfixe horodaté généré au moment de l'apply) diffère du préfixe local — pattern documenté du chantier RLS+Auth, pas une finding. Ici on compare le **contenu sémantique** (DDL en prod via `pg_get_functiondef` / `pg_indexes` / `pg_class.reloptions`) au contenu des fichiers locaux.

| Fichier local | Type | État prod | Cohérence |
|---|---|---|---|
| `20260505300000_perf_drop_redundant_indexes.sql` | 4× DROP IDX IF EXISTS | Les 4 indexes `slots_producer_starts_at_idx`, `producer_invitations_token_idx`, `disputes_stripe_dispute_id_idx`, `refund_incidents_order_id_idx` sont **absents** ; canoniques présents | ✅ identique |
| `20260505300100_perf_autovacuum_thresholds.sql` | 6× ALTER TABLE SET reloption | `pg_class.reloptions = {autovacuum_analyze_scale_factor=0.05}` sur les 6 tables (`producers`, `users`, `orders`, `slot_rules`, `producer_interests`, `email_change_otp_codes`) | ✅ identique |
| `20260505300200_perf_composite_indexes_orders.sql` | 2× CREATE INDEX | `orders_producer_statut_date_idx (producer_id, statut, date_retrait DESC)` + `orders_slot_statut_idx (slot_id, statut) WHERE statut = ANY ('{pending,confirmed,ready}')` présents | ✅ identique (note : prod via `CONCURRENTLY` non tracé dans `schema_migrations`, le fichier local utilise `CREATE INDEX` simple — résultat structurel identique cf. doc fix) |
| `20260505300300_perf_fk_index_stock_alerts.sql` | 1× CREATE INDEX | `product_stock_alerts_consumer_id_idx (consumer_id)` présent | ✅ identique (idem CONCURRENTLY/non) |
| `20260505300400_perf_search_producers_cte.sql` | DROP+CREATE (filter `'active'` foireux) | Écrasé par 300500 puis 300600 — **état final** prod = même body que 300500, ACL = post-300600 | ✅ historiquement reproductible (préservé verbatim conformément au pattern documenté) |
| `20260505300500_perf_search_producers_cte_fix_statut.sql` | DROP+CREATE (filter `'public'` correct) | `pg_get_functiondef` prod = body strictement identique (CTE `filtered` + `with_distance`, sub-SELECT `count(*)`, search_path, returns 17 colonnes) | ✅ identique |
| `20260505300600_perf_search_producers_revoke_public.sql` | REVOKE PUBLIC + GRANT explicit | `proacl = {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,supabase_auth_admin=X/postgres}` — pas de `=X/postgres` PUBLIC | ✅ identique |

**Verdict cohérence : un `db reset` local appliquerait les 7 migrations dans l'ordre et reproduirait sémantiquement l'état prod.** Pas de divergence repo↔prod.

NB sur `supabase_auth_admin=X/postgres` dans l'ACL : **non** considéré comme PUBLIC par les scans de garde (proacl explicite ≠ PUBLIC). C'est un grant Supabase-natif présent par défaut sur les fonctions `public.*`. Aucune action.

---

## Section 3 — Scan de garde SECURITY DEFINER (reproductible)

Re-exécuté sur **toutes** les fonctions `SECURITY DEFINER` du schéma `public`, post-fix Perf.

```sql
-- A) PUBLIC explicite dans proacl
SELECT proname, proacl::text
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND prosecdef = true
  AND (proacl::text ~ '\{=X/' OR proacl::text ~ ',=X/');
-- → 0 ligne ✅
```

```sql
-- B) PUBLIC implicite (proacl NULL = default GRANT TO PUBLIC hérité)
SELECT proname FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND prosecdef = true
  AND proacl IS NULL;
-- → 0 ligne ✅
```

**Aucune fonction SECURITY DEFINER n'expose à PUBLIC.** Stabilité confirmée post-Perf.

---

## Section 2 — Nouveaux findings (régressions ou ajouts)

### NEW-1 (LOW) — UX : listings tronqués silencieusement à 100 lignes

**Fichiers** :
- `app/(consumer)/compte/commandes/page.tsx:94` (`.limit(100)`)
- `app/(producer)/commandes/page.tsx:88` (`.limit(100)`)
- `app/(admin)/gestion-producteurs/page.tsx:125` (`.limit(100)`)

**Pattern** : `.order('created_at', { ascending: false }).limit(100)` sans signal UI lorsque le résultat **est** tronqué (pas de "X+ items, voir suite", pas de bouton "charger plus", pas de banner d'avertissement).

**Risque** : à volumétrie > 100 (consumer power-user 5 ans plus tard, admin avec >100 producers tous statuts confondus, producer matures), l'utilisateur voit "100 lignes" et croit que c'est exhaustif. Sur la liste admin, "afficher tout" inclut `draft`+`deleted` → 100 produit/consommé sans alerte.

**Impact quantifié** :
- Aujourd'hui : 17 orders, 10 producers — aucun listing dépasse 100, donc invisible.
- Projection V1.0 : producer mature → 200+ orders → liste tronquée à 100 sans signal = perte de visibilité ops.

**Severité** : LOW. Backlog déjà prévu (M-2 cursor pagination V1.0). Mais avant V1.0, un simple banner "Affichage des 100 plus récents" couvrirait le risque UX sans attendre la pagination complète.

**Décision recommandée** : à packager **avec** le ticket M-2 cursor pagination, pas de mitigation séparée nécessaire.

---

### Pas de régression détectée sur les autres axes vérifiés

| Vérification | Résultat |
|---|---|
| `Promise.all` dashboard producer (10 queries parallèles) cause-t-il starvation pool ? | ❌ Non — `@supabase/supabase-js` côté serveur passe par PostgREST HTTPS, le pool est géré par Supavisor (transparent), pas de connexion Postgres directe depuis Vercel. 10 requêtes HTTP simultanées = ce que Vercel route sans souci. |
| Embeds PostgREST dans crons fonctionnent avec service_role ? | ✅ `service_role` bypass RLS donc les jointures `producer:producer_id (...)` et `consumer:consumer_id (...)` passent sans restriction. Le code normalise array vs object (lib `@supabase/supabase-js` retourne parfois l'un parfois l'autre). |
| Trigger rate-limit `producer_interests` toujours actif ? | ✅ `trg_producer_interests_rate_limit BEFORE INSERT FOR EACH ROW EXECUTE FUNCTION check_producer_interests_rate_limit()`, `tgenabled='O'` (Origin = enabled). |
| Sessions timeouts toujours posés ? | ✅ `idle_in_transaction_session_timeout=60000ms`, `lock_timeout=30000ms`, source=`database` (= `ALTER DATABASE`). |
| Autovacuum `scale_factor=0.05` toujours sur les 6 tables ? | ✅ Les 6 reloptions présentes. |
| Indexes composites utilisés par le planner ? | ⚠ Volumétrie trop faible (17 orders) pour que le planner choisisse un index plutôt qu'un seq scan. EXPLAIN sur les queries cibles renvoie `Seq Scan` — comportement **attendu** sur petite table (1.43 cost units, table tient en 1 page). Les indexes seront sélectionnés automatiquement quand le coût du seq scan dépassera celui de l'index (à ~1K rows). Ce n'est **pas** une régression. |
| 4 indexes redondants restent absents + canoniques présents ? | ✅ Confirmé. |
| ACL sans PUBLIC sur SECURITY DEFINER ? | ✅ 0 ligne sur les 2 scans (explicite + implicite). |
| RLS auth.uid() non-wrappé ? | ✅ 0 ligne — chantier RLS antérieur stable. |
| Sub-EXISTS sur `producers` dans policies `slots`/`products`/`slot_rules` ? | ✅ 0 ligne — chantier RLS antérieur stable. |

---

## Section 1 — Statut de chaque finding initial

### CRITICAL

#### C-1 — `auth.uid()` non-wrappé dans 14 RLS policies

> **Citation** : « 14 policies sur 9 tables utilisent directement `auth.uid()` au lieu de `(select auth.uid())`. […] Sans wrap, la fonction est ré-évaluée pour chaque row scannée par la policy. »

**Preuve fermeture** :
```sql
SELECT tablename, policyname FROM pg_policies WHERE schemaname='public'
  AND ((qual LIKE '%auth.uid()%' AND qual NOT LIKE '%(select auth.uid()%' AND qual NOT LIKE '%(SELECT auth.uid()%')
    OR (with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%(select auth.uid()%' AND with_check NOT LIKE '%(SELECT auth.uid()%'));
-- → 0 ligne
```

**Verdict** : ✅ **FIXED** (pré-fermé par le chantier RLS antérieur, confirmé stable post-Perf).

---

#### C-2 — Indexes redondants exacts (4 paires)

> **Citation** : « Quatre paires d'indexes couvrent la même clé […]. Postgres écrit dans tous les indexes à chaque INSERT/UPDATE. »

**Preuve fermeture** :
```sql
SELECT indexname FROM pg_indexes WHERE schemaname='public'
  AND tablename IN ('slots','producer_invitations','disputes','refund_incidents');
```
- `slots_producer_starts_at_idx` — **absent** ; `slots_producer_starts_at_unique` UNIQUE conservé ✓
- `producer_invitations_token_idx` — **absent** ; `producer_invitations_token_key` UNIQUE conservé ✓
- `disputes_stripe_dispute_id_idx` — **absent** ; `disputes_stripe_dispute_id_key` UNIQUE conservé ✓
- `refund_incidents_order_id_idx` — **absent** ; `refund_incidents_order_id_kind_key` UNIQUE composite conservé ✓

**Verdict** : ✅ **FIXED**.

---

#### C-3 — N+1 dans crons `order-timeout` et `reminder-consumer`

> **Citation** : « Pour chaque order de la boucle : `select … producers WHERE id=order.producer_id` + `select … users WHERE id=order.consumer_id` = 1 + 2N queries DB au lieu de 1. »

**Preuve fermeture** :
- `app/api/cron/order-timeout/route.tsx:31-39` : embed PostgREST `producer:producer_id ( nom_exploitation ), consumer:consumer_id ( email )` dans le SELECT initial. La boucle (lignes 54-232) ne contient ni `.from('producers')` ni `.from('users')`.
- `app/api/cron/reminder-consumer/route.tsx:25-33` : embed PostgREST `producer:producer_id ( nom_exploitation, adresse, commune, code_postal ), consumer:consumer_id ( email )`. La boucle (45-85) ne contient pas non plus de re-fetch.
- Test smoke `tests/app/api/cron/reminder-consumer/route.test.ts` (référencé dans le doc fix).

**Verdict** : ✅ **FIXED**.

---

#### C-4 — RPC `search_producers` : haversine ×2 + sub-SELECT count corrélé + pas d'index spatial

> **Citation** : « Trois problèmes superposés : haversine recalculée en double (SELECT + WHERE) […] sub-SELECT count(*) corrélé […] pas d'index spatial. »

**Preuve fermeture (étape 1/3)** :
```sql
SELECT pg_get_functiondef(oid) FROM pg_proc
WHERE pronamespace='public'::regnamespace AND proname='search_producers';
```

Le body prod contient désormais une CTE `with_distance` qui calcule la haversine **une seule fois par row** :
```sql
with filtered as ( select p.* from public.producers p where p.statut = 'public' ... ),
with_distance as ( select f.*, (6371 * acos(...)) as distance_km from filtered f )
select wd.*, (select count(*)::int from public.products pr where ...) as product_count
from with_distance wd
where wd.distance_km <= p_radius_km
order by wd.distance_km;
```

- Étape 1 (CTE haversine) : ✅ **FIXED**.
- Étape 2 (LATERAL JOIN pour `product_count`) : ⏸ **DEFERRED** (assumé, ≥ 100 producteurs publics).
- Étape 3 (extension `cube`+`earthdistance` + index GIST) : ⏸ **DEFERRED** (assumé, ≥ 5K producteurs).

**Verdict** : ⚠ **PARTIALLY FIXED** (étape 1/3 — backlog explicite documenté).

---

### HIGH

#### H-1 — Dashboard producer : 11 queries séquentielles

> **Citation** : « Le Server Component enchaîne 11 requêtes DB séquentielles […] Aucune dépendance entre les 10 dernières → toutes parallélisables. »

**Preuve fermeture** :
- `app/(producer)/dashboard/page.tsx:53` : `const producer = await fetchProducerForUser(...)` — séquentiel (fournit `producer.id`).
- `app/(producer)/dashboard/page.tsx:73-166` : **un seul** `Promise.all([...])` enchaîne 11 SELECT (users, count today, count yesterday, weekOrders, lastWeekOrders, producerRow, pendingRaw, upcomingRaw, slots, weekPickups, lowStockProducts).
- Pas d'autre `await` séquentiel dans la fonction.

**Verdict** : ✅ **FIXED**.

---

#### H-2 — Indexes composites manquants pour les filtres récurrents

> **Citation** : « Recommandation : créer le composite `orders(producer_id, statut, date_retrait)` dès maintenant […] + `orders(slot_id, statut) WHERE statut IN ('pending','confirmed','ready')`. »

**Preuve fermeture** :
- `orders_producer_statut_date_idx` btree `(producer_id, statut, date_retrait DESC)` — ✓ présent.
- `orders_slot_statut_idx` btree `(slot_id, statut) WHERE (statut = ANY ('{pending,confirmed,ready}'::text[]))` — ✓ présent avec predicate partiel correct.

EXPLAIN sur les queries cibles renvoie actuellement `Seq Scan` (table 17 rows, cost 1.28-1.43 — le planner préfère le seq scan tant que la table tient en quelques pages). Comportement **attendu**, le planner basculera sur les indexes dès que la table grandira (~ 1K rows pour le composite, ~ 100 rows pour le partial selective).

**Verdict** : ✅ **FIXED** (les indexes sont en place et attendent la volumétrie pour être sélectionnés — c'est la définition d'un fix préventif).

---

#### H-3 — Sub-EXISTS dans 3 RLS policies publiques

> **Citation** : « `slots public read when producer public : EXISTS (...)` […] À chaque row de slots, Postgres résout le EXISTS via lookup index. »

**Preuve fermeture** :
```sql
SELECT tablename, policyname FROM pg_policies WHERE schemaname='public'
  AND tablename IN ('slots','products','slot_rules')
  AND (qual ILIKE '%EXISTS%producers%' OR qual ILIKE '%FROM%producers%');
-- → 0 ligne
```

Le chantier RLS antérieur a remplacé les `EXISTS (...)` inline par les helpers SECURITY DEFINER (`is_producer_public`, etc.).

**Verdict** : ✅ **FIXED** (pré-fermé par chantier RLS, confirmé stable post-Perf).

---

#### H-4 — `idle_in_transaction_session_timeout = 0` (jamais)

> **Citation** : « Une transaction laissée ouverte (bug applicatif, crash client sans cleanup) immobilise sa connexion + tous ses locks indéfiniment. »

**Preuve fermeture** :
```sql
SELECT name, setting, unit, source FROM pg_settings
WHERE name IN ('idle_in_transaction_session_timeout','lock_timeout');
```
- `idle_in_transaction_session_timeout = 60000ms` (source=`database` = `ALTER DATABASE postgres SET …`)
- `lock_timeout = 30000ms` (source=`database`)
- `statement_timeout = 120000ms` (source=`configuration file`, Supabase Free tier default — non touché par le chantier mais cohérent).

**Verdict** : ✅ **FIXED** (les 2 timeouts session du chantier + `statement_timeout` natif Supabase).

---

### MEDIUM

#### M-1 — 3 FK sans index — fix priorisé sur `product_stock_alerts.consumer_id`

> **Citation** : « `product_stock_alerts.consumer_id → auth.users` — Moyen — feature consumer-facing à venir. »

**Preuve fermeture** :
```sql
SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='product_stock_alerts';
```
- `product_stock_alerts_consumer_id_idx` btree `(consumer_id)` — ✓ présent.
- Les 2 autres FK (`producer_invitations.created_by`, `gms_prices.updated_by`) restent non indexées — décision documentée (admin-only, ROI faible).

**Verdict** : ✅ **FIXED** sur la cible prioritaire ; les 2 autres FK = ⏸ **DEFERRED** (assumé).

---

#### M-2 — Listings sans pagination

> **Citation** : « Consumer à 5 000 orders : ~2 MB JSON, ~5 s, freeze navigateur mobile. […] Fix recommandé : pagination cursor sur `created_at`. »

**Preuve fermeture (mitigation)** :
- `app/(consumer)/compte/commandes/page.tsx:94` : `.limit(100)` ✓
- `app/(producer)/commandes/page.tsx:88` : `.limit(100)` ✓
- `app/(admin)/gestion-producteurs/page.tsx:125` : `.limit(100)` ✓

Cursor pagination complète **non implémentée** (assumé V1.0 backlog). Le `.limit(100)` est un garde-fou minimal contre les listings 5K+.

⚠ Effet de bord UX → cf. **NEW-1** (Section 2).

**Verdict** : ⚠ **PARTIALLY FIXED** (mitigation minimale assumée).

---

#### M-3 — Statistiques de planning périmées + autovacuum scale_factor

> **Citation** : « Tables avec `mod_since_analyze > n_live_tup` […] Fix immédiat : `ANALYZE`. Fix structurel : `ALTER TABLE … SET (autovacuum_analyze_scale_factor = 0.05)`. »

**Preuve fermeture** :
```sql
SELECT relname, reloptions FROM pg_class
WHERE relnamespace='public'::regnamespace
  AND relname IN ('producers','users','orders','slot_rules','producer_interests','email_change_otp_codes');
```
Les 6 tables ont toutes `reloptions = {autovacuum_analyze_scale_factor=0.05}` ✓.

ANALYZE manuel : effet ponctuel déjà absorbé (autovacuum prendra le relais avec le seuil resserré). Non vérifiable a posteriori (pas de trace dans `pg_stat_user_tables` au-delà de `last_autoanalyze`).

**Verdict** : ✅ **FIXED**.

---

### MEDIUM non traité (assumé backlog)

#### M-4 — Indexes inutilisés (`idx_scan = 0`)

> **Citation** : « Pas de DROP recommandé sur ces indexes. Tous ont une justification métier valide ; le `idx_scan=0` reflète juste l'âge récent (extension T-241, T-413) ou le faible trafic. À reconsidérer après 6 mois en V1.0 live seulement. »

**Verdict** : ⏸ **DEFERRED** (décision documentée et assumée).

---

### LOW (non traités, hors périmètre fix)

| ID | Description | Statut |
|---|---|---|
| L-1 | `track_io_timing = off` | ⏸ DEFERRED |
| L-2 | `log_min_duration_statement = -1` (slow query log désactivé) | ⏸ DEFERRED |
| L-3 | Extensions perf utilitaires non installées | ⏸ DEFERRED |
| L-4 | Indexes `created_at` sans direction explicite (cosmétique) | ⏸ DEFERRED |
| L-5 | Connection pooling (rien à régler tant que app = PostgREST 100%) | ⏸ DEFERRED (non actionnable) |

---

## Récap fermetures

| Sévérité | Fermés | Partiels | Backlog | Total |
|---|---|---|---|---|
| CRITICAL | 3 (C-1, C-2, C-3) | 1 (C-4 étape 1/3) | 0 | 4 |
| HIGH | 4 (H-1 à H-4) | 0 | 0 | 4 |
| MEDIUM | 2 (M-1 cible, M-3) | 1 (M-2 mitigation) | 1 (M-4) | 4 |
| LOW | 0 | 0 | 5 (L-1 à L-5) | 5 |
| **NEW** | — | — | 1 (NEW-1 UX) | 1 |

**Pas de régression bloquante. Pas de dégradation perf détectée. Chantier validé.**
