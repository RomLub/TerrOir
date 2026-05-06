# Tests d'intégration SQL — convention T-296

Tests qui valident la logique métier déplacée en SQL (RPCs `SECURITY DEFINER`,
triggers, contraintes CHECK) contre une instance Postgres locale Supabase.

## Quand écrire un test ici

**Critère opposable** (cf. `docs/conventions/test-integration-sql.md`) : toute
logique métier déplacée en SQL doit avoir un test d'intégration ici. Exemples :

- RPC avec `CASE WHEN` non-trivial (ex: `update_producer_onboarding` T-241,
  décision de re-persistance des indicateurs DGCCRF côté SQL)
- Trigger avec règles métier (ex: `producers_block_owner_admin_columns` T-218)
- Contrainte CHECK (ex: `declaration_indicateurs_wording_version` T-292)

Tests Vitest classiques (mocks, unitaires) restent valides pour le code
applicatif TS. Cette stack ne les remplace pas — elle les complète pour la
couche SQL qui n'est pas testable autrement.

## Workflow local

Pré-requis : Docker installé.

```bash
# Démarre l'instance Supabase locale (~30s premier lancement)
npx supabase start

# Exécute uniquement les tests d'intégration SQL
npm run test:sql

# Arrêt
npx supabase stop
```

L'instance locale applique automatiquement toutes les migrations de
`supabase/migrations/` au démarrage — les tests s'exécutent contre le schéma
canonique du repo.

## Structure

- `helpers/client.ts` — Supabase client local (service_role) avec env vars
  pré-câblées sur les ports config.toml par défaut.
- `helpers/seed.ts` — utilitaires de seed/cleanup transactionnels par test.
- `*.test.ts` — un fichier par RPC/trigger/contrainte testée.

## Choix archi (rationale T-296)

Tranche `(a) Supabase CLI local + Vitest helpers` retenue plutôt que `(b)
pg_tap` car :

- Stack unifiée Vitest (un seul runner, mêmes patterns que les tests jsdom/node
  existants)
- Helpers TS factorisables, partageables avec les tests d'API existants qui
  appellent les mêmes RPCs côté serveur
- Latency Docker (~30s setup) acceptable pour des tests rares + opt-in (pas
  dans le hot loop dev)
- pg_tap aurait introduit une stack SQL séparée sans gain proportionnel au
  volume de tests prévu (RPCs métier, ~5-10 cibles initiales)
