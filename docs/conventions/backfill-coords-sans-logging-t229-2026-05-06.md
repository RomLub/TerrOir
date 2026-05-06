# Backfill data privacy-aware sans logging d'adresses — convention T-229 (2026-05-06)

## Objectif

Standardiser la procédure de backfill des champs sensibles producteur
(adresses, lat/lng précis, identifiants tiers, etc.) en préservant la
doctrine privacy T-200 r1 :

- Pas de log adresse complète dans les outputs intermédiaires (script
  bash output, terminal output, fichiers persistants).
- Pas de PII traversant les services externes inutilement (limiter les
  appels API tiers au strict nécessaire).
- Pas de table d'audit per-IP côté serveur pour l'opération de backfill
  elle-même.

Convention opposable pour tous les backfills futurs touchant producteurs,
consumers, orders, ou toute donnée susceptible d'être PII. Cas d'usage
fondateur : T-202 (backfill lat/lng pré-Live).

## Principes

### 1. Pas de script Git versionné contenant des adresses

Toute opération backfill avec adresses doit :
- Soit utiliser des **valeurs littérales** dans le SQL/script
  (ex. coordonnées centroïdes pré-calculées, pas l'adresse source).
- Soit se faire via un **calcul éphémère in-process** sans persister
  l'adresse intermédiaire.
- Soit utiliser un **script ad-hoc one-shot** dans `.tmp/` (NON commit
  via `.gitignore`).

Exemple de violation : commit d'un script avec `const ADRESSES = [{ id, adresse: "12 rue ..." }, ...]`.

### 2. Logs script = id + résultat seulement

Outputs autorisés en console pendant l'exécution :
- ID interne du producteur/consumer/order.
- CP (5 chiffres, donnée publique INSEE) si nécessaire au contexte.
- Coordonnées résultantes (lat/lng).
- Statut booléen succès/échec.

Outputs INTERDITS :
- Adresse complète.
- Email producteur/consumer.
- Téléphone.
- Nom propre identifiant.

### 3. Choix script TS vs migration SQL

| Critère | Migration SQL versionnée | Script ad-hoc `.tmp/` ou MCP direct |
|---------|--------------------------|-------------------------------------|
| Adresses littérales nécessaires | Acceptable si valeurs PUBLIQUES (centroïdes commune, codes INSEE) | Si adresses privées : forcément ad-hoc |
| Reproductibilité audit | Oui (migration commit) | Non (one-shot) |
| Réutilisable autres environnements | Oui | Non |
| Simplicité | Privilégier dès que possible | Si besoin de fetch tiers ou logique complexe |

**Règle simple** : si le backfill peut être exprimé par un SQL avec
des valeurs littérales NON-PII, écrire une migration. Si le backfill
nécessite un fetch tiers (géocodage, vérif SIRET, etc.) ou contient
des valeurs PII, faire un script ad-hoc.

### 4. Bypass trigger admin-only via service_role

Les colonnes sensibles producteur sont protégées par le trigger
`producers_block_owner_admin_columns` (T-218 + T-218-bis) qui bloque
toute UPDATE non-admin sur 25+ colonnes. Pour bypass légitimement
en script de backfill, il faut soit :

- Appeler via le **client Supabase admin** (`createSupabaseAdminClient()`)
  qui injecte le rôle service_role.
- En SQL direct via MCP, **double set** :
  ```sql
  SET LOCAL ROLE service_role;
  SET LOCAL request.jwt.claim.role TO 'service_role';
  ```
  Le second `SET LOCAL` est nécessaire car le trigger compare
  `auth.role()` qui lit `current_setting('request.jwt.claim.role')`,
  pas `current_user`. Sans ça, le trigger bloque même sous SET ROLE
  (cf. doctrine CLAUDE.md « le superuser SQL Studio sans SET ROLE
  service_role ne bypass pas le trigger T-218 »).

### 5. Smoke test post-apply standard

Toujours suivre l'UPDATE par un SELECT count vérifiant la cible :

```sql
SELECT 
  COUNT(*) FILTER (WHERE <champ_cible> IS NULL AND <filtre_pertinence>) AS reste_a_traiter,
  COUNT(*) FILTER (WHERE <champ_cible> IS NOT NULL) AS total_traites,
  COUNT(*) AS total_eligibles
FROM <table>;
```

Documenter la valeur AVANT et APRÈS dans le rapport `docs/fixes/`.

## Workflow recommandé

1. **Inventaire** : SELECT lecture seule via MCP pour identifier les
   cibles + récupérer les minimaux nécessaires (CP, ID).
2. **Plan** : décider script SQL vs script ad-hoc selon critères §3.
3. **Si fetch tiers** : faire les fetchs séparément (curl/script TS),
   collecter les résultats sans logger les adresses sources.
4. **UPDATE** :
   - Migration SQL : valeurs littérales centroïdes, jamais d'adresses.
   - Script ad-hoc dans `.tmp/` : utiliser les variables JS éphémères,
     ne JAMAIS console.log l'adresse complète.
   - MCP direct : transaction avec SET LOCAL ROLE + SET LOCAL claim.
5. **Smoke test** : count cible AVANT/APRÈS.
6. **Rapport** : `docs/fixes/<nom>-T-XXX-<date>.md` avec :
   - IDs traités (placeholders `<CP>`, jamais d'adresse).
   - Résultats smoke test.
   - Source de géocodage / méthode.
   - Producteurs skippés (cas non-géocodables).
7. **Push doc** uniquement (pas le script `.tmp/`).

## Cas T-202 (référence)

Cf. `docs/fixes/backfill-lat-lng-T-202-2026-05-06.md` pour l'application
complète :
- 3 producteurs backfillés (2 active + 1 pending bonus).
- 1 producteur skippé (non-géocodable).
- Géocodage centroïde commune via `api-adresse.data.gouv.fr` (3 fetchs).
- UPDATE direct via MCP service_role (pas de fichier `.tmp/` créé car
  3 UPDATEs simples).
- Smoke test : `active_sans_coords` 2 → 0.

## Articulation autres conventions

- **T-200 r1** (privacy doctrine) : pas de log par-IP côté serveur, pas
  de PII traversant services externes. Cette convention T-229 en est
  une déclinaison opérationnelle pour les opérations de backfill.
- **T-218** (trigger admin-only) : la doctrine bypass via
  `SET LOCAL request.jwt.claim.role` est une conséquence directe de la
  protection T-218 qui distingue `auth.role()` de `current_user`.
- **T-225** (workflow staging→prod) : tant que pas de staging Supabase,
  les backfills se font direct prod via MCP. À reconsidérer post-Live.
- **T-297** (idempotence migrations) : les backfills SQL versionnés
  doivent respecter la convention idempotence (forward-only,
  `IF NOT EXISTS`, etc.).

## Références

- Cas T-202 : `docs/fixes/backfill-lat-lng-T-202-2026-05-06.md`
- Doctrine privacy : `CLAUDE.md` § « Doctrine privacy »
- Trigger T-218 : `supabase/migrations/20260506165934_t218_producers_owner_update_block_admin_columns.sql`
- Trigger T-218-bis lat/lng : `supabase/migrations/20260506172633_t218_bis_lat_lng_admin_only.sql`
- Helper géocodage : `lib/geo/geocode-postal.ts`
- Floutage runtime coords : `lib/producers/coords.ts`
- Convention idempotence : `docs/conventions/migrations-idempotence-2026-05-06.md`
- Workflow staging→prod (futur) : `docs/conventions/supabase-migrations-staging-prod-workflow-2026-05-06.md`
