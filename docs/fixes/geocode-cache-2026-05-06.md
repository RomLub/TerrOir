# Cache serveur géocodage CP→lat/lng — T-219

> Date : 2026-05-06
> Branche : master
> Tickets : T-219 (issu rapport technique comité T-200 round 1, 03/05/2026), prérequis partiel T-204

---

## Décision

**Option α retenue** : table Supabase persistante `public.geocode_cache` + 2 RPC (`bump_geocode_cache`, `upsert_geocode_cache`) + route `/api/geocode` + helper client `geocodePostalCodeViaApi`.

### Rationale (vs β Upstash KV / γ unstable_cache)

1. **CP français = stables à vie** → TTL inutile, persistance permanente cross-deploy = bon modèle. Upstash TTL artificiel gère mal cette propriété.
2. **Observabilité SQL** : `hit_count` + `last_hit_at` permet d'identifier les CP populaires pour le scaling Pays de la Loire (T-204) et pour préparer le plan B fournisseur (T-226).
3. **Stack cohérente** : Upstash chez TerrOir est dédié au rate-limit (haute fréquence, fail-open, anti-DoS) ; mélanger les usages (cache de référentiel stable + rate-limit) dilue la lisibilité de l'archi.
4. **Coût zéro** : Supabase déjà payé. ~10 MB pour 100k entrées, négligeable.
5. **Atomicité native** : 2 RPC Postgres garantissent l'isolation (UPDATE ... RETURNING + INSERT ... ON CONFLICT DO UPDATE) — pas de race condition sur `hit_count`, `resolved_at` préservé sur les UPSERT concurrents.

---

## Continuité avec T-200 r1

Comité T-200 r1 avait demandé : *« zéro serveur géocodage, appel direct navigateur, pas de PII traversant serveur, pas de log par-IP, pas de profilage user »*.

**T-219 raffine cette directive sans la contredire.** Le CP transite désormais par les serveurs TerrOir, mais aucune des contraintes substantielles n'est violée :

| Contrainte T-200 r1 | Statut sous T-219 |
|---|---|
| Pas de PII traversant serveur | ✅ Le CP français est une donnée publique INSEE, pas une PII. |
| Pas de log par-IP | ✅ Aucune colonne IP dans `geocode_cache`. Le rate-limit Upstash utilise l'IP comme clé éphémère (window 60s, purge automatique) sans persistance applicative. |
| Pas de profilage user | ✅ Aucune jointure `user→cp` côté DB. `hit_count` est un compteur agrégé anonyme. |
| Pas d'audit log applicatif | ✅ La route `/api/geocode` n'écrit AUCUNE ligne dans `audit_logs` (verrou explicite dans `tests/app/api/geocode/route.test.ts`). |

**Wording RGPD du `PrivacyNote` (DistanceWidget) mis à jour** pour refléter la nouvelle réalité technique : la position résultante reste dans le navigateur, mais la saisie d'un CP transite par le cache TerrOir avant l'appel à gouv.fr. Cf. T-207 (politique de confidentialité globale avant Live) — réintroduire un `<Link>` cliquable au moment de la livraison de la page, en intégrant le wording cache serveur.

---

## Schéma DB

Migration : `supabase/migrations/20260506181153_t219_geocode_cache.sql` (à appliquer **manuellement** via Supabase Studio ou MCP).

### Table `public.geocode_cache`

| Colonne | Type | Contrainte |
|---|---|---|
| `cp` | `VARCHAR(5)` | PRIMARY KEY, CHECK `^[0-9]{5}$` |
| `lat` | `NUMERIC(10,7)` | NOT NULL, CHECK `BETWEEN -90 AND 90` |
| `lng` | `NUMERIC(10,7)` | NOT NULL, CHECK `BETWEEN -180 AND 180` |
| `source` | `VARCHAR(50)` | DEFAULT `'api-adresse.data.gouv.fr'` |
| `resolved_at` | `TIMESTAMPTZ` | DEFAULT `NOW()`, **préservé sur UPSERT** |
| `hit_count` | `INTEGER` | DEFAULT 1, CHECK `> 0` |
| `last_hit_at` | `TIMESTAMPTZ` | DEFAULT `NOW()`, mis à jour sur chaque hit |

### Index

- `idx_geocode_cache_last_hit_at` (DESC) — top CP par activité récente.
- `idx_geocode_cache_hit_count` (DESC) — top CP par fréquence (analytics scaling).

### RLS

- `geocode_cache_public_read` : SELECT autorisé pour `anon` + `authenticated` (donnée publique INSEE).
- `geocode_cache_service_role_write` : ALL réservé `service_role` (le helper applicatif utilise `createSupabaseAdminClient`).

### RPC

- `bump_geocode_cache(p_cp)` → cache hit path, `UPDATE ... RETURNING lat, lng` atomique.
- `upsert_geocode_cache(p_cp, p_lat, p_lng, p_source)` → cache write path, `INSERT ... ON CONFLICT DO UPDATE` qui préserve `resolved_at`.

Les 2 RPC sont `SECURITY DEFINER` avec `search_path` épinglé (cohérent migration `rpc_lock_search_path_invoker_functions`). EXECUTE révoqué de PUBLIC, accordé uniquement à `service_role`.

---

## Helpers backend — `lib/geo/geocode-cache.ts`

```ts
getCachedGeocode(cp: string): Promise<{lat, lng} | null>
setCachedGeocode(cp, lat, lng, source?): Promise<boolean>
resolvePostalCode(cp, options?): Promise<ResolvePostalResult>
```

Validation CP via Zod (regex `^[0-9]{5}$` + trim). Tous les helpers retournent `null` / `false` plutôt que de jeter sur input invalide (fail-safe, cohérent avec le pattern `roundCoord` côté coords).

`resolvePostalCode` est l'orchestrateur unique consommé par la route :
1. Validation Zod CP (court-circuit avant tout I/O).
2. `bump_geocode_cache` → cache hit retourne `{cached: true, source: 'geocode_cache'}`.
3. `geocodePostalCode` → fetch `api-adresse.data.gouv.fr` (helper existant `lib/geo/geocode-postal.ts`).
4. `upsert_geocode_cache` (best-effort) → si DB échoue, ne casse pas la résolution courante (le caller a la réponse).

Aucun log applicatif par-IP / par-User. Le seul log côté helpers est `[GEOCODE_CACHE_*]` qui n'inclut que le CP saisi (donnée publique).

---

## Route serveur — `app/api/geocode/route.ts`

`GET /api/geocode?cp=XXXXX`

| Status | Body | Cas |
|---|---|---|
| 200 | `{ ok:true, lat, lng, cached, source }` + `Cache-Control: public, max-age=2592000` (30j) | Succès (cache hit ou miss + fetch OK). |
| 400 | `{ ok:false, code:"invalid_format" }` | CP non conforme regex `^[0-9]{5}$`. |
| 404 | `{ ok:false, code:"not_found" }` | CP introuvable côté gouv.fr. |
| 429 | `{ ok:false, code:"rate_limited" }` | Cap Upstash 30/min/IP atteint. |
| 502 | `{ ok:false, code:"upstream_unavailable" }` | gouv.fr down OU DB indisponible et cache miss. |

**Rate-limit** via `getGeocodeRateLimit()` (nouveau helper dans `lib/rate-limit.ts`) — 30 requêtes/60s par IP (slidingWindow Upstash). Fail-open si Upstash indispo. L'identifier IP est éphémère côté Upstash (purge automatique après window), pas tracé long terme côté DB.

**Cache HTTP 30 jours** sur les réponses 200 : defense in depth, le navigateur peut court-circuiter la route si le CP a déjà été résolu côté client. Cohérent avec la persistance permanente côté DB (les CP français ne bougent pas).

---

## Migration DistanceWidget client → serveur

`app/(public)/producteurs/[slug]/_components/DistanceWidget.tsx` — remplacement minimal :

```diff
- import { geocodePostalCode, GEOCODE_POSTAL_ERROR_MESSAGES } from "@/lib/geo/geocode-postal";
+ import { GEOCODE_POSTAL_ERROR_MESSAGES } from "@/lib/geo/geocode-postal";
+ import { geocodePostalCodeViaApi } from "@/lib/geo/geocode-postal-client";
...
- const result = await geocodePostalCode(postalInput);
+ const result = await geocodePostalCodeViaApi(postalInput);
```

UX préservée à l'identique (timeout 8s, validation regex côté composant, messages d'erreur typés). Deux nouveaux codes côté client (`rate_limited`, `upstream_unavailable`) propagés depuis la route ; messages FR ajoutés à `GEOCODE_POSTAL_ERROR_MESSAGES`.

`PrivacyNote` mis à jour pour refléter la nouvelle chaîne (CP transite par TerrOir avant gouv.fr, cache anonyme côté serveur). Cf. note RGPD ci-dessus pour la conformité T-200 r1.

### Sort de `lib/geo/geocode-postal.ts`

Conservé. Plus aucun appelant client après cette migration, mais reste utilisé côté serveur par `lib/geo/geocode-cache.ts:resolvePostalCode` sur le path cache miss (fetch direct gouv.fr). Suppression écartée — la séparation `geocode-postal` (low-level fetcher) / `geocode-postal-client` (helper navigateur via /api) / `geocode-cache` (orchestrateur serveur) reste lisible et testable indépendamment.

---

## Tests anti-régression

| Suite | Fichier | Couverture |
|---|---|---|
| Helper unitaire | `tests/lib/geo/geocode-cache.test.ts` (23 tests) | Cache hit/miss, Zod CP, UPSERT/bump RPC, validation lat/lng WGS84, fail-safe, contrat T-200 r1 (signatures sans IP/userId). |
| Route API | `tests/app/api/geocode/route.test.ts` (14 tests) | Validation CP querystring, cache hit/miss happy path, mapping erreurs → HTTP, rate-limit Upstash (429), Cache-Control 30j, **verrou anti-audit-log** (pas d'INSERT audit_logs). |
| Widget | `tests/app/producteurs/distance-widget.test.tsx` (existant, ajusté) | Wording RGPD `PrivacyNote` mis à jour T-219. |
| Helper gouv.fr | `tests/lib/geo/geocode-postal.test.ts` (existant, inchangé) | Pas modifié — le helper reste intact, juste plus appelé depuis le serveur uniquement. |

---

## Observabilité — requêtes SQL utiles

Top CP par fréquence (utile pour T-204 plan scaling, identification des CP hot) :
```sql
SELECT cp, hit_count, last_hit_at, resolved_at
  FROM public.geocode_cache
 ORDER BY hit_count DESC
 LIMIT 20;
```

CP cachés depuis longtemps mais inactifs (purge candidate si la table croît) :
```sql
SELECT cp, resolved_at, last_hit_at, hit_count
  FROM public.geocode_cache
 WHERE last_hit_at < NOW() - INTERVAL '6 months'
 ORDER BY last_hit_at ASC;
```

Taille / volume :
```sql
SELECT count(*) AS total_cps,
       sum(hit_count) AS total_hits,
       max(resolved_at) AS last_resolved
  FROM public.geocode_cache;
```

---

## Backlog associé

- **T-204** : ce cache amortit le scaling au-delà de la Sarthe ; reste à anticiper la bascule fournisseur (T-226 plan B) si gouv.fr devient instable.
- **T-226** : plan B fournisseur géocodage (BAN, Google Geocoding payant, MapBox). La colonne `source` dans `geocode_cache` permet d'isoler les entries par fournisseur si bascule.
- **T-207** : politique de confidentialité avant Live — réintroduire `<Link>` dans `PrivacyNote()` avec mention cache serveur intégrée.
- **T-237** : tests interactifs DistanceWidget (saisie CP, géoloc denied, etc.) — bénéficierait d'un mock de `/api/geocode` côté tests.

T-219 est partiellement clôturant pour T-204 (pas totalement — le plan B fournisseur reste ouvert).
