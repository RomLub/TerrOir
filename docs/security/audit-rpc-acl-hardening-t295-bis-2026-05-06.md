# Durcissement ACL des 4 RPC findings annexes T-295 — 2026-05-06 (T-295-bis)

## Contexte

T-295 (`docs/security/audit-rpc-update-producer-onboarding-pre-live-
2026-05-06.md`) a livré l'audit pré-Live de la RPC
`update_producer_onboarding` (4/4 conforme) + l'audit transverse des 17
fonctions `SECURITY DEFINER` posées dans le schéma `public`. **4
findings annexes** non bloquants Live mais à durcir pour cohérence
stricte avec la doctrine pré-Live :

1. `invalidate_active_invitations_for_email` (T-109) — trigger
   function avec ACL `=X/postgres` standalone (PUBLIC EXECUTE). Leak
   inoffensif en pratique (PostgREST n'expose pas les triggers comme
   RPC), mais propre à révoquer pour cohérence avec L-3 du 2026-05-05.
2. `producers_block_owner_admin_columns` (T-218 + T-218-bis) — trigger
   function, même finding que (1).
3. `bump_geocode_cache` (T-219) — RPC `SECURITY DEFINER` avec
   `anon + authenticated EXECUTE` explicites. Call site applicatif
   (`lib/geo/geocode-cache.ts` via `/api/geocode/route.ts`) passe par
   `service_role` server-side. Aucun client légitime ne l'appelle direct.
4. `upsert_geocode_cache` (T-219) — même pattern que (3) mais plus
   critique : un attaquant peut INSERT coords arbitraires pour un CP
   donné (cache poisoning → DistanceWidget consumer afficherait des
   distances fausses). **Cluster T-227** (modèle de menace
   ré-identification adresse).

T-295-bis livre la migration corrective + apply via MCP + smoke tests.

---

## Diff ACL avant / après

### 1. `invalidate_active_invitations_for_email()` (T-109)

| Avant | Après |
|-------|-------|
| `{=X/postgres, postgres=X, anon=X, authenticated=X, service_role=X, supabase_auth_admin=X}` | `{postgres=X, service_role=X, supabase_auth_admin=X}` |

PUBLIC standalone (`=X/postgres`), `anon` et `authenticated` retirés.
Trigger continue à se déclencher (trigger engine bypass les ACL).

### 2. `producers_block_owner_admin_columns()` (T-218 + T-218-bis)

| Avant | Après |
|-------|-------|
| `{=X/postgres, postgres=X, anon=X, authenticated=X, service_role=X, supabase_auth_admin=X}` | `{postgres=X, service_role=X, supabase_auth_admin=X}` |

Idem (1).

### 3. `bump_geocode_cache(character varying)` (T-219)

| Avant | Après |
|-------|-------|
| `{postgres=X, anon=X, authenticated=X, service_role=X, supabase_auth_admin=X}` | `{postgres=X, service_role=X, supabase_auth_admin=X}` |

`anon` et `authenticated` retirés. Plus aucun client externe ne peut
appeler la RPC directement via PostgREST. `service_role` (call site
applicatif) conserve l'accès.

### 4. `upsert_geocode_cache(character varying, numeric, numeric, character varying)` (T-219)

| Avant | Après |
|-------|-------|
| `{postgres=X, anon=X, authenticated=X, service_role=X, supabase_auth_admin=X}` | `{postgres=X, service_role=X, supabase_auth_admin=X}` |

Idem (3). **Cache poisoning géocodage bloqué** — un attaquant
authentifié ne peut plus injecter `latitude=99, longitude=-99` pour un
CP donné.

---

## Smoke tests post-apply (7 cas)

| # | Test | Contexte | Résultat |
|---|------|----------|----------|
| 1 | `bump_geocode_cache('75001')` | anon (jwt role=anon) | ✅ `ERROR 42501 permission denied for function bump_geocode_cache` |
| 2 | `bump_geocode_cache('75001')` | authenticated (jwt role=authenticated, sub=user) | ✅ `ERROR 42501 permission denied for function bump_geocode_cache` |
| 3 | `upsert_geocode_cache('99999', 99, -99, 'attack')` | anon | ✅ `ERROR 42501 permission denied for function upsert_geocode_cache` |
| 4 | `upsert_geocode_cache('75001', 99, -99, 'attack')` | authenticated | ✅ `ERROR 42501 permission denied for function upsert_geocode_cache` (cache poisoning bloqué) |
| 5 | `bump_geocode_cache('72100')` + `upsert_geocode_cache('72100', 47.99, 0.18, 'test')` | service_role | ✅ exécuté sans erreur (path nominal applicatif préservé) |
| 6 | UPDATE `producers SET statut='public' WHERE id=...` (authenticated owner) | trigger `producers_block_owner_admin_columns` invocation indirecte | ✅ `ERROR 42501: producers.statut is admin-only (T-218)` — trigger toujours actif post-REVOKE |
| 7 | INSERT `producer_invitations` 2 fois pour le même email (service_role) | trigger `invalidate_active_invitations_for_email` invocation indirecte | ✅ 2 inserts → 1 seule invitation active après (la 1ère invalidée par le trigger, T-109 préservé) |

**Conclusion smoke tests** : 7/7 verts. Verrou ACL effectif sans casser
les triggers existants.

---

## Doctrine pré-Live finalisée

> **Toute RPC `SECURITY DEFINER` écrivant dans des tables sensibles**
> (`producers`, `orders`, `audit_logs`, `refund_incidents`,
> `producer_invitations`, `geocode_cache`) doit avoir :
>
> 1. `SECURITY DEFINER` posé.
> 2. `SET search_path = public, pg_temp` (et non juste `public`).
> 3. `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` dans la
>    migration de création (ou immédiatement après).
> 4. `GRANT EXECUTE TO service_role` exclusivement (sauf si la RPC est
>    appelée légitimement côté `authenticated` avec garde interne
>    `auth.uid() = p_user_id` — ex. `delete_user_account`,
>    `create_order_with_items`).
>
> **Helpers RLS** (`is_admin`, `owns_producer`, `is_producer_public`,
> `can_access_order`, `is_completed_order_of_caller`) gardent
> `anon + authenticated EXECUTE` car invoqués par les policies
> elles-mêmes côté Postgres.
>
> **Public search** (`search_producers`) garde `anon + authenticated
> EXECUTE` car c'est le contrat explicite (recherche publique avec
> rate-limit T-236 anti-trilatération).
>
> **Trigger functions** : `REVOKE EXECUTE FROM PUBLIC, anon,
> authenticated`. Pas de `GRANT TO service_role` nécessaire (le trigger
> engine Postgres bypass les ACL EXECUTE des fonctions trigger).

---

## État final — toutes les 17 fonctions SECURITY DEFINER

Post-T-295-bis, **aucune RPC `SECURITY DEFINER` n'a `=X/postgres`
standalone (PUBLIC EXECUTE) dans son ACL**. La cohérence pré-Live est
finalisée.

| Fonction | ACL EXECUTE | Conforme doctrine ? |
|----------|-------------|---------------------|
| `update_producer_onboarding` (T-241) | service_role only | ✅ |
| `check_producer_interests_rate_limit` | service_role only | ✅ |
| `record_refund_attempt` | service_role only (fix C-2 du 2026-05-05) | ✅ |
| `restore_product_stock_on_order_cancel` | service_role only | ✅ trigger function |
| `revive_order_with_stock_check` | service_role only (fix C-1 du 2026-05-05) | ✅ |
| `is_admin` | anon + authenticated | ✅ helper RLS public |
| `owns_producer` | anon + authenticated | ✅ helper RLS public |
| `is_completed_order_of_caller` | anon + authenticated | ✅ helper RLS public |
| `is_producer_public` | anon + authenticated | ✅ helper RLS public |
| `can_access_order` | anon + authenticated | ✅ helper RLS public |
| `search_producers` | anon + authenticated | ✅ public search avec rate-limit T-236 |
| `create_order_with_items` | authenticated + garde interne | ✅ |
| `delete_user_account` | authenticated + garde interne | ✅ |
| `bump_geocode_cache` (T-219) | service_role only | ✅ T-295-bis |
| `upsert_geocode_cache` (T-219) | service_role only | ✅ T-295-bis |
| `invalidate_active_invitations_for_email` (T-109) | service_role only | ✅ T-295-bis trigger |
| `producers_block_owner_admin_columns` (T-218) | service_role only | ✅ T-295-bis trigger |

**Audit transverse pré-Live RPC SECURITY DEFINER : clôturé.**

---

## Articulations

- **T-295** : RPC `update_producer_onboarding` 4/4 conforme (sans
  migration). T-295-bis traite les findings annexes inventoriés par
  l'audit transverse de T-295.
- **T-227** : modèle de menace ré-identification adresse. Le cache
  poisoning géocodage (RPC `upsert_geocode_cache`) était une vecteur
  d'attaque secondaire — bloqué par T-295-bis.
- **T-218 / T-218-bis** : trigger `producers_block_owner_admin_columns`
  toujours fonctionnel post-REVOKE EXECUTE FROM PUBLIC (vérifié par
  smoke test 6).
- **T-109** : trigger `invalidate_active_invitations_for_email` toujours
  fonctionnel post-REVOKE (vérifié par smoke test 7).
- **T-244 checklist pré-Live** : T-295-bis ajouté à la section
  P0-Sécurité comme livré.

---

## Backlog

Aucune RPC `SECURITY DEFINER` ouverte en EXECUTE PUBLIC restante. À
**re-vérifier au prochain audit RLS transverse** (post-T-003 audit
externe) en exécutant :

```sql
SELECT proname, proacl::text
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND prosecdef = true
  AND proacl::text LIKE '%=X/postgres%'
  AND proacl::text NOT LIKE '%postgres=X/postgres%';
-- Doit retourner 0 lignes.
```

Si une nouvelle RPC `SECURITY DEFINER` est posée sans REVOKE
PUBLIC/anon/authenticated dans la migration de création, ce check
le détectera.

---

## Références

- Migration : `supabase/migrations/20260506185526_t295_bis_rpc_acl_
  hardening.sql` (timestamp DB tracking, fichier disque renommé
  post-apply MCP)
- Audit T-295 : `docs/security/audit-rpc-update-producer-onboarding-
  pre-live-2026-05-06.md`
- Audit RLS global 2026-05-05 : `docs/audits/audit-rls-2026-05-05.md`
  (sections C-1, C-2, L-3 sur le pattern d'ACL)
- Trigger T-218 : `docs/security/audit-rls-producers-2026-05-06.md`
- Cluster T-227 : modèle menace ré-identification adresse producteur
