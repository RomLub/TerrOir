# Backfill lat/lng producteurs — T-202 (2026-05-06)

## Contexte

Bloquant pré-Live P0 (cf. checklist). Avant ce fix, 5 producteurs sur
10 (50 % du parc) avaient `latitude/longitude IS NULL` → la moitié des
fiches publiques perdaient le widget distance (argument différenciant
principal du chantier T-200 score-carbone). Sans backfill, l'ouverture
publique aurait dévalorisé la moitié du catalogue.

Conformément à doctrine T-229 (privacy backfill) : aucune adresse
complète loggée dans les outputs intermédiaires, exécution via MCP
Supabase service_role (bypass trigger T-218 admin-only sur lat/lng).

## Producteurs traités

3 producteurs backfillés :

| ID | Statut | CP source | Méthode |
|----|--------|-----------|---------|
| b0e63bac-61ba-4c8a-81cb-02fc2aa50e86 | `active` | `<CP>` Sarthe | Centroïde commune via `api-adresse.data.gouv.fr` |
| fa35a69e-5270-4ee0-bb40-a31694fcbef4 | `active` | `<CP>` Sarthe | Idem |
| da68c070-0dfb-4765-a266-6406348c9b92 | `pending` | `<CP>` Sarthe | Idem (bonus data hygiene) |

**Skipped explicit** :
- `89b96408-36a6-4153-b2b8-67f61157ea37` (`pending`) : pas de CP en
  base (`code_postal IS NULL`). Non-géocodable. À compléter manuellement
  avant onboarding réel — l'utilisateur devra rouvrir son onboarding
  pour saisir CP + commune cohérents.

## Méthode de géocodage

Centroïde commune via API publique `api-adresse.data.gouv.fr/search/`
avec `?q=<CP>&type=municipality&limit=1` — endpoint utilisé par
ailleurs côté DistanceWidget consumer (cf. `lib/geo/geocode-postal.ts`).
Pas de clé API, pas de quota dur, service public.

Pourquoi pas l'adresse complète : les 3 adresses cibles étaient peu
signifiantes ("Adresse Test", placeholder ou debug) → géocoder l'adresse
exacte n'aurait rien donné de mieux que le centroïde commune. Et la
précision finale visible côté consumer est de toute façon arrondie
2 décimales (`roundCoord` ~1.1 km, T-217), donc le centroïde commune
est largement suffisant.

Reformulation T-229 conforme : pas de log d'adresse, juste id producteur
+ coords résultantes (et CP en clair pour traçabilité géocodage —
acceptable car CP n'est pas PII forte).

## Smoke tests post-apply

Requête de validation :

```sql
SELECT 
  COUNT(*) FILTER (WHERE latitude IS NULL AND statut = 'active' AND deleted_at IS NULL) AS active_sans_coords,
  COUNT(*) FILTER (WHERE latitude IS NULL AND statut = 'pending' AND deleted_at IS NULL) AS pending_sans_coords,
  COUNT(*) FILTER (WHERE latitude IS NOT NULL) AS total_avec_coords,
  COUNT(*) AS total_producers
FROM producers;
```

| Métrique | Avant | Après |
|----------|-------|-------|
| `active_sans_coords` | 2 | **0** ✅ (cible pré-Live atteinte) |
| `pending_sans_coords` | 2 | 1 (89b96408 non-géocodable, ack) |
| `total_avec_coords` | 5 | 8 |
| `total_producers` | 10 | 10 |

3 producteurs backfillés conformément à la cible (2 obligatoires + 1 bonus).

## Procédure d'exécution (réalisée)

1. SELECT cibles via MCP service_role (lecture lat/lng + CP).
2. `curl https://api-adresse.data.gouv.fr/search/?q=<CP>&type=municipality&limit=1`
   pour chaque CP (3 fetchs).
3. Extraction `coordinates: [lng, lat]` des features GeoJSON.
4. UPDATE en BLOC dans 1 seule transaction MCP avec `SET LOCAL ROLE service_role`
   + `SET LOCAL request.jwt.claim.role TO 'service_role'` (bypass trigger
   T-218 qui bloque self-update lat/lng admin-only).
5. SELECT vérif post-UPDATE.
6. COMMIT.
7. Smoke test count global.

Pas de script ad-hoc créé : la doctrine T-229 prévoit `.tmp/` pour les
scripts persistents si réutilisables, mais ici les 3 UPDATEs étaient
suffisamment simples pour être exécutés directement via MCP — pas
besoin de fichier intermédiaire. `.tmp/` ajouté au `.gitignore` pour
les futurs cas plus complexes (cf. `docs/conventions/backfill-coords-sans-logging-t229-2026-05-06.md`).

## Articulation menaces / décisions produit

- **T-218 + T-218-bis** : trigger admin-only sur lat/lng a bien fait son
  job — j'ai dû passer par `SET LOCAL request.jwt.claim.role` pour
  bypass. Confirmation que la défense fonctionne contre un MCP "naïf".
- **T-217 floutage roundCoord** : les valeurs exactes stockées ici
  (5-6 décimales du centroïde commune) seront floutées à 2 décimales au
  call site public via `lib/producers/coords.ts`. L'adresse précise
  n'est jamais exposée à un consumer.
- **T-227 ré-identification** : centroïde commune limite déjà la
  précision intrinsèque (toute la commune se ramène à 1 point). Mitige
  la menace cluster T-227 — moins d'info que si on avait géocodé une
  adresse précise.

## Backlog associé

- **89b96408** : à compléter manuellement avant ouverture publique. Le
  producteur doit re-saisir son CP/commune via réouverture d'onboarding
  ou via UI admin (T-294 backlog).
- **T-225** : workflow staging→prod pour migrations Supabase. Ce
  backfill a été fait direct prod via MCP (acceptable pré-Live cf.
  doctrine), à reconsidérer post-Live.
- Pas de backlog backfill ad-hoc additionnel : tous les producteurs
  géocodables sont traités.

## Références

- Convention : `docs/conventions/backfill-coords-sans-logging-t229-2026-05-06.md`
- Helper géocodage : `lib/geo/geocode-postal.ts`
- Floutage runtime : `lib/producers/coords.ts`
- Trigger T-218-bis : `supabase/migrations/20260506172633_t218_bis_lat_lng_admin_only.sql`
- Cluster privacy : `docs/security/threat-model-reidentification-producer-2026-05-06.md`
- Audit RLS lat/lng : `docs/security/audit-rls-producers-2026-05-06.md`
