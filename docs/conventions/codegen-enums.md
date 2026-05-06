# Codegen TypeScript depuis migrations SQL — T-220

> Date : livré 2026-05-06 (T-220), doc consolidée 2026-05-07.
> Source unique de vérité : SQL (CHECK constraints + CREATE TYPE ENUM).
> Output généré : `lib/types/generated/enums.ts` (commit-tracked).

---

## Pourquoi

Avant T-220, plusieurs fichiers TS hardcodaient des valeurs d'enum (Zod schemas, UI radio, helpers). Toute migration SQL ajoutant/retirant une valeur exigeait une modif TS manuelle alignée — dérive silencieuse possible si oubli (cas T-243 documenté). Le codegen verrouille la cohérence : **un seul humain édite, l'autre est généré**.

## Comment

### Run le générateur

```bash
npm run codegen:enums           # write lib/types/generated/enums.ts
npm run codegen:enums:check     # exit 1 si fichier non synchronisé (CI guard)
```

Mode `--dry-run` disponible pour print stdout sans écrire.

### Workflow

1. Ajouter / modifier un CHECK constraint dans une migration `supabase/migrations/2026XXXXXXXXXX_*.sql`.
2. Run `npm run codegen:enums`.
3. Vérifier le diff dans `lib/types/generated/enums.ts`.
4. Stager les 2 fichiers (migration + generated) dans le même commit.
5. Le test parité TS↔SQL existant (`tests/lib/producers/score-carbone-enums.test.ts`) reste vert.

### Patterns SQL extraits

Le script supporte 4 patterns :

1. **Inline column CHECK** :
   ```sql
   col text check (col in ('a', 'b'))
   ```
2. **Named ADD CONSTRAINT** :
   ```sql
   alter table public.x add constraint x_y_check check (col in ('a', 'b'))
   ```
3. **Array subset CHECK** (text[] columns) :
   ```sql
   col text[] check (col <@ array['a', 'b']::text[])
   ```
4. **Nullable IN avec `is null or`** :
   ```sql
   check (col is null or col in ('a', 'b'))
   ```

### Stratégie de redéfinition (DROP + ADD)

Les migrations sont parsées dans l'ordre chronologique du nom de fichier (timestamp prefix). La **dernière** définition pour un `(table, column)` gagne. Les migrations qui DROP COLUMN suppriment l'entry — corrige le faux-positif `users.role` après le rename `role → roles`.

### Ce qui est généré

```typescript
// AUTO-GENERATED — DO NOT EDIT MANUALLY
export const PRODUCERS_ALIMENTATION_VALUES = ["pature_dominante", "mixte", "aliments_achetes"] as const;
export type ProducersAlimentation = (typeof PRODUCERS_ALIMENTATION_VALUES)[number];
```

### Ce qui n'est PAS généré (curated TS)

- **LABELS** / **PUBLIC_LABELS** (libellés humains) — restent dans `lib/producers/score-carbone-enums.ts` etc., car langage produit, pas DB.
- **HINTS** (phrases d'aide) — idem.
- **VERSION TAGS** (`v1.0`, `v1.1`) — restent curated dans `lib/producers/declaration-veracite.ts` (governance DGCCRF immuable, voir `wording-veracite-governance-2026-05-06.md`).

## Limitations connues V1

- Les CHECK pluri-colonnes (composite) ne sont pas extraits.
- Les CHECK bool de longueur / range numérique ne sont pas extraits (ex: `length(col) > 0`, `n > 0`).
- Les enums Postgres natifs (`CREATE TYPE x AS ENUM (...)`) sont supportés mais aucun n'est utilisé dans TerrOir aujourd'hui (convention CHECK constraint sur text).

## Intégration CI (à câbler T-296 ou pré-Live)

`npm run codegen:enums:check` à ajouter dans le script CI pour garantir qu'aucun PR ne merge avec un fichier généré désynchronisé.

## Références

- Script : `scripts/codegen-enums.ts` (commentaire de tête détaillé)
- Output : `lib/types/generated/enums.ts`
- Test parité : `tests/lib/producers/score-carbone-enums.test.ts`
- Versioning enums score carbone : `docs/conventions/versioning-enums-score-carbone-t243-2026-05-06.md`
- Doctrine wording immuable DGCCRF : `CLAUDE.md` (section "Doctrine wording certifié DGCCRF")
