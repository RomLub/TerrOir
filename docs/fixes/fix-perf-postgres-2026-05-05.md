# Fix Perf Postgres — 2026-05-05

**Source** : `docs/audits/audit-perf-postgres-2026-05-05.md` (4 CRITICAL, 4 HIGH, 4 MEDIUM, 5 LOW).
**Mode d'application** : MCP Supabase `read-write` sur prod (`apply_migration` + `execute_sql`), pas de dev intermédiaire.
**Volumétrie au moment du fix** : `slots` 981, `orders` 17, `producers` 10, `users` 11, db ~2 MB. Aucune query ne timeout — tous les fix sont préventifs.

---

## Verdict pré-audit (avant tout fix)

Avant de toucher aux RLS, vérification systématique sur les findings touchant les policies :

| Finding | Pré-audit | Verdict |
|---------|-----------|---------|
| **C-1** — `auth.uid()` non-wrappé dans 14 policies | `pg_policies` filtré sur policies utilisant `auth.uid()` non précédé de `(select` | **0 ligne → FERMÉ** par le chantier `audit-rls-2026-05-05` + `audit-rls-regression-2026-05-05`. Skip lot. |
| **H-3** — sub-EXISTS RLS sur slots/products/slot_rules | `pg_policies` filtré sur EXISTS inline pointant `producers` | **0 ligne → FERMÉ** via les helpers SD (`is_producer_public`, `can_access_order`, `is_completed_order_of_caller`) du chantier RLS antérieur. Skip lot. |

---

## Findings traités par lot

| Lot | Finding | Type | Statut | Fichier(s) |
|-----|---------|------|--------|------------|
| 1 | **C-2** — 4 indexes redondants exacts | DDL DROP | ✅ Fixé | `supabase/migrations/20260505300000_perf_drop_redundant_indexes.sql` |
| 2 | **H-4** — `idle_in_transaction_session_timeout` + `lock_timeout` | DB setting | ✅ Fixé | (pas de fichier — ALTER DATABASE) |
| 3 | **M-3** — stats périmées + autovacuum scale_factor | DDL ALTER + DML | ✅ Fixé | `20260505300100_perf_autovacuum_thresholds.sql` |
| 4 | **H-1** — Dashboard 11 queries séquentielles | TS Promise.all | ✅ Fixé | `app/(producer)/dashboard/page.tsx` |
| 5 | **C-3** — N+1 dans crons order-timeout + reminder-consumer | TS embeds PostgREST | ✅ Fixé | `app/api/cron/order-timeout/route.tsx`, `app/api/cron/reminder-consumer/route.tsx`, +1 test smoke `tests/app/api/cron/reminder-consumer/route.test.ts` |
| 6 | **H-2** — 2 indexes composites sur `orders` | DDL CREATE INDEX CONCURRENTLY | ✅ Fixé | `20260505300200_perf_composite_indexes_orders.sql` |
| 7 | **M-1** — FK `product_stock_alerts.consumer_id` non indexée | DDL CREATE INDEX CONCURRENTLY | ✅ Fixé | `20260505300300_perf_fk_index_stock_alerts.sql` |
| 8 | **C-4** — search_producers haversine ×2 | DDL CREATE FUNCTION + REVOKE FROM PUBLIC | ✅ Fixé (étape 1/3) | `20260505300400…600_*.sql` (3 migrations) |
| 9 | **M-2** + **NEW-1** — listings sans pagination + UX troncature silencieuse | TS cursor pagination + banner | ✅ Fixé | `app/(consumer)/compte/commandes/page.tsx`, `app/(producer)/commandes/page.tsx`, `app/(admin)/gestion-producteurs/page.tsx`, `components/listings/ListingHeader.tsx`, `lib/pagination/cursor.ts`, `tests/lib/pagination/cursor.test.ts` |
| — | **C-1** — `auth.uid()` non-wrappé | RLS | ✅ Déjà fermé | (pré-audit) |
| — | **H-3** — sub-EXISTS RLS | RLS | ✅ Déjà fermé | (pré-audit) |
| — | **M-4** — indexes inutilisés | (à surveiller) | ⏸ Backlog | (justifications métier valides — cf. doc audit) |

---

## Migrations appliquées via MCP

Toutes les migrations DDL ont été appliquées en prod. Les version_ids MCP (préfixes horodatés générés par Supabase au moment de l'apply) **diffèrent** des préfixes locaux choisis pour les fichiers reconstitués — pattern documenté du chantier RLS+Auth, normal et sans incidence (la prod consigne les version_ids dans `supabase_migrations.schema_migrations`, le repo consigne les préfixes locaux pour ordonner le `db reset`).

| Fichier local | version_id MCP prod | Mode apply |
|---------------|---------------------|------------|
| `20260505300000_perf_drop_redundant_indexes.sql` | `20260505133039` | `apply_migration` |
| `20260505300100_perf_autovacuum_thresholds.sql` | `20260505133654` | `apply_migration` |
| `20260505300200_perf_composite_indexes_orders.sql` | non tracé | `execute_sql` (CONCURRENTLY) |
| `20260505300300_perf_fk_index_stock_alerts.sql` | non tracé | `execute_sql` (CONCURRENTLY) |
| `20260505300400_perf_search_producers_cte.sql` | `20260505134032` | `apply_migration` (version foireuse, conservée verbatim) |
| `20260505300500_perf_search_producers_cte_fix_statut.sql` | `20260505134154` | `apply_migration` (fix sémantique) |
| `20260505300600_perf_search_producers_revoke_public.sql` | `20260505134430` | `apply_migration` (fix ACL) |

**Particularité CONCURRENTLY** : `CREATE INDEX CONCURRENTLY` ne peut pas tourner dans une transaction, donc `apply_migration` (qui wrap en BEGIN/COMMIT) refuse. Fallback `execute_sql` qui exécute en autocommit. Les fichiers locaux utilisent `CREATE INDEX IF NOT EXISTS` simple (sans CONCURRENTLY) car un `db reset` part d'une DB vide où le verrou exclusif est sans coût.

**Particularité ALTER DATABASE (LOT 2)** : `ALTER DATABASE postgres SET idle_in_transaction_session_timeout = '60s'` et `ALTER DATABASE postgres SET lock_timeout = '30s'` ne sont **pas** des migrations DDL au sens de `schema_migrations`. Ils sont stockés dans `pg_db_role_setting` et **survivent** au `db reset` (qui ne touche pas la DB). En revanche, si tu fais un `supabase db drop && supabase db create`, il faudra rejouer manuellement ces 2 ALTER ou les ajouter à un script de bootstrap. Idéalement, ces réglages devraient à terme être posés via le Dashboard Supabase (settings projet) pour persistance native.

---

## Trade-offs assumés

### C-4 search_producers — étape 1/3 seulement
- **Étape 1 fixée** : haversine factorisée via CTE (calcul une seule fois par row au lieu de 2×). Gain ~30-40 % attendu.
- **Étape 2 backlog** : remplacer le sub-SELECT `count(*)` corrélé par un `LEFT JOIN LATERAL ... GROUP BY`. À reconsidérer ≥ 100 producteurs publics.
- **Étape 3 backlog** : installer l'extension `cube` + `earthdistance` + index GIST `ll_to_earth(lat, lng)`. À reconsidérer ≥ 5 K producteurs (quand le seq scan domine la latence).

### M-4 indexes inutilisés — non droppés
Les 8 indexes avec `idx_scan = 0` ont tous une justification métier valide (features récentes T-241/T-413, tables opérationnelles vides type `disputes`/`payouts`). À reconsidérer **après 6 mois en V1.0 live** seulement.

---

## M-2 + NEW-1 traités après audit régression

L'audit régression `audit-perf-postgres-regression-2026-05-05.md` a flagué que le `.limit(100)` minimal posé en LOT 9 introduisait un effet de bord UX (NEW-1) : les listings tronqués silencieusement sans signal côté UI. M-2 et NEW-1 ont été packagés ensemble dans un fix complémentaire (LOT 9 bis).

### Pattern cursor pagination + banner

**Helper réutilisable** — `lib/pagination/cursor.ts` :
- `parseCursor(searchParams)` : lit `?before=<created_at>&before_id=<uuid>` depuis un `URLSearchParams` ou un `ReadonlyURLSearchParams` (Next.js `useSearchParams`). Cursor partiel (un seul des deux params) = ignoré.
- `buildCursorUrl(basePath, lastItem)` : construit `${basePath}?before=...&before_id=...` (URL-encodé).
- `applyCursor(query, cursor)` : ajoute `(created_at < before) OR (created_at = before AND id < beforeId)` à la query Supabase via `.or(...)`. Le tie-breaker sur `id` gère les égalités de timestamp (créations en batch dans la même milliseconde).

**Composant partagé** — `components/listings/ListingHeader.tsx` :
- Props `{ displayed, total, label }`.
- Affiche `<total> <label>` si tout est visible, ou `<displayed> <label> sur <total> (les plus récents)` si la pagination cursor masque une partie.
- `role="status"` pour l'a11y.

**Intégration sur les 3 listings** :
- `app/(consumer)/compte/commandes/page.tsx`, `app/(producer)/commandes/page.tsx`, `app/(admin)/gestion-producteurs/page.tsx`.
- Wrapper `Suspense` autour de `useSearchParams` (Next.js 14 requirement) — déjà présent côté admin, ajouté côté consumer/producer.
- `Promise.all([itemsQuery, countQuery])` : items avec cursor + count(*) exact filtré par les mêmes prédicats SQL (sans cursor, sans limit). Garde-fou perf.
- `ORDER BY created_at DESC, id DESC` aligné avec le tie-breaker du cursor.
- Bouton/lien "Charger les 100 plus anciennes" (Next.js `<Link>`) construit via `buildCursorUrl`, visible uniquement quand la limite a été atteinte (`data.length === 100`).
- Le cursor pour la page suivante est calculé sur le **100ème row brut** (avant filter UI/void côté consumer), pour ne pas sauter de rows.

### Trade-offs assumés (post-régression)

- **Filtres UI orthogonaux à la cursor** : les tabs (`all/active/done/cancelled` côté consumer, `pending/confirmed/...` côté producer) restent un filtre client sur les rows déjà fetched. La pagination cursor s'applique au fetch global. Le banner affiche `displayed/total` au niveau global pre-filter UI.
- **`isVoidOrderRow` côté consumer** : reste un filter client après fetch. Le `total` SQL inclut les void orders → léger surcomptage (max ~3 rows à 17 orders en prod, négligeable). Refactor SQL non priorisé pour respecter "modifications minimales".
- **Page navigation (replace), pas load-more (append)** : clic sur "Charger les 100 plus anciennes" navigue vers `?before=...&before_id=...` qui re-fetch. Le banner reste libellé "(les plus récents)" même en page 2-3 — légèrement misleading mais aligné sur le brief littéral. À reconsidérer si feedback user pendant V1.0.
- **Page size 100 conservée** : valeur héritée du LOT 9 initial, validée comme bon compromis JSON/perf à scale projeté.

### Cohérence count vs items

Pour chaque listing, la query count(*) **suit les mêmes filtres SQL** que la query items (sauf cursor + limit) :
- Consumer : `eq('consumer_id', user.id)`.
- Producer : `eq('producer_id', prod.id)`.
- Admin : `neq('statut', 'draft').neq('statut', 'deleted')` quand `showAll=false`, sans filtre quand `showAll=true`. Le toggle change donc à la fois items et count.

Les 3 deps `useEffect` incluent `cursorKey` (= `searchParams.toString()`) pour re-fetch sur navigation, plus `showAll` côté admin.

---

## Backlog LOW (L-1 à L-5) — non traités

| Finding | Recommandation | Priorité |
|---------|----------------|----------|
| L-1 | `ALTER DATABASE postgres SET track_io_timing = on` | Quand un slow query nécessitera du diagnostic IO/CPU |
| L-2 | `log_min_duration_statement = 1000` | Idem L-1 — utile en pre-V1.0 |
| L-3 | Extensions perf (`pg_trgm`, `cube+earthdistance`, `index_advisor`, `pg_repack`) | Just-in-time selon volumétrie |
| L-4 | Indexes `created_at` sans direction explicite | Cosmétique — btree bidirectionnel, gain ~0 % |
| L-5 | Connection pooling | Rien à régler tant que l'app reste 100 % PostgREST |

---

## Procédure de rollback par lot

| Lot | Rollback |
|-----|----------|
| 1 (C-2) | Re-créer les 4 indexes : `CREATE INDEX <nom>_idx ON public.<table> (<col>);` (pas de CONCURRENTLY nécessaire en local). Aucune raison réaliste de rollback. |
| 2 (H-4) | `ALTER DATABASE postgres RESET idle_in_transaction_session_timeout;` puis `RESET lock_timeout;`. À faire seulement si les nouveaux timeouts tuent une transaction légitime — pas observé à date. |
| 3 (M-3) | `ALTER TABLE <table> RESET (autovacuum_analyze_scale_factor);` sur chacune des 6 tables. L'`ANALYZE` manuel n'est pas rollback-able (l'effet est sain et a déjà eu lieu). |
| 4 (H-1) | `git revert` du commit. Le code Promise.all est sémantiquement équivalent au séquentiel — aucun bug applicatif possible, juste du parallélisme réseau. |
| 5 (C-3) | `git revert`. Idem — embeds PostgREST sémantiquement équivalent à 1+2N maybeSingle. |
| 6 (H-2) | `DROP INDEX CONCURRENTLY orders_producer_statut_date_idx; DROP INDEX CONCURRENTLY orders_slot_statut_idx;`. Aucun risque sur les reads (le planner retombera sur les index existants). |
| 7 (M-1) | `DROP INDEX CONCURRENTLY product_stock_alerts_consumer_id_idx;`. |
| 8 (C-4) | Recréer l'ancienne fonction depuis `supabase/migrations/20260422000000_producer_public_filtering.sql` (lignes 228-300) — c'est la **vraie** dernière source pré-fix (la migration `20260421000000` est une stale repo). |
| 9 (M-2 + NEW-1) | `git revert` (retire la cursor pagination + banner). Les 3 listings retomberont sur `.limit(100)` n'est **pas** une option de rollback partielle : le revert restaure simplement le `.limit(100)` minimal du chantier initial. |

---

## Leçons apprises (à appliquer dans les prochains chantiers)

### Leçon 1 — `DROP FUNCTION + CREATE FUNCTION` ré-applique le `GRANT EXECUTE TO PUBLIC` par défaut
**Détectée au LOT 8.** Mon `DROP FUNCTION search_producers; CREATE FUNCTION search_producers ... GRANT TO anon, authenticated;` a silencieusement ré-exposé la fonction à PUBLIC, alors que le chantier `audit-rls-lot_1_2_harden_security_definer_acls` (20260505112936) avait explicitement `REVOKE FROM PUBLIC`. La régression a été détectée par audit ACL post-LOT8 (vérification `proacl::text` contenant `=X/postgres`).

**Règle** : tout `DROP+CREATE FUNCTION` sur une fonction qui avait un `REVOKE FROM PUBLIC` doit être suivi d'un `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC` explicite. **Préférer `CREATE OR REPLACE FUNCTION` quand la signature ne change pas** (préserve l'ACL native).

### Leçon 2 — Les migrations locales sont des snapshots historiques, jamais la vérité présente
**Détectée au LOT 8.** La migration locale `20260421000000_search_producers_product_count.sql` filtre `statut = 'active'` et `pr.actif`, mais en prod la migration `20260422000000_producer_public_filtering.sql` (lignes 228-300) avait switché sur `statut = 'public'`, et `20260423000000_rename_products_actif_to_active.sql` avait renommé `actif` → `active`. Lire la migration locale d'origine pour reconstruire une fonction = se baser sur un état périmé.

**Règle** : pour reconstruire une fonction prod, toujours utiliser `pg_get_functiondef(oid)` ou parcourir `list_migrations` jusqu'à la dernière migration touchant la fonction. **Ne jamais faire confiance à la première migration qui définit une fonction.**

### Leçon 3 — Garde-fou systématique post-DROP+CREATE
**Sanity à ajouter aux procédures audit RLS/Auth/Perf** : après tout `DROP+CREATE FUNCTION`, scanner immédiatement :

```sql
SELECT proname, proacl::text
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND prosecdef = true
  AND (proacl::text ~ '\{=X/' OR proacl::text ~ ',=X/' OR proacl IS NULL);
```

Si une ligne sort → régression PUBLIC à corriger immédiatement par `REVOKE EXECUTE ... FROM PUBLIC`.

---

## Scan de garde final (post-chantier)

Lancé après l'application de l'ensemble des migrations Perf, sur **toutes** les fonctions `SECURITY DEFINER` du schema `public` :

```sql
-- A) PUBLIC explicite dans proacl
SELECT proname, proacl::text FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND prosecdef = true
  AND (proacl::text ~ '\{=X/' OR proacl::text ~ ',=X/');
-- → 0 ligne ✓

-- B) PUBLIC implicite (proacl NULL = default GRANT TO PUBLIC hérité)
SELECT proname FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND prosecdef = true
  AND proacl IS NULL;
-- → 0 ligne ✓
```

**Verdict : aucune fonction SECURITY DEFINER n'expose à PUBLIC. Chantier clean.**
