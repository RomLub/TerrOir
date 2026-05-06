# Audit pré-Live RPC `update_producer_onboarding` — 2026-05-06 (T-295)

**Source live** : MCP Supabase `read-write` sur prod (Postgres 17.6).
**Périmètre** : RPC `public.update_producer_onboarding(uuid, text, ..., text)`
introduite par migration T-241 (`20260504100000_t241_declaration_veracite_
persistance.sql`), patchée par T-241 audit RLS 2026-05-05
(`20260505151248_t241_update_producer_onboarding_add_auth_uid_guard.sql`).

**Pourquoi un audit dédié** : la RPC porte la **valeur probatoire DGCCRF**
des 3 colonnes `declaration_indicateurs_*` (timestamp + snapshot des
valeurs déclarées + version du wording certifié). Une faille d'ACL
permettrait à un producteur authentifié de forger lui-même son
`_veracite_at` / `_snapshot` / `_wording_version` via PostgREST,
détruisant la valeur probante de la trace DGCCRF.

---

## Audit findings (4 points)

| # | Critère | Attendu | Constaté | Verdict |
|---|---------|---------|----------|---------|
| (a) | `SECURITY DEFINER` | true | `prosecdef = true` | ✅ |
| (b) | `SET search_path` | `public, pg_temp` | `search_path=public, pg_temp` | ✅ |
| (c) | EXECUTE révoqué de PUBLIC + anon | pas de `=X/postgres` standalone | `proacl` ne contient PAS `=X/postgres` | ✅ |
| (d) | GRANT EXECUTE TO `service_role` uniquement | service_role only (+ supabase internal) | `{postgres=X/postgres, service_role=X/postgres, supabase_auth_admin=X/postgres}` | ✅ |

**Verdict global** : **4/4 conforme**. Aucune migration corrective
nécessaire.

### Smoke tests post-audit

| Test | Contexte | Résultat |
|------|----------|----------|
| Authenticated owner appelle `update_producer_onboarding` directement (via PostgREST simulé `set role authenticated` + JWT claim `sub=<own_user_id>`) | Tente de forger `declaration_indicateurs_*` | ✅ `ERROR 42501 permission denied for function update_producer_onboarding` |
| Anon appelle la RPC | Tente accès non-authentifié | ✅ `ERROR 42501 permission denied for function update_producer_onboarding` |
| service_role appelle la RPC (via server action `complete-onboarding`) | Cas nominal flow onboarding wizard | ✅ Passe (validé par tests vitest existants `complete-onboarding.test.ts`) |

---

## Détail proacl interprété

```
{postgres=X/postgres, service_role=X/postgres, supabase_auth_admin=X/postgres}
```

- `postgres=X/postgres` : owner Postgres, accès intrinsèque (pas un grant).
- `service_role=X/postgres` : ✅ attendu — appelée par
  `complete-onboarding.ts` via `createSupabaseAdminClient()`.
- `supabase_auth_admin=X/postgres` : Supabase internal (rôle système
  utilisé par Auth pour les triggers `on_auth_user_created` etc.). OK.

**Important** : pas de ligne `=X/postgres` standalone (qui signifierait
PUBLIC peut EXECUTE). C'est exactement ce qui distinguait les RPC
CRITICAL C-1 et C-2 de l'audit RLS 2026-05-05 (`revive_order_with_stock_
check` et `record_refund_attempt`) qui avaient ce leak avant fix.

---

## Audit transverse — autres RPC SECURITY DEFINER (T-295-bis backlog)

Inventaire des 17 fonctions `SECURITY DEFINER` dans schéma `public` :

| Fonction | search_path | proacl annoté | Verdict |
|----------|-------------|---------------|---------|
| `update_producer_onboarding` | ✅ `public, pg_temp` | service_role only | ✅ T-295 OK |
| `check_producer_interests_rate_limit` | ✅ | service_role only | ✅ |
| `record_refund_attempt` | ✅ | service_role only (fix C-2 du 2026-05-05) | ✅ |
| `restore_product_stock_on_order_cancel` | ✅ | service_role only | ✅ trigger function |
| `revive_order_with_stock_check` | ✅ | service_role only (fix C-1 du 2026-05-05) | ✅ |
| `is_admin` | ✅ | anon + authenticated EXECUTE | ✅ helper RLS public |
| `owns_producer` | ✅ | anon + authenticated EXECUTE | ✅ helper RLS public |
| `is_completed_order_of_caller` | ✅ | anon + authenticated EXECUTE | ✅ helper RLS public |
| `is_producer_public` | ✅ | anon + authenticated EXECUTE | ✅ helper RLS public |
| `can_access_order` | ✅ | anon + authenticated EXECUTE | ✅ helper RLS public |
| `search_producers` | ✅ | anon + authenticated EXECUTE | ✅ public search avec garde rate-limit T-236 |
| `create_order_with_items` | ✅ | authenticated EXECUTE | ✅ garde interne `auth.uid()` |
| `delete_user_account` | ✅ | authenticated EXECUTE | ✅ garde interne `auth.uid()` self-service |
| `bump_geocode_cache` (T-219) | ✅ | anon + authenticated EXECUTE | ⚠️ à arbitrer cf. ci-dessous |
| `upsert_geocode_cache` (T-219) | ✅ | anon + authenticated EXECUTE | ⚠️ à arbitrer cf. ci-dessous |
| `invalidate_active_invitations_for_email` (T-109) | ✅ | **`=X/postgres` (PUBLIC EXECUTE)** + anon + authenticated | ⚠️ trigger function — leak inoffensif en pratique (pas de signature standard exposable PostgREST) mais propre à révoquer |
| `producers_block_owner_admin_columns` (T-218) | ✅ | **`=X/postgres` (PUBLIC EXECUTE)** + anon + authenticated | ⚠️ trigger function — idem leak inoffensif, propre à révoquer |

### Findings annexes (T-295-bis backlog)

**1. Trigger functions avec `=X/postgres` standalone**

Deux fonctions trigger ont la ligne `=X/postgres` (PUBLIC EXECUTE) dans
leur `proacl` :
- `invalidate_active_invitations_for_email` (T-109)
- `producers_block_owner_admin_columns` (T-218)

**Risque pratique** : nul. PostgREST n'expose pas les fonctions trigger
comme RPC (signature non-standard). Aligné avec finding L-3 de l'audit
RLS 2026-05-05 (`restore_product_stock_on_order_cancel` qui avait le
même pattern, retiré ensuite par migration `audit_rls_lot_8_cleanup_rls_low`).

**Defense-in-depth recommandée** : `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC;`
sur ces 2 fonctions trigger pour cohérence. Migration légère, zéro impact
runtime. À cadrer en T-295-bis.

**2. RPC géocodage T-219 (bump/upsert_geocode_cache)**

Les 2 RPC posées par T-219 (`bump_geocode_cache`, `upsert_geocode_cache`)
ont `anon + authenticated EXECUTE`. Le call site applicatif est
`/api/geocode/route.ts` qui passe par `createSupabaseAdminClient()`
(service_role). Donc l'EXECUTE par anon/authenticated n'est pas utilisé
en pratique côté application.

**Risque pratique** : un attaquant authentifié pourrait appeler
directement les RPC via PostgREST pour empoisonner le cache géocodage
(`upsert_geocode_cache` avec une mauvaise lat/lng pour un CP donné →
DistanceWidget consumer affiche distance fausse). Modèle de menace à
documenter (T-227 cluster).

**À cadrer en T-295-bis** : décision technique à prendre :
- (A) Révoquer EXECUTE de anon/authenticated, garder service_role
  uniquement (cohérent avec doctrine update_producer_onboarding).
- (B) Garder l'ACL actuelle si une feature future doit appeler la RPC
  côté authenticated (peu probable, mais possible).

Recommandation : (A) tant que pas de besoin métier opposé.

---

## Doctrine pré-Live formalisée

> Toute RPC `SECURITY DEFINER` posant des invariants probatoires
> (DGCCRF, audit forensique) ou écrivant dans des tables sensibles
> (`producers`, `orders`, `audit_logs`, `refund_incidents`,
> `producer_invitations`) doit être configurée comme suit :
>
> 1. **`SECURITY DEFINER`** posé explicitement.
> 2. **`SET search_path = public, pg_temp`** (et non juste `public` —
>    sinon vulnérable à des objets injectés dans le search_path par
>    défaut du caller).
> 3. **`REVOKE EXECUTE ... FROM PUBLIC`** dans la migration de
>    création (ou immédiatement après).
> 4. **`GRANT EXECUTE TO service_role`** uniquement (sauf si la RPC
>    est appelée légitimement côté `authenticated` avec garde interne
>    `auth.uid() = p_user_id`, type `delete_user_account`).
>
> Toute RPC de helper RLS (`is_admin`, `owns_producer`,
> `is_producer_public`, `can_access_order`, `is_completed_order_of_caller`)
> peut conserver `anon + authenticated EXECUTE` (helper invoqué par les
> policies elles-mêmes côté Postgres).
>
> Toute fonction trigger doit être `REVOKE EXECUTE FROM PUBLIC` même si
> le risque pratique est nul (defense-in-depth + cohérence audit).

---

## Verdict T-295 et fermeture

T-295 est **clôturé sans migration corrective** :
- RPC `update_producer_onboarding` 4/4 conforme.
- Smoke tests confirment le verrou (authenticated + anon → 42501).
- Cas A (tout conforme) du brief.

**Backlog T-295-bis** ouvert pour traiter les findings annexes :
- Révoquer PUBLIC EXECUTE sur `invalidate_active_invitations_for_email`
  et `producers_block_owner_admin_columns` (defense-in-depth).
- Arbitrer ACL des 2 RPC géocodage T-219 (révoquer authenticated/anon
  ou laisser).

Pas urgent — pas un bloquant Live strict. À traiter au prochain audit
RLS transverse (post-T-003 audit externe).

---

## Références

- Migration création : `supabase/migrations/20260504100000_t241_declaration_
  veracite_persistance.sql`
- Migration patch RLS : `supabase/migrations/20260505151248_t241_update_
  producer_onboarding_add_auth_uid_guard.sql`
- Audit RLS global : `docs/audits/audit-rls-2026-05-05.md` (sections C-1,
  C-2, M-3, L-3 sur le même pattern d'ACL)
- Trigger T-218 : `docs/security/audit-rls-producers-2026-05-06.md`
- Caller applicatif : `app/(producer)/invitation/_actions/complete-
  onboarding.ts` (server action via service_role)
