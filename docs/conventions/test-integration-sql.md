# Convention — Tests d'intégration SQL (T-296)

Date : 2026-05-07
Cycle : 2026-05-07 (Agent Teams Teammate F design-system)

## Règle opposable

**Toute logique métier déplacée en SQL doit avoir un test d'intégration**
dans `tests/sql-integration/` qui s'exécute contre une instance Supabase
locale (Docker via `supabase start`).

"Logique métier en SQL" couvre :

- RPCs `SECURITY DEFINER` avec branchements non-triviaux (`CASE WHEN`,
  `IF/THEN/ELSE`) — exemple : `update_producer_onboarding` (T-241,
  décision de re-persistance des indicateurs DGCCRF), `update_producer_indicateurs`
  (T-232, sémantique miroir post-onboarding).
- Triggers avec règles métier — exemple : `producers_block_owner_admin_columns`
  (T-218, blocage 25 colonnes admin-only sur self-update).
- Contraintes CHECK (whitelist enums versionnés) — exemple :
  `declaration_indicateurs_wording_version` (T-292).

Les tests Vitest classiques (env=node ou jsdom, mocks Supabase queue)
**restent valides et préférés** pour le code applicatif TS — ils sont rapides
et n'ont pas besoin de Docker. Cette convention ajoute une couche de validation
pour la couche SQL qui n'est pas testable autrement.

## Stack retenue (rationale T-296)

**(a) Supabase CLI local + Vitest helpers** — choisie plutôt que (b) pg_tap :

| Critère | (a) Supabase CLI + Vitest | (b) pg_tap |
|---|---|---|
| Stack | Unifiée (Vitest partout) | Séparée (SQL pur) |
| Apprentissage | Réutilise patterns repo | Nouvelle stack à former |
| Helpers TS | Factorisables avec tests API | Non |
| Latency | ~30s setup Docker | ~5s mais Docker requis aussi |
| Volume futur | OK pour 5–20 cibles initiales | Plus efficace si >50 |
| CI | Workflow GitHub Actions standard | Idem mais moins documenté |

À reconsidérer si volume tests SQL >50 ou si la maintenance des helpers TS
devient lourde — pg_tap reste une option valide.

## Workflow local

```bash
# Démarre l'instance Supabase locale (Docker requis)
npx supabase start

# Run les tests SQL (skip propre si instance non joignable)
npm run test:sql

# Stop
npx supabase stop
```

L'instance locale applique automatiquement les migrations `supabase/migrations/`
au démarrage — les tests s'exécutent contre le schéma canonique du repo.

## Workflow CI (à formaliser)

Pas encore de `.github/workflows/` dans le repo. Quand un workflow CI sera
mis en place (post-Live ou pré-Live selon priorité), ajouter un job dédié :

```yaml
test-sql:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
    - uses: supabase/setup-cli@v1
    - run: supabase start
    - run: npm ci
    - run: npm run test:sql
    - run: supabase stop
```

## Structure conventions

- `tests/sql-integration/helpers/client.ts` — Supabase client local
  (service_role) avec env vars + skip propre si non joignable.
- `tests/sql-integration/helpers/seed.ts` — utilitaires seed/cleanup
  transactionnels par test.
- `tests/sql-integration/<rpc-ou-trigger>.test.ts` — un fichier par cible.
- `vitest.sql.config.ts` — config dédiée (pas de transform JSX, pas de
  setup mock server-only, fileParallelism=false).

## Smoke tests post-apply (rappel doctrine CLAUDE.md)

Cette convention **ne remplace pas** les smoke tests post-apply documentés
dans CLAUDE.md (test cas nominal + cas d'erreur + bypass service_role
si pertinent). Elle les **complète** en posant un filet de sécurité
exécutable répétitif.

## Cibles backlog (ordre de priorité)

1. `update_producer_onboarding` (T-241+T-243, 16 args) — **pilote livré**
2. `update_producer_indicateurs` (T-232, 7 args, sémantique miroir)
3. Trigger `producers_block_owner_admin_columns` (T-218, blocage 25 cols)
4. CHECK `declaration_indicateurs_wording_version` (T-292)
5. RPC `delete_user_account` (RGPD, suppression cascade)
