# Audit RLS de régression — 2026-05-05 (post-fix)

**Source live** : MCP Supabase `read-write` sur prod (Postgres 17.6, lecture seule sur cet audit).
**Référence audit initial** : [docs/audits/audit-rls-2026-05-05.md](./audit-rls-2026-05-05.md).
**Référence récap fix** : [docs/fixes/fix-rls-2026-05-05.md](../fixes/fix-rls-2026-05-05.md).
**Périmètre** : 6 migrations correctives + patch T-241, toutes apply en prod le 2026-05-05 (versions tracées `20260505112426` → `20260505113449`).

---

## TL;DR

| Sévérité | Trouvée à l'origine | Fermée | Différée (arbitrée) | Restante / nouvelle |
|----------|---------------------|--------|---------------------|---------------------|
| CRITICAL |          2          |   2    |           0         |          0          |
| HIGH     |          3          |   3    |           0         |          0          |
| MEDIUM   |          6          |   4    |           2         |          0          |
| LOW      |          5          |   3    |           2         |          0          |
| **NEW**  |          —          |   —    |           —         |   1 (LOW)           |

**Verdict global** : 🟢 **GREEN**. Toutes les findings exploitables sont fermées. La seule nouvelle finding (LOW) est cosmétique (search_path incomplet sur la RPC T-241 — service_role-only, non exploitable).

---

# Section 1 — Statut des findings de l'audit initial

Antichronologique (CRITICAL → LOW). Pour chaque finding : citation textuelle de l'audit initial, statut post-fix, preuve SQL.

## CRITICAL

### C-1 — RPC `revive_order_with_stock_check(uuid)` exposée à `anon`/`authenticated`

> **Citation initiale** : « État live : ACL `=X/postgres` (PUBLIC peut EXECUTE) — vérifié via `pg_proc.proacl`. […] tout utilisateur authentifié (consumer, producer) — ou même anonyme — peut appeler la RPC via PostgREST. »

**Statut** : ✅ **FIXED**.

**Preuve** (extrait `pg_proc` post-apply) :
```
revive_order_with_stock_check(uuid)
  prosecdef = true
  proacl = postgres=X/postgres, service_role=X/postgres, supabase_auth_admin=X/postgres
```

L'ACL ne contient plus ni `=X/postgres` (PUBLIC), ni `anon=X`, ni `authenticated=X`. Seul `service_role` (et `postgres` propriétaire + `supabase_auth_admin` hérité de `20260421200000_grant_auth_admin_on_public.sql`) peut EXECUTE. Conforme à la stratégie « webhook Stripe payment_succeeded only ».

### C-2 — RPC `record_refund_attempt(...)` exposée à `anon`/`authenticated`

> **Citation initiale** : « un appelant authentifié peut UPSERT n'importe quelle ligne dans `refund_incidents` avec `(order_id, kind)` arbitraire — empoisonnant le cron retry-failed-refunds. »

**Statut** : ✅ **FIXED**.

**Preuve** :
```
record_refund_attempt(uuid, text, text, uuid, text, text, text, text, text, text, text, text, timestamptz)
  prosecdef = true
  proacl = postgres=X/postgres, service_role=X/postgres, supabase_auth_admin=X/postgres
```

Idem C-1 : pas d'EXECUTE pour anon/authenticated/PUBLIC.

## HIGH

### H-1 — `auth.uid()` et helpers `is_admin()` / `owns_producer()` non-wrappés

> **Citation initiale** : « 29 policies sur 41 utilisent `auth.uid()`, `is_admin()` ou `owns_producer()` directement, sans le wrapper `(select ...)`. »

**Statut** : ✅ **FIXED**.

**Preuve** (extrait `pg_policies` post-apply, tables `public`) :
- Toutes les policies identity-check ont `qual` / `with_check` de la forme `( SELECT auth.uid() AS uid)` ou `( SELECT is_admin() AS is_admin)` ou `( SELECT owns_producer(<col>) AS owns_producer)` — vérifié sur les 30 policies returnées.
- Aucune policy ne contient plus l'appel direct `auth.uid()` ou `is_admin()` non wrappé dans la colonne `qual`/`with_check`. Validé par parcours exhaustif de `SELECT * FROM pg_policies WHERE schemaname='public'`.

Exemples concrets :
```
users self read           qual = (( SELECT auth.uid() AS uid) = id)
producers admin all       qual = ( SELECT is_admin() AS is_admin)
products owner all        qual = ( SELECT owns_producer(products.producer_id) AS owns_producer)
```

### H-2 — Sub-queries `EXISTS (...)` inline répétées par-ligne

> **Citation initiale** : « Cinq policies évaluent un EXISTS sur une autre table à chaque row : products / slots / slot_rules public read when producer public, order_items via order, reviews consumer insert after completed order. »

**Statut** : ✅ **FIXED**.

**Preuve** :
```
products public read when producer public
  qual = ((active = true) AND ( SELECT is_producer_public(products.producer_id) AS is_producer_public))

slots public read when producer public
  qual = ( SELECT is_producer_public(slots.producer_id) AS is_producer_public)

slot_rules public read when producer public
  qual = ( SELECT is_producer_public(slot_rules.producer_id) AS is_producer_public)

order_items via order
  qual / with_check = ( SELECT can_access_order(order_items.order_id) AS can_access_order)

reviews consumer insert after completed order
  with_check = ((( SELECT auth.uid() AS uid) = consumer_id)
            AND ( SELECT is_completed_order_of_caller(reviews.order_id) AS is_completed_order_of_caller))
```

Les 5 EXISTS inline ont été remplacés par les 3 helpers `is_producer_public`, `can_access_order`, `is_completed_order_of_caller` (audités en Section 3). Bonus : les 4 `EXISTS admin_users` (audit_logs / disputes / refund_incidents / refund_incident_attempts) ont également été refactorées vers `( SELECT is_admin() AS is_admin)` pour cohérence.

### H-3 — Storage policies sans SELECT — risque d'échec silencieux d'upsert

> **Citation initiale** : « Migration 20260422100000_storage_policies_for_producers.sql crée pour chaque bucket INSERT/UPDATE/DELETE. Mais pas de SELECT. […] storage.from('product-photos').upload(path, file, { upsert: true }) côté authenticated nécessite SELECT pour le replacement. »

**Statut** : ✅ **FIXED**.

**Preuve** (`pg_policies` schema `storage`) :
```
product-photos owner select   cmd=SELECT  to=authenticated  qual=(bucket_id='product-photos' AND ( SELECT owns_producer(...)))
product-photos owner insert   cmd=INSERT  to=authenticated  with_check=...
product-photos owner update   cmd=UPDATE  to=authenticated  qual+with_check=...
product-photos owner delete   cmd=DELETE  to=authenticated  qual=...

producer-photos owner select   cmd=SELECT  to=authenticated  qual=...
producer-photos owner insert   cmd=INSERT  to=authenticated  with_check=...
producer-photos owner update   cmd=UPDATE  to=authenticated  qual+with_check=...
producer-photos owner delete   cmd=DELETE  to=authenticated  qual=...
```

8 policies (4 par bucket) couvrant le CRUD complet. Toutes wrappent `( SELECT owns_producer(...) AS owns_producer)` — H-1 propagé sur le périmètre storage. Buckets restent `public=true` (donc lecture URL publique inchangée).

## MEDIUM

### M-1 — Pas de `FORCE ROW LEVEL SECURITY` sur les tables sensibles

> **Citation initiale** : « `alter table ... force row level security` est `false` partout. […] Tables candidates : audit_logs, disputes, refund_incidents/attempts, payouts, email_change_otp_codes, email_change_undo_tokens, webhook_events_processed. »

**Statut** : ✅ **FIXED**.

**Preuve** (`pg_class.relforcerowsecurity`) — 9 tables forcées :
```
audit_logs                  force_rls = true
disputes                    force_rls = true
email_change_otp_codes      force_rls = true
email_change_undo_tokens    force_rls = true
payouts                     force_rls = true
product_stock_alerts        force_rls = true
refund_incident_attempts    force_rls = true
refund_incidents            force_rls = true
webhook_events_processed    force_rls = true
```

Couvre les 7 tables candidates de l'audit + bonus `product_stock_alerts` (PII consumers + tokens) ajouté par lot 7. Les 17 autres tables `public` (catalogue, business non-secret, etc.) restent sans force — décision saine.

### M-2 — Policies admin manquantes sur tables write-only-service_role

> **Citation initiale** : « Aucune policy admin sur : users, orders, order_items, payouts, products, slots, notifications. […] Acceptable par convention projet, mais à documenter. »

**Statut** : 🟡 **DEFERRED** (arbitrage assumé, cf. fix-rls-2026-05-05.md § « Arbitrages tranchés »).

**Justification retenue** : convention « admin = service_role » documentée dans le skill supabase + récap du fix. Aucun fichier METHODOLOGY.md créé (volontairement, pour éviter divergence vs skill).

**Preuve cohérence** : `pg_policies` confirme l'absence de policy admin sur ces tables — l'état attendu :
- `users`, `orders`, `order_items`, `payouts`, `notifications` : zéro policy admin (consultation via `createSupabaseAdminClient`).
- `products`, `slots` : `*_owner_all` (producer self-management) ; pas de policy admin (modération via service_role).

### M-3 — Drift T-241 : migration locale non appliquée en prod

> **Citation initiale** : « public.producers n'a pas les colonnes declaration_indicateurs_*, et la fonction update_producer_onboarding n'existe pas. […] Conséquence anticipée : par défaut PUBLIC peut EXECUTE, donc tout authenticated peut appeler la RPC avec un p_user_id arbitraire. »

**Statut** : ✅ **FIXED** (avec patch ACL + colonnes appliqués en prod).

**Preuve** :
- 3 colonnes présentes sur `public.producers` :
  ```
  declaration_indicateurs_snapshot           jsonb        nullable
  declaration_indicateurs_veracite_at        timestamptz  nullable
  declaration_indicateurs_wording_version    text         nullable
  ```
- Fonction `public.update_producer_onboarding(uuid, text, text, …, boolean, text)` existe, `prosecdef=true`, ACL `postgres=X/postgres, service_role=X/postgres, supabase_auth_admin=X/postgres` (pas d'anon ni authenticated).
- Migration tracée dans `supabase_migrations.schema_migrations` sous `version=20260505112426, name=t241_declaration_veracite_persistance`.

**Sous-finding résiduel mineur** (cf. Section 2, NEW-1) : `search_path` est `public` (sans `pg_temp`). Les autres SD du projet ont `public, pg_temp`. Service_role-only donc non exploitable, mais incohérent.

### M-4 — `producer_interests public insert` ouvert sans rate limit DB

> **Citation initiale** : « with_check = true accepte tout. […] Au niveau DB, un attaquant peut spammer la table jusqu'à saturation. […] Acceptable en l'état si le rate limit applicatif est solide. »

**Statut** : 🟡 **DEFERRED** (arbitrage assumé).

**Justification retenue** : volume actuel ~10 leads, croissance prévisible faible. Re-évaluation si volume > 100 leads/mois (cf. fix-rls-2026-05-05.md). UNIQUE(email) reste en place + rate-limit applicatif Next middleware.

**Preuve** : policy `producer_interests public insert` (cmd=INSERT, roles={anon,authenticated}, with_check=true) inchangée — comportement identique à l'audit initial.

### M-5 — Policy `disputes_service_role_all` redondante

> **Citation initiale** : « Cette policy n'est dans aucune migration du repo — elle a été ajoutée via Dashboard. Le service_role bypasse RLS nativement (BYPASSRLS), donc cette policy n'a aucun effet. »

**Statut** : ✅ **FIXED**.

**Preuve** : `SELECT * FROM pg_policies WHERE tablename='disputes'` retourne uniquement :
```
disputes admin read   cmd=SELECT  roles={authenticated}  qual=( SELECT is_admin() AS is_admin)
```
La policy `disputes_service_role_all` n'apparaît plus.

### M-6 — Index ACL `=X/postgres` sur toutes les fonctions = grant PUBLIC implicite

> **Citation initiale** : « 14 fonctions ont l'ACL PUBLIC EXECUTE par défaut. […] Recommandation : ajouter une migration de cleanup qui révoque PUBLIC sur toutes les fonctions sauf celles intentionnellement publiques. »

**Statut** : ✅ **FIXED**.

**Preuve** (extrait `pg_proc.proacl`, schema `public`, post-apply) :
- Aucune fonction n'a `=X/postgres` dans son ACL (signature PUBLIC).
- Helpers RLS exposés à anon/auth/sr : `is_admin`, `owns_producer`, `is_producer_public`, `can_access_order`, `is_completed_order_of_caller`, `search_producers`.
- RPCs authenticated : `create_order_with_items`, `delete_user_account`.
- RPCs service-role only : `revive_order_with_stock_check`, `record_refund_attempt`, `update_producer_onboarding`.
- Trigger functions (compute_order_commission, enforce_user_exclusive, generate_order_code, set_order_code, set_updated_at, slot_rules_set_updated_at, restore_product_stock_on_order_cancel) : ACL `postgres=X, service_role=X, supabase_auth_admin=X` — pas de grant externe nécessaire (le trigger system les exécute comme owner).

## LOW

### L-1 — Policies `to public` au lieu de `to authenticated`

> **Citation initiale** : « 22 policies (toutes celles avec roles={public} qui font un check d'identité). »

**Statut** : ✅ **FIXED**.

**Preuve** : toutes les policies identity-check ont désormais `roles={authenticated}` :
- 19 policies sur `public.*` (users 3 + producers 4 + products 1 + slots 1 + slot_rules 2 + orders 3 + order_items 1 + reviews 3 + payouts 1 + notifications 1 + producer_interests admin 3 + producer_invitations admin 1 + admin_users 1 + audit_logs 1 + disputes 1 + refund_incidents 1 + refund_incident_attempts 1).
- 8 policies storage (4×product-photos + 4×producer-photos).

Les seules policies restées `to public` sont les **public reads voulus** (anon-friendly) : `producers public read when public`, `products public read when producer public`, `slots public read when producer public`, `slot_rules public read when producer public`, `reviews public read when published`, `gms_prices public read`, `gms_prices_history public read`, `product_categories_read_public`, `animals_read_public`, `cuts_read_public`. Plus `producer_interests public insert` qui est `to anon, authenticated` (formulaire public). Conforme à l'intent.

### L-2 — Policy admin pour `users` : prévue ?

**Statut** : 🟡 **DEFERRED** (arbitrage assumé : `users` reste service-role only côté admin authenticated).

**Preuve** : `pg_policies WHERE tablename='users'` retourne uniquement les 3 policies self-* (`users self read/insert/update`). Pas de `users admin *` policy. Conforme à la décision.

### L-3 — `restore_product_stock_on_order_cancel` exposable PUBLIC

> **Citation initiale** : « Fonction trigger, pas appelable via PostgREST. ACL PUBLIC inoffensive en pratique. Révoquer pour propreté. »

**Statut** : ✅ **FIXED**.

**Preuve** : ACL = `postgres=X/postgres, service_role=X/postgres, supabase_auth_admin=X/postgres`. Pas de PUBLIC. Conforme.

### L-4 — Index `(statut, source)` manquant sur `producer_interests`

**Statut** : ✅ **FIXED**.

**Preuve** : `pg_indexes WHERE tablename='producer_interests'` :
```
producer_interests_statut_source_idx   CREATE INDEX … (statut, source)
```
Index composite présent, en sus de `producer_interests_statut_idx` (single-col, hérité). À noter : avec la composite, le single-col devient redondant — voir Section 2 § « Observations cosmétiques ».

### L-5 — Migrations locales non versionnées dans `supabase_migrations`

**Statut** : ✅ **FIXED** (backfill via `scripts/maintenance/backfill-supabase-migrations-2026-05-05.sql`).

**Preuve** : `SELECT count(*) FROM supabase_migrations.schema_migrations` = **56**. Audit initial mesurait 15 trackés sur 50 fichiers. Après backfill (35 entrées) + 6 lots du fix appliqués aujourd'hui = 56. Conforme.

**Drift cosmétique résiduel non bloquant** (déjà documenté dans le fix) :
- 3 entrées avec version_id divergent (`t102_1_refund_incidents`, `t102_2b_record_refund_attempt_rpc`, `t200_score_carbone_bien_etre`).
- Nouvelle entrée T-241 : fichier local `20260504100000_t241_*` mais tracée sous `version=20260505112426`. À aligner si nécessaire (rename fichier ou patch row).

---

# Section 2 — Nouveaux findings (régressions)

## NEW-1 (LOW) — `update_producer_onboarding` : `search_path` incomplet

**Sévérité** : LOW (defense-in-depth ; non exploitable car ACL service_role only).

**Constat** : la fonction `public.update_producer_onboarding(...)` a `proconfig = ['search_path=public']`. Toutes les autres fonctions SECURITY DEFINER du schéma `public` utilisent `search_path=public, pg_temp` :
- `is_admin`, `owns_producer`, `is_producer_public`, `can_access_order`, `is_completed_order_of_caller`, `create_order_with_items`, `delete_user_account`, `revive_order_with_stock_check`, `record_refund_attempt`, `restore_product_stock_on_order_cancel`, `search_producers`.

**Pourquoi `pg_temp` matters** : l'absence de `pg_temp` à la fin de `search_path` permet théoriquement à un attaquant disposant du privilège `CREATE` sur `pg_temp` (typiquement, n'importe quel rôle authentifié) de shadower un nom non qualifié (table, opérateur, fonction) référencé par la SD function — élévation de privilège possible si la fonction utilise un nom non préfixé. Dans `update_producer_onboarding`, tous les accès sont préfixés (`public.producers`, `auth.uid()` n'est même pas appelé) donc l'attaque concrète n'a pas de surface, mais le pattern recommandé Supabase / Postgres reste `public, pg_temp` systématiquement.

**Exploitabilité actuelle** : nulle. ACL = service_role only ; la fonction ne contient pas d'appel à un objet non qualifié exploitable. Risque purement defense-in-depth.

**Fix proposé** (cosmétique, ~2 lignes) :
```sql
alter function public.update_producer_onboarding(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean, text
) set search_path = public, pg_temp;
```

À ajouter en correctif léger (pas un nouveau lot RLS — peut être bundle avec une future migration touchant la RPC).

---

## Observations cosmétiques (pas des findings, contextuelles)

1. **Index `producer_interests_statut_idx` (single-col)** : devenu redondant avec `producer_interests_statut_source_idx` (composite — leftmost prefix). Postgres peut utiliser le composite pour les requêtes filtrant sur `statut` seul. Coût : ~quelques KB et un overhead négligeable sur les INSERT/UPDATE. Drop optionnel ; pas une finding.

2. **Drifts cosmétiques `supabase_migrations`** : 4 entrées avec version_id ≠ préfixe fichier local (les 3 héritées + T-241 apply aujourd'hui sous `20260505112426`). N'affecte pas la sécurité ; corriger uniquement si gêne concrète au workflow `supabase migration up --linked`.

3. **Effet de bord FORCE RLS sur Dashboard SQL Editor** : pour les 9 tables forcées (audit_logs, disputes, refund_*, payouts, email_change_*, webhook_events_processed, product_stock_alerts), toute session ouverte en `postgres` via SQL Editor doit désormais faire `SET ROLE service_role` avant SELECT/UPDATE. Comportement attendu et documenté dans la migration lot 7 ; à garder en tête lors d'une investigation forensique manuelle. Aucun impact runtime app (service_role bypasse via BYPASSRLS).

4. **Coverage CRUD post-refacto** : vérifié table par table (cf. requête `pg_policies` agrégée). Pas de régression vs audit initial — les choix volontaires (DELETE absent sur `users`, `orders`, `reviews` → RGPD via RPC) sont préservés. Tables service-role-only (notifications, payouts, audit_logs, disputes, refund_*, email_change_*, webhook_events_processed, product_stock_alerts, gms_prices*, product_categories/animals/cuts) ont uniquement les SELECT prévus pour les rôles concernés.

---

# Section 3 — Audit des 3 helpers SECURITY DEFINER ajoutés

Les 3 helpers introduits par le lot 3+4 sont des SQL functions `STABLE` `SECURITY DEFINER`, alignées sur le pattern `is_admin()` / `owns_producer()` historique du projet.

## 3.1 `is_producer_public(p_producer_id uuid) → boolean`

```
prosecdef          = true               (SECURITY DEFINER)
provolatile        = 's'                (STABLE)
proconfig          = ['search_path=public, pg_temp']
proacl             = postgres=X, anon=X, authenticated=X, service_role=X, supabase_auth_admin=X
```

**Verdict** : ✅ Correctement sécurisé.

- `STABLE` : compatible avec le caching `( SELECT … )` côté Postgres. Pas d'effet de bord.
- `search_path=public, pg_temp` : verrouillé. Empêche le shadowing par un schéma utilisateur (anon/authenticated) ou par `pg_temp`.
- ACL : grant explicit aux rôles RLS + supabase_auth_admin (hérité). Pas de PUBLIC.
- Logique : `EXISTS (… FROM public.producers WHERE id = p_producer_id AND statut = 'public')`. Référence qualifiée (`public.producers`). Pas d'injection possible, pas d'effet de bord. SD bypass la RLS de `producers` (intentionnel — la lecture du status d'un producer pour décider l'accès aux products/slots ne doit pas dépendre du caller).

## 3.2 `can_access_order(p_order_id uuid) → boolean`

```
prosecdef          = true
provolatile        = 's'
proconfig          = ['search_path=public, pg_temp']
proacl             = postgres=X, anon=X, authenticated=X, service_role=X, supabase_auth_admin=X
```

**Verdict** : ✅ Correctement sécurisé.

- `STABLE`, `search_path=public, pg_temp`, ACL anon+auth+sr+supabase_auth_admin — identique à 3.1.
- Logique : `EXISTS (… FROM public.orders o WHERE o.id = p_order_id AND (o.consumer_id = auth.uid() OR public.owns_producer(o.producer_id)))`.

**Point d'attention `auth.uid()` dans une SD** : `auth.uid()` lit le claim JWT du caller depuis `current_setting('request.jwt.claims')` — cette session-level config **n'est pas affectée** par SECURITY DEFINER (qui change uniquement le rôle d'exécution, pas le claim JWT). Donc `auth.uid()` retourne bien l'identité du caller authentifié, pas celle de l'owner postgres. Comportement aligné avec `is_admin()` / `owns_producer()` historiques. ✓

**Bypass RLS volontaire** : la SD bypasse la RLS de `orders` lors du EXISTS interne. C'est exactement l'effet recherché — sans ça, on aurait une boucle infinie (la policy de `order_items` interroge `orders` qui interroge sa propre RLS).

## 3.3 `is_completed_order_of_caller(p_order_id uuid) → boolean`

```
prosecdef          = true
provolatile        = 's'
proconfig          = ['search_path=public, pg_temp']
proacl             = postgres=X, anon=X, authenticated=X, service_role=X, supabase_auth_admin=X
```

**Verdict** : ✅ Correctement sécurisé.

- Mêmes garanties STABLE / search_path / ACL que les deux précédents.
- Logique : `EXISTS (… FROM public.orders WHERE id = p_order_id AND consumer_id = auth.uid() AND statut = 'completed')`. Triple guard (id + consumer + statut completed). Pas d'élévation possible.

## Synthèse helpers

Les 3 helpers respectent le contrat sécurité Supabase :
1. ✅ SECURITY DEFINER avec `search_path` verrouillé sur `public, pg_temp` → pas de shadowing.
2. ✅ STABLE → cachable par Postgres en InitPlan dans les wrappers `( SELECT … )`.
3. ✅ ACL minimaliste : grant aux rôles RLS strictement nécessaires, REVOKE PUBLIC.
4. ✅ Références qualifiées (`public.producers`, `public.orders`, `public.owns_producer`).
5. ✅ `auth.uid()` lu depuis le contexte JWT du caller (non altéré par la SD).
6. ✅ Bypass RLS de la table cible volontaire (intent) — pas d'effet de bord négatif (lecture seule, conditions strictes).

Aucune escalade de privilège possible via ces helpers.

---

# Section 4 — Verdict global

🟢 **GREEN** — Toutes les findings exploitables identifiées par l'audit initial sont fermées en prod. Les findings différées (M-2, M-4, L-2, L-5 résiduel cosmétique) sont des arbitrages projet documentés dans `docs/fixes/fix-rls-2026-05-05.md`, pas des trous de sécurité.

**Synthèse par axe** :

- **Surface RPC** : verrouillée. Plus aucune RPC `SECURITY DEFINER` n'est exposée à PUBLIC/anon/authenticated par défaut. Les RPCs sensibles (`revive_order_with_stock_check`, `record_refund_attempt`, `update_producer_onboarding`) sont service_role only ; les RPCs publiques (`search_producers`, `is_admin`, `owns_producer`, helpers) ont des grants explicites scopés.

- **Performance RLS** : alignée recommandation Supabase. Les 22 policies identity-check sont wrappées `( SELECT … )` ; les 5 EXISTS inline + 4 EXISTS admin_users sont remplacés par 3 helpers + `is_admin()`. Plus aucune policy ne ré-évalue par-row une fonction stable.

- **Storage** : couverture SELECT/INSERT/UPDATE/DELETE complète sur les 2 buckets producteur. Upsert authenticated désormais fonctionnel (anti-régression silent-fail).

- **Defense-in-depth** : FORCE RLS actif sur les 9 tables sensibles. Policy redondante `disputes_service_role_all` retirée. ACL trigger functions nettoyées.

- **Isolation www / pro / admin** : modèle 3-subdomains préservé. RLS reflète correctement les privilèges (cf. annexe audit initial). Aucune policy introduite par le fix ne brèche l'isolation : les helpers sont scopés par UUID (producer_id, order_id) ou par identité (`auth.uid()`), jamais par cumul de rôle générique. La séparation stricte `users` ↔ `admin_users` (trigger `enforce_user_exclusive`) reste en place. ✓

- **Helpers SECURITY DEFINER ajoutés** : les 3 nouveaux (`is_producer_public`, `can_access_order`, `is_completed_order_of_caller`) sont conformes au contrat de sécurité du projet (STABLE, search_path verrouillé, ACL minimaliste, références qualifiées). Aucune escalade possible.

**Une seule finding nouvelle (LOW)** : `update_producer_onboarding` a `search_path=public` au lieu de `public, pg_temp`. Non exploitable (service_role only) mais incohérent avec les 11 autres SD du projet. Fix d'une ligne, à bundle dans un correctif léger ou la prochaine migration touchant la fonction.

## Recommandation prochaine étape

1. **Optionnel court terme** : appliquer `ALTER FUNCTION public.update_producer_onboarding(...) SET search_path = public, pg_temp;` pour harmoniser le pattern (NEW-1). Risque nul, gain defense-in-depth.

2. **À surveiller** : si M-4 (rate-limit DB sur `producer_interests`) déclenche un incident spam (volume > 100 leads/mois), ré-ouvrir un chantier dédié (trigger BEFORE INSERT ou `pg_cron` purge).

3. **À adopter** : `supabase migration up --linked` pour toute nouvelle migration, afin d'éviter les drifts version_id futurs (cf. L-5 résiduel cosmétique).

4. **Pas d'action urgente requise**. Le modèle RLS est sain, performant et auditeur-ready.

---

*Rapport généré le 2026-05-05 par lecture seule sur la prod via MCP Supabase. Aucune modification SQL effectuée pendant cet audit.*
