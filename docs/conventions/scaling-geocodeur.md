# Scaling géocodeur — T-204 + T-226

> Date : 2026-05-07
> Tickets fusionnés : T-204 (anticipation scaling au-delà de la Sarthe) + T-226 (plan B fournisseurs)
> Statut actuel : `api-adresse.data.gouv.fr` + cache serveur `geocode_cache` (T-219) — suffisant pré-Live Sarthe (~50 producteurs)

---

## Stack actuelle

- **Géocodeur amont** : `https://api-adresse.data.gouv.fr/search/` (BAN — Base Adresse Nationale française).
- **Helper bas niveau** : `lib/geo/geocode-postal.ts` (fetch + parse + erreurs typées : `invalid_format` / `not_found` / `network` / `timeout`).
- **Cache serveur** : `lib/geo/geocode-cache.ts` (table `public.geocode_cache`, RPC `bump_geocode_cache` + `upsert_geocode_cache`, doctrine T-200 r1 anti-PII).
- **Orchestrateur** : `lib/geo/geocode-cache.ts::resolvePostalCode(cp)` — cache hit → bump RPC ; cache miss → fetch BAN + UPSERT.
- **Surface consommatrice** : `/api/geocode` (DistanceWidget consumer) + scripts batch (seed-producers).

## SLA et limites du fournisseur primaire

`api-adresse.data.gouv.fr` est un service public **sans engagement contractuel**. Spécifiquement :

- Pas de SLA disponibilité.
- Pas de quota d'usage documenté formellement (tolérance "raisonnable" ; rate-limit IP-based opaque, retours observés HTTP 429 au-delà de ~50 req/s).
- Pas de garantie de version d'API (mais stable historiquement depuis 2017).
- Pas de recours commercial en cas d'incident.

C'est acceptable tant que TerrOir reste un consumer modeste. Le cache `geocode_cache` (T-219) amortit fortement la pression : un CP populaire est résolu UNE fois puis ré-utilisé via RPC `bump_geocode_cache` (UPDATE atomique, ~5ms).

## Seuils de réévaluation

Faire pivoter le fournisseur (ou ajouter un fallback) si on franchit l'un de ces seuils :

| Seuil                                 | Action                                                          |
|---------------------------------------|-----------------------------------------------------------------|
| ~1500 producteurs Pays de la Loire    | Évaluer Plan B en double-write (primary BAN, secondary actif)   |
| Étendue France (10k+ producteurs)     | Bascule recommandée vers BAN auto-hébergée OU Google/MapBox     |
| Pic > 50 req/s observé en logs        | Plan B activé immédiatement (rate-limit BAN public dépassé)     |
| Incident BAN > 6h ou > 2 fois/an      | Plan B activé immédiatement                                     |

## Plan B fournisseurs (par ordre de préférence)

### 1. BAN auto-hébergée (préférée si France entière)

- **Source** : <https://adresse.data.gouv.fr/api> données ouvertes téléchargeables.
- **Stack possible** : conteneur Docker Addok (FOSS officiel BAN) sur VPS Hetzner / OVH (~10€/mois).
- **Avantages** : même schéma de réponse que api-adresse public, donc switch ~zéro côté code (juste l'URL change). Data ouverte, pas de quota, contrôle total.
- **Coûts** : VPS + maintenance (mises à jour mensuelles données BAN, ~2h/mois).
- **Quand basculer** : France entière OU > 100k requêtes/jour (cache amorti exclu).

### 2. Google Geocoding API (préférée si scale international ou stack mature)

- **Pricing** : $5 / 1000 requêtes (gratuit jusqu'à $200/mois ≈ 40k req/mois).
- **Avantages** : SLA 99.9%, couverture mondiale, support entreprise, qualité d'adresse supérieure aux étranger (Belgique, Suisse pour producteurs frontaliers).
- **Inconvénients** : doctrine T-200 r1 — Google Geocoding voit chaque CP requêté → IP du serveur Vercel + CP traversent un service externe US. À mitiger via cache plus agressif côté serveur (déjà en place) + requête par batch.
- **Quand basculer** : si scale > France OU si SLA contractuel devient un blocker légal/commercial.

### 3. MapBox Geocoding (alternative Google, RGPD-friendlier)

- **Pricing** : 100k req/mois gratuites, $0.50/1000 au-delà.
- **Avantages** : DPA RGPD signable, hébergement EU disponible, qualité comparable à Google sur la France.
- **Inconvénients** : couverture France métropolitaine moins fine que BAN sur lieux-dits ruraux.
- **Quand basculer** : alternative si Google bloque pour raison RGPD/légale.

## Pattern bascule fallback

Lors de l'introduction d'un secondaire, garder le primaire (BAN public) en première position. Pattern recommandé dans `lib/geo/geocode-postal.ts` :

```ts
async function geocodePostalCode(cp: string, opts) {
  try {
    return await fetchBAN(cp, opts);
  } catch (err) {
    if (isTransient(err)) {
      // Logue [GEOCODE_PRIMARY_FALLBACK] cp=<masked> reason=<...>
      return await fetchSecondary(cp, opts);
    }
    throw err;
  }
}
```

Le cache `geocode_cache` reste devant — primaire ET secondaire écrivent dans la même table avec une colonne `source` distincte (déjà présente, valeurs `api-adresse.data.gouv.fr` ou `mapbox` ou `google` ou `addok-self`). Permet de tracer la provenance et de purger sélectivement si un fournisseur a posté des coordonnées erronées.

## Métriques à surveiller post-Live

À implémenter (post-T-201/T-245/T-246 PostHog) — events agrégés anonymes, jamais par-CP :

- `geocode_resolution_total` (incrémente à chaque `resolvePostalCode`)
- `geocode_cache_hit_ratio` (ratio cached / non-cached, snapshot quotidien)
- `geocode_resolution_failed` (par code erreur typé : not_found / network / timeout / db_error)
- `geocode_resolution_latency_ms` (P50, P95, P99)

Aucune granularité par-CP / par-IP / par-user (doctrine T-200 r1 anti-PII).

Threshold d'alerte recommandé :

- cache_hit_ratio < 70% pendant > 24h → cache vide (purge accidentelle ou seed producteurs récent) ou montée en charge anormale.
- failed_ratio > 5% pendant > 1h → BAN dégradé, considérer activation Plan B.
- P95 latency > 2000ms pendant > 1h → BAN ralenti, considérer activation Plan B.

## Cache : TTL et purge

`geocode_cache` n'a actuellement pas de TTL applicatif — un CP résolu reste en cache indéfiniment. Justification :

- Les centroïdes CP français évoluent extrêmement lentement (révisions BAN annuelles ~marginales).
- Le cache miss est coûteux (1 round-trip BAN ~200-500ms) — on préfère un faux-positif rare (CP centroïde décalé de 50m) à des requêtes BAN inutiles.

Si jamais un CP doit être invalidé manuellement (ex: BAN a corrigé un centroïde aberrant), DELETE direct via SQL Studio :

```sql
DELETE FROM public.geocode_cache WHERE cp = '72000';
```

Le prochain `resolvePostalCode('72000')` re-fetchera BAN + UPSERT.

## Doctrine privacy maintenue

Quel que soit le fournisseur retenu :

- Pas de log par-IP côté serveur.
- Pas d'identification user→CP (table `geocode_cache` agrégée anonyme, `hit_count` compteur sans dimension user).
- Le CP français reste une donnée publique INSEE, pas une PII RGPD.
- Si bascule Google/MapBox : ajouter une mention dans `politique-confidentialite/page.tsx` (sous-traitant additionnel, doctrine RGPD).

## Références

- Migration T-219 : `supabase/migrations/2026050*_geocode_cache_*.sql`
- Helper bas niveau : `lib/geo/geocode-postal.ts`
- Cache + orchestrateur : `lib/geo/geocode-cache.ts`
- Doctrine T-200 r1 anti-PII : `CLAUDE.md` section privacy
- Décision PostHog post-T-201/T-245/T-246 : memory `project_event_tracking_archi.md`
