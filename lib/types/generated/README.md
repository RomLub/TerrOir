# lib/types/generated/

Fichiers TS auto-générés depuis le schéma SQL (`supabase/migrations/*.sql`). **Ne jamais éditer manuellement**.

## enums.ts

Source unique des valeurs d'enum applicatifs (CHECK constraints). Généré par `scripts/codegen-enums.ts` (cf. T-220).

### Workflow

1. **Modifier une valeur d'enum** : ajouter une migration SQL qui DROP + ADD la CHECK constraint avec les nouvelles valeurs (cf. `20260429010000_payouts_statut_enum_extend.sql` pour le pattern idempotent).
2. **Régénérer le fichier TS** :
   ```bash
   npm run codegen:enums
   ```
3. **Commit** le fichier `enums.ts` mis à jour avec la migration dans le même PR.

### Garde-fou CI

```bash
npm run codegen:enums:check
```

Lance le codegen en dry-run et **échoue** (exit 1) si `enums.ts` n'est pas synchronisé avec les migrations. À ajouter au pipeline pre-commit / CI pour empêcher un dev de merger une migration sans rejouer le codegen.

### Patterns SQL extraits

| Pattern SQL                                                    | Captured | Exemple                                                    |
|----------------------------------------------------------------|----------|------------------------------------------------------------|
| `col text check (col in ('a', 'b'))` (inline)                  | ✅       | `producers.type_production`                                |
| `add constraint x check (col in (...))` (named)                | ✅       | `producers.statut`                                         |
| `col text[] check (col <@ array['a', 'b']::text[])`            | ✅       | `producers.especes`, `users.roles`                         |
| `add constraint x check (col is null or col in (...))`         | ✅       | `reviews.producer_response_status`                         |
| `create type x as enum (...)` (Postgres native)                | ✅       | (aucun usage TerrOir aujourd'hui)                          |
| CHECK pluri-colonnes / numeric range / regex                   | ❌       | non extraits (ex: `note between 1 and 5`)                  |

### Évolution `users.role` → `users.roles`

Le codegen tracke aussi `DROP COLUMN`, donc le rename `role text → roles text[]` (migration `20260421100000`) est correctement reflété dans le fichier généré : seule la nouvelle entrée `users.roles` apparaît.

### Convention de nommage

| Élément       | Format                                       | Exemple                          |
|---------------|----------------------------------------------|----------------------------------|
| Constante     | `<TABLE>_<COLUMN>_VALUES`                    | `PRODUCERS_STATUT_VALUES`        |
| Type union    | `<Table><Column>` (PascalCase)               | `ProducersStatut`                |

Pour ré-exporter sous un nom local plus court (ex: `MODE_ELEVAGE_VALUES`), faire un alias dans le fichier consumer (cf. `lib/producers/score-carbone-enums.ts`).
