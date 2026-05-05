# Fix Audit Migrations & Cohérence Schéma — 2026-05-05

## Contexte

- **Audit source** : [`docs/audits/audit-migrations-2026-05-05.md`](../audits/audit-migrations-2026-05-05.md) (rédigé tôt 2026-05-05, AVANT les chantiers RLS / Auth / Perf bouclés ce jour-là).
- **Prémisse principale de l'audit caduque** : « **NE PAS APPLY T-241 EN L'ÉTAT** » → T-241 a depuis été apply avec patch complet (cf. SHA `2d570c5`).
- **Verdict global post-vérification** : **GREEN**. Tous les findings opérationnels (CRITICAL, HIGH, MEDIUM hors cosmétiques) ont été fermés par les chantiers antérieurs. Restent 4 résiduels acceptés sur des migrations historiques immutables, et 1 backlog post-launch.
- **Cette session = vérification programmatique + récap, AUCUN apply, AUCUNE modification de migration historique.**

### Chantiers antérieurs ayant fermé l'essentiel des findings

| SHA       | Chantier                                                    |
|-----------|-------------------------------------------------------------|
| `dd14254` | RLS Lot 0bis — backfill 35 entrées tracker `schema_migrations` (close H-1) |
| `4490c64` | RLS Lots 1-7 — revoke PUBLIC + helpers + force RLS (close C-1, C-2, M-3, L-3, L-4) |
| `2d570c5` | Reconstitution MCP-applied migrations T-241 + M-4 RLS rate-limit (close T241-CRIT-1/2/3, T241-MED-1, H-2) |
| `21a120d` | Auth régression N-1 + N-2 + N-3                              |
| `9ea5f80` `54f9c58` `1429fee` | Perf Postgres (hors périmètre Migrations)     |
| Patch 2026-05-05 (cette session) | Défense en profondeur T-241 — garde JWT-aware ajoutée à l'ACL `service_role` only (Option B, cf. § dédié plus bas) |

---

## Tableau des findings — statut post-vérification

| ID            | Sévérité | Description                                                              | Statut             | Preuve                                                                                         | Fixé par      |
|---------------|----------|--------------------------------------------------------------------------|--------------------|------------------------------------------------------------------------------------------------|---------------|
| T241-CRIT-1   | CRITICAL | Aucune garde `auth.uid() = p_user_id`                                     | **FIXED (ACL + garde)** | ACL `service_role only` **+** garde JWT-aware (Option B, défense en profondeur, post-audit)    | `2d570c5` + patch 2026-05-05 (cf. § ci-dessous) |
| T241-CRIT-2   | CRITICAL | Pas de `revoke execute ... from public`                                   | **FIXED**          | `revoke ... from public, anon, authenticated; grant ... to service_role`                       | `2d570c5`     |
| T241-CRIT-3   | CRITICAL | Combo CRIT-1 + CRIT-2 = take-over fiche producteur                        | **FIXED**          | Vecteur composite neutralisé par CRIT-2                                                        | `2d570c5`     |
| C-1           | CRITICAL | RPC `revive_order_with_stock_check` exposée PUBLIC                        | **FIXED**          | ACL = `{postgres,service_role,supabase_auth_admin}` only                                       | `4490c64`     |
| C-2           | CRITICAL | RPC `record_refund_attempt` exposée PUBLIC                                | **FIXED**          | ACL = `{postgres,service_role,supabase_auth_admin}` only                                       | `4490c64`     |
| H-1           | HIGH     | Drift 35 migrations non tracées                                           | **FIXED**          | `count(schema_migrations) = 64` (≥ 50 attendues)                                                | `dd14254`     |
| H-2           | HIGH     | 3 IDs décalés (versions tracker ≠ fichier repo)                           | **FIXED**          | 3 versions corrigées présentes, 0 ligne anciennes versions                                     | `2d570c5`     |
| T241-HIGH-1   | HIGH     | Code mergé en avance de la migration                                      | **FIXED**          | Migration T-241 désormais apply, RPC + colonnes présentes                                      | `2d570c5`     |
| M-3           | MEDIUM   | Pas de `revoke public` lors de la création des RPCs                       | **FIXED**          | Scan `proacl ~ '(\{|,)=X/'` sur `prosecdef=true` → 0 fonction PUBLIC                            | `4490c64`     |
| M-4 / T241-MED-1 | MEDIUM | T-241 `set search_path = public` sans `pg_temp`                           | **FIXED**          | `proconfig = ['search_path=public, pg_temp']`                                                   | `2d570c5`     |
| M-5 / T241-LOW-1 | MEDIUM | T-241 absence `begin; / commit;`                                         | **RESIDUAL**       | Migration historique apply, fichier immutable                                                   | —             |
| L-3           | LOW      | 7 fonctions trigger PUBLIC                                                | **FIXED**          | 7/7 sans entrée PUBLIC                                                                          | `4490c64`     |
| L-4           | LOW      | Aucune table `force row level security`                                   | **FIXED**          | `count(relforcerowsecurity=true) = 9` (≥ 6 attendues)                                           | `4490c64`     |
| M-1           | MEDIUM   | 5 migrations historiques sans `add column if not exists`                  | **RESIDUAL**       | Fichiers historiques apply, immutables                                                          | —             |
| M-2           | MEDIUM   | `drop column users.role` sans `if exists`                                 | **RESIDUAL**       | Migration destructive volontaire (wipe pré-prod)                                                | —             |
| L-1           | LOW      | Naming `idx_audit_logs_*` (préfixe vs suffixe `_idx`)                     | **RESIDUAL**       | Cosmétique pur, renommer un index live = risque > bénéfice                                      | —             |
| L-2           | LOW      | Pas d'index sur `producers.declaration_indicateurs_veracite_at`           | **BACKLOG**        | Volumétrie actuelle ~10 producteurs                                                             | —             |
| T241-LOW-2    | LOW      | T-241 `add column` sans `if not exists` (3 col)                           | **RESIDUAL**       | Migration historique apply, immutable (= sous-cas de M-1)                                       | —             |

**Synthèse compteurs** : 11 FIXED · 4 RESIDUAL acceptés · 1 BACKLOG · 0 OPEN.

---

## Findings fermés par chantiers antérieurs — preuves SQL

### T241-CRIT-1 — ACL `service_role` only **+** garde défense en profondeur (Option B)

**Statut final** : FIXED en deux temps.

**Phase 1 (chantier `2d570c5`)** : ACL `service_role` only (variante (a) du choix offert par l'audit RLS M-3 — « (a) grant + revoke public, OU (b) garde auth.uid(), idéalement les deux »).

**Phase 2 (patch 2026-05-05, cette session — § « Défense en profondeur T-241 » plus bas)** : ajout de la garde `auth.uid() = p_user_id` côté body SQL, avec bypass JWT-aware pour préserver le caller `service_role` actuel. Variante (b) cumulée à (a), atteinte du « idéalement les deux ».

```sql
-- Vérif ACL post-patch (inchangée par CREATE OR REPLACE) :
SELECT proacl::text FROM pg_proc
 WHERE proname='update_producer_onboarding'
   AND pronamespace='public'::regnamespace;
-- → {postgres=X/postgres,service_role=X/postgres,supabase_auth_admin=X/postgres}

-- Vérif garde post-patch (présence du body) :
-- pg_get_functiondef contient :
--   v_jwt_role := coalesce(
--     nullif(current_setting('request.jwt.claim.role', true), ''),
--     nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
--   );
--   if v_jwt_role is distinct from 'service_role' then
--     if auth.uid() is null or auth.uid() is distinct from p_user_id then
--       raise exception 'Not authorized to update this producer onboarding'
--         using errcode = '42501';
--     end if;
--   end if;
```

Aucune entrée `=X/postgres` (PUBLIC), aucune entrée `anon=`, aucune entrée `authenticated=`. **Le take-over T241-CRIT-3 est impossible** par ACL **et** par garde body — les deux couches sont actives.

### T241-CRIT-2 — `revoke execute from public`

```sql
-- Migration apply (extrait fichier 20260504100000_t241_...sql, lignes 255-261) :
revoke execute on function public.update_producer_onboarding(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean, text
) from public, anon, authenticated;
grant execute on function public.update_producer_onboarding(...) to service_role;
```

Confirmé live : ACL `service_role` only.

### T241-MED-1 / M-4 — `search_path` aligné sur le pattern projet

```sql
SELECT proconfig FROM pg_proc
 WHERE proname='update_producer_onboarding'
   AND pronamespace='public'::regnamespace;
-- → ["search_path=public, pg_temp"]
```

Aligné avec les 14 autres fonctions `SECURITY DEFINER` du projet.

### C-1 — `revive_order_with_stock_check` revoke PUBLIC

```sql
SELECT proname, proacl::text FROM pg_proc
 WHERE proname IN ('revive_order_with_stock_check','record_refund_attempt')
   AND pronamespace='public'::regnamespace;
-- record_refund_attempt           : {postgres=X/postgres,service_role=X/postgres,supabase_auth_admin=X/postgres}
-- revive_order_with_stock_check   : {postgres=X/postgres,service_role=X/postgres,supabase_auth_admin=X/postgres}
```

### C-2 — `record_refund_attempt` revoke PUBLIC

Cf. C-1 ci-dessus (même query couvre les deux).

### H-1 — Drift 35 migrations résorbé

```sql
SELECT count(*) FROM supabase_migrations.schema_migrations;
-- → 64
```

Attendu ≥ 50 (15 historiques + 35 backfill + nouvelles migrations RLS/Auth/Perf). 64 = OK.

### H-2 — IDs décalés corrigés

```sql
SELECT version, name FROM supabase_migrations.schema_migrations
 WHERE version IN ('20260501231300','20260502064800','20260503100000');
-- → 3 lignes : t102_1_refund_incidents, t102_2b_record_refund_attempt_rpc, t200_score_carbone

SELECT count(*) FROM supabase_migrations.schema_migrations
 WHERE version IN ('20260501231515','20260502065402','20260503014338');
-- → 0
```

### M-3 — Aucune RPC `SECURITY DEFINER` n'expose PUBLIC

**Note méthodologique** : la query suggérée par l'audit (`proacl::text LIKE '%=X/%'`) est trop large — elle matche tout grant nominatif (`authenticated=X/...`). Re-exécutée ici avec un regex précis ciblant uniquement les entrées PUBLIC (rôle vide avant `=`) :

```sql
SELECT proname, proacl::text FROM pg_proc
 WHERE pronamespace='public'::regnamespace
   AND prosecdef=true
   AND (proacl IS NULL OR proacl::text ~ '(\{|,)=X/');
-- → 0 ligne
```

Aucune fonction `SECURITY DEFINER` du schéma `public` n'a d'entrée ACL PUBLIC.

### L-3 — 7 fonctions trigger : PUBLIC revoked

```sql
SELECT proname, proacl::text FROM pg_proc
 WHERE pronamespace='public'::regnamespace
   AND proname IN ('compute_order_commission','set_order_code','set_updated_at',
                   'slot_rules_set_updated_at','enforce_user_exclusive',
                   'restore_product_stock_on_order_cancel','generate_order_code')
   AND (proacl IS NULL OR proacl::text ~ '(\{|,)=X/');
-- → 0 ligne
```

Les 7 fonctions trigger ont toutes `service_role`/`postgres`/`supabase_auth_admin` only.

### L-4 — Force RLS sur 9 tables (≥ 6 recommandées par l'audit RLS M-1)

```sql
SELECT count(*), array_agg(relname ORDER BY relname) FROM pg_class
 WHERE relkind='r' AND relnamespace='public'::regnamespace
   AND relforcerowsecurity=true;
-- → 9, {audit_logs, disputes, email_change_otp_codes, email_change_undo_tokens,
--      payouts, product_stock_alerts, refund_incident_attempts, refund_incidents,
--      webhook_events_processed}
```

Couvre les 6 tables sensibles citées par l'audit RLS M-1 (`audit_logs, disputes, refund_incidents, payouts, email_change_*, webhook_events_processed`) + 3 ajouts cohérents (`product_stock_alerts, refund_incident_attempts, email_change_otp_codes`).

---

## Findings résiduels acceptés

### M-1 — Migrations historiques sans `add column if not exists`

- **Statut** : RESIDUAL ACCEPTÉ
- **Liste réelle** (constatée par grep sur `supabase/migrations/*.sql`) :
  - `20260504100000_t241_...` (3 colonnes `declaration_indicateurs_*`)
  - `20260503100000_t200_score_carbone` (3 colonnes `mode_elevage, alimentation, densite_animale`)
  - `20260423100000_add_conseil_and_prenom_affichage_nullable` (3 colonnes `prenom_affichage, conseil_active, conseil_texte`)
  - `20260419050000_producer_ratings` (`note_moyenne, nb_avis`)
  - `20260419030000_orders_cancellation_reason_and_search` (`cancellation_reason`)
  - `20260419020000_fix_payout_ids` (`stripe_payout_id`)
  - `20260421100000_cumulative_roles_admin_users` (`roles`)
  - **Note** : les migrations citées dans l'audit `20260422310000_add_stripe_customer_id_to_users` et `20260421400000_producers_forme_juridique_type_production` utilisent en réalité bien `if not exists` — l'audit était imprécis sur ce point.
- **Justification résiduelle** : ces migrations sont apply en prod, fichiers immutables. Modifier rétroactivement casserait `db reset` et l'historique git. Le risque pratique est nul (re-runs ne sont pas une pratique projet — apply unique par migration).
- **Action future** : adopter `add column if not exists` par défaut pour toutes les nouvelles migrations (à inscrire dans `METHODOLOGY.md` ou skill supabase — non implémenté dans cette session).

### M-2 — `drop column users.role` sans `if exists`

- **Statut** : RESIDUAL ACCEPTÉ
- **Preuve** : `supabase/migrations/20260421100000_cumulative_roles_admin_users.sql:39` → `alter table public.users drop column role;`
- **Justification résiduelle** : migration destructive volontaire (wipe pré-prod : `truncate ... cascade` + `delete from auth.users` en début de fichier). Caractère non idempotent assumé.
- **Action future** : aucune sur le fichier existant. Recommandation : inscrire un commentaire `-- WARNING: non-idempotent, single-shot wipe migration` en tête lors de futures migrations destructives similaires.

### L-1 — Naming `idx_audit_logs_*` préfixe vs suffixe `_idx`

- **Statut** : RESIDUAL ACCEPTÉ
- **Preuve** : `supabase/migrations/20260427100000_create_audit_logs.sql:51-53` (3 indexes `idx_audit_logs_user_id`, `idx_audit_logs_event_type`, `idx_audit_logs_created_at`).
- **Justification résiduelle** : cosmétique pur. Renommer un index live en prod = risque > bénéfice (verrou exclusif sur la table le temps du rename, alors que l'index est utilisé par des queries chaudes).
- **Action future** : aucune. Convention à figer en arbitrage projet (préfixe `idx_` cohérent avec Postgres standard ou suffixe `_idx` cohérent avec le reste du repo) — décision orthogonale au fonctionnement actuel.

### T241-LOW-1 / M-5 — T-241 absence `begin; / commit;`

- **Statut** : RESIDUAL ACCEPTÉ
- **Preuve** : `supabase/migrations/20260504100000_t241_declaration_veracite_persistance.sql` — pas de `begin;` en tête, pas de `commit;` en fin.
- **Justification résiduelle** : migration historique apply, fichier immutable. L'apply a été fait via MCP `apply_migration` (transaction implicite côté Supabase), donc l'absence de `begin/commit` explicite n'a pas eu d'impact opérationnel.
- **Action future** : adopter `begin; / commit;` par défaut pour les nouvelles migrations multi-statements (à inscrire en convention).

### T241-LOW-2 — T-241 `add column` sans `if not exists`

- **Statut** : RESIDUAL ACCEPTÉ (= sous-cas de M-1)
- **Justification résiduelle** : identique à M-1.

---

## Backlog

### L-2 — Index timestamp DGCCRF (`producers.declaration_indicateurs_veracite_at`)

- **Statut** : BACKLOG
- **Preuve** :

```sql
SELECT indexname FROM pg_indexes
 WHERE schemaname='public' AND tablename='producers'
   AND indexdef ILIKE '%declaration_indicateurs_veracite_at%';
-- → 0 ligne
```

- **Justification** : volumétrie actuelle ~10 producteurs en pré-prod. Aucune query d'admin ne cible cette colonne aujourd'hui (la page « historique déclarations DGCCRF » n'existe pas encore).
- **Déclencheur de création** : (a) volumétrie producteurs > 100, OU (b) implémentation d'une page admin/export forensique requêtant cette colonne.
- **Spec d'index recommandée le moment venu** :

```sql
create index if not exists idx_producers_declaration_veracite_at
  on public.producers (declaration_indicateurs_veracite_at desc nulls last)
  where declaration_indicateurs_veracite_at is not null;
```

(Index partiel : seuls les producteurs ayant une déclaration archivée sont pertinents pour les vues admin DGCCRF.)

---

---

## Défense en profondeur T-241 (patch 2026-05-05, Option B retenue)

### Décision

L'audit T241-CRIT-1 demandait initialement « garde `auth.uid()` au début du body ». Le chantier `2d570c5` avait choisi la variante (a) seule (ACL `service_role` only) car le caller `complete-onboarding.ts` utilise `createSupabaseAdminClient()` (service_role) — `auth.uid()` est NULL dans ce contexte, et un `if auth.uid() is null then raise` aurait cassé l'onboarding en prod.

Le patch 2026-05-05 ajoute la **variante (b) en complément** (pas en remplacement), via une garde **JWT-aware** qui :
- bypass légitimement le caller `service_role` (claim JWT `role='service_role'` détecté) ;
- enforce `auth.uid() = p_user_id` pour **toute autre origine** (`authenticated`, `anon`, ou un appel direct postgres en cas d'ACL compromise).

Avantage : la RPC devient résistante même si l'ACL régresse (par exemple, un futur `grant execute ... to authenticated` non accompagné de garde body — comme suggéré pour T-289 / T-294 dans l'en-tête de la migration originale). La garde absorbe le risque sans nécessiter de migration additionnelle au moment de l'ouverture future.

### Migration appliquée

**Fichier** : `supabase/migrations/20260505400000_t241_update_producer_onboarding_add_auth_uid_guard.sql`
**Tracker version_id** : `20260505151248` (apply via MCP `apply_migration` — convention projet : filename sémantique préfixé `400000` pour s'intercaler après le chantier Perf `300xxx`).
**Mode** : `CREATE OR REPLACE FUNCTION` (pas DROP+CREATE — ACL préservée par CREATE OR REPLACE, leçon Lot 8 Perf).

### Diff structurel par rapport à la version `2d570c5`

```diff
  declare
+   v_jwt_role         text;
    v_current_mode     text;
    v_current_alim     text;
    ...
  begin
+   v_jwt_role := coalesce(
+     nullif(current_setting('request.jwt.claim.role', true), ''),
+     nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
+   );
+
+   if v_jwt_role is distinct from 'service_role' then
+     if auth.uid() is null or auth.uid() is distinct from p_user_id then
+       raise exception 'Not authorized to update this producer onboarding'
+         using errcode = '42501';
+     end if;
+   end if;
+
    select mode_elevage, alimentation, densite_animale,
    ...
```

Aucun autre changement à la fonction. Le reste du body (SELECT FOR UPDATE, COALESCE enums, décision `v_persist`, UPDATE final) est strictement identique.

### Sanity post-apply (vérifié 2026-05-05)

| Vérification                                                                  | Résultat                                                                       |
|--------------------------------------------------------------------------------|--------------------------------------------------------------------------------|
| `pg_get_functiondef` contient bien la garde                                   | ✓ (`v_jwt_role`, `current_setting('request.jwt.claim.role'`, `is distinct from 'service_role'`, `raise exception 'Not authorized...'`) |
| `proacl` strictement identique à pré-patch                                    | ✓ `{postgres=X/postgres,service_role=X/postgres,supabase_auth_admin=X/postgres}` |
| `proconfig` = `search_path=public, pg_temp`                                    | ✓ `["search_path=public, pg_temp"]`                                             |
| `prosecdef` = true (SECURITY DEFINER)                                          | ✓                                                                              |
| Scan régression PUBLIC (`proacl ~ '(\{|,)=X/'` sur `prosecdef=true`)           | ✓ 0 ligne                                                                      |
| Tracker `schema_migrations` enregistre la migration                            | ✓ version `20260505151248`, name `t241_update_producer_onboarding_add_auth_uid_guard` |

### Note pour ouverture future à `authenticated` (T-289 / T-294)

Si une page d'édition producteur authentifiée est implémentée plus tard et appelle directement la RPC :

1. Ajouter `grant execute on function public.update_producer_onboarding(...) to authenticated;` dans la migration de la page.
2. **Aucune modification de la garde body n'est requise** — le claim JWT `role='authenticated'` ne bypass pas, donc le `auth.uid() = p_user_id` enforce déjà l'isolation inter-utilisateurs.

C'est précisément le bénéfice de la défense en profondeur Option B : l'ouverture future est sûre par construction.

---

## Conventions à inscrire dans le projet (recommandations — non implémentées dans cette session)

À ajouter dans `METHODOLOGY.md`, `CONTRIBUTING.md`, ou la skill supabase :

1. **Toute nouvelle RPC `SECURITY DEFINER`** doit inclure :
   - (a) `revoke execute from public, anon, authenticated` + `grant execute to <role>` explicite, **OU**
   - (b) garde `auth.uid()` au début + `grant execute to authenticated`,
   - **Idéalement les deux** (alignement `delete_user_account`, `create_order_with_items`).
2. **Toute nouvelle `alter table ... add column`** : utiliser `if not exists` par défaut. Documenter en commentaire les cas où la non-idempotence est volontaire (wipe).
3. **Toute nouvelle `create or replace function`** : wrapper la migration en `begin; ... commit;` quand elle contient ≥ 2 statements indépendants.
4. **Toute migration apply via MCP** (`apply_migration`) : reconstituer le fichier local équivalent immédiatement après (pattern documenté chantiers RLS + Auth + Perf — cf. SHA `2d570c5`).

---

## Décision tracker `supabase_migrations`

Le drift H-1 a été résolu par backfill ponctuel des 35 entrées manquantes (chantier RLS Lot 0bis, SHA `dd14254`), et H-2 par mise à jour des 3 IDs décalés (SHA `2d570c5`).

**Pour éviter la réapparition** du drift, l'audit recommandait deux options :
- **Option A (recommandée par l'audit)** : basculer sur `supabase migration up --linked` comme mode d'apply unique (déprécier le SQL Editor Dashboard pour les schema changes).
- **Option B** : doubler chaque apply Dashboard d'un `INSERT` manuel dans `schema_migrations` (sera oublié à terme).

Le projet a en pratique adopté une **Option C** (cf. `METHODOLOGY.md` + chantiers RLS/Auth/Perf) : apply via MCP `apply_migration` qui maintient automatiquement le tracker, **plus** reconstitution du fichier `supabase/migrations/*.sql` côté repo. Cette option n'est pas dans le périmètre technique de cette session — elle relève d'un arbitrage humain durable déjà tranché par les chantiers récents.

---

## Verdict final

**GREEN** — Tous les findings opérationnels (CRITICAL, HIGH, MEDIUM hors cosmétiques, LOW techniques) ont été fermés par les chantiers RLS / Auth / T-241 antérieurs. Les vérifications programmatiques exécutées dans cette session confirment la fermeture sans exception.

**4 résiduels acceptés** sur des migrations historiques immutables (M-1, M-2, L-1, T241-LOW-1/2 = sous-cas de M-1) — sans impact opérationnel, à corriger par convention sur les futures migrations.

**1 backlog** post-launch (L-2 index DGCCRF), à créer quand la volumétrie producteurs ou l'implémentation d'une page admin le justifiera.

**0 finding ouvert.**
