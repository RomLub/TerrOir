# Codegen TS depuis migrations SQL — T-220

> Date : 2026-05-06
> Branche : master
> Tickets : T-220 (codegen enums TS depuis SQL)

---

## Contexte

Avant T-220, chaque enum applicatif (statut producteur, type production, mode élevage, etc.) était déclaré deux fois :
- Côté SQL via une CHECK constraint dans une migration `supabase/migrations/*.sql`.
- Côté TS via un `*_VALUES = [...] as const` ou un `z.enum([...])`.

Les deux pouvaient diverger silencieusement : ajouter une valeur SQL sans toucher au TS produisait un INSERT runtime accepté côté DB mais rejeté par Zod côté form (ou pire, ignoré côté UI radio sans erreur). Le test de parité existant `tests/lib/producers/score-carbone-enums.test.ts` (T-200) couvrait UNIQUEMENT 3 enums (mode_elevage, alimentation, densite_animale) en parsant un fichier de migration spécifique. Pas généralisable aux 23 autres enums du projet.

T-220 généralise : **un seul script codegen** scanne TOUTES les migrations, extrait TOUS les enums, et génère `lib/types/generated/enums.ts` (single source of truth). Un test de parité bloque le merge si le fichier généré dévie.

## Décisions

### Patterns SQL extraits

26 enums extraits depuis `supabase/migrations/*.sql` (vs 26 confirmés dans la DB) :

- **23 enums simples** via `col text check (col in ('a', 'b', ...))` ou `add constraint x check (col in (...))`. Couvre les statuts (orders, payouts, producers, refund_incidents, reviews, producer_interests, disputes, notifications), les types (notifications.type, products.unite, gms_prices.filiere), les énumérations métier (forme_juridique, type_production, mode_elevage, alimentation, densite_animale, abonnement_niveau, kind…).
- **3 enums array subset** via `col text[] check (col <@ array[...]::text[])` : `producers.especes`, `producers.labels`, `users.roles`.
- **0 enum Postgres natif** (`CREATE TYPE ... AS ENUM`) — convention TerrOir = CHECK uniquement.

### Stratégie de tracking des migrations

Les migrations sont parsées dans l'ordre chronologique du nom de fichier (timestamp YYYYMMDDhhmmss). La **dernière définition** par `(table, column)` gagne. Les `DROP COLUMN` suppriment l'entrée de la map d'accumulation — fix le faux-positif `users.role` qui aurait persisté après le rename `role text → roles text[]` (migration `20260421100000_cumulative_roles_admin_users.sql`).

Pattern idempotent attendu côté migration pour modifier un enum :
```sql
do $$
declare c_name text;
begin
  for c_name in
    select conname from pg_constraint
    where conrelid = 'public.x'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%col%'
  loop
    execute format('alter table public.x drop constraint %I', c_name);
  end loop;
end $$;

alter table public.x add constraint x_col_check check (col in ('a', 'b', 'c'));
```

Cf. `20260421300000_producer_statut_draft_public.sql` et `20260429010000_payouts_statut_enum_extend.sql` pour les références canoniques.

### Format de sortie TS

```ts
// AUTO-GENERATED — DO NOT EDIT MANUALLY
// Source: supabase/migrations/*.sql

// producers.statut (source: in, last migration: 20260422200000_rgpd_account_deletion.sql)
export const PRODUCERS_STATUT_VALUES = ["draft", "pending", "active", "public", "suspended", "deleted"] as const;
export type ProducersStatut = (typeof PRODUCERS_STATUT_VALUES)[number];
```

Convention :
- Constante : `<TABLE>_<COLUMN>_VALUES` (SCREAMING_SNAKE).
- Type union : `<Table><Column>` (PascalCase).

Pour ré-exporter sous un alias plus court (ex: `MODE_ELEVAGE_VALUES`), faire une simple ré-export typée dans le fichier consumer (cf. `lib/producers/score-carbone-enums.ts`).

### Garde-fou de drift TS↔SQL

Deux mécanismes complémentaires :

1. **CI flag** : `npm run codegen:enums:check` lance le codegen en dry-run et exit 1 si le fichier généré dévie de ce qui est commité. À ajouter au pipeline CI / pre-commit hook.
2. **Vitest parité** : `tests/scripts/codegen-enums.test.ts` re-joue la logique du codegen sur les migrations actuelles et compare au fichier checked-in. Casse en CI standard (vitest run) si désynchronisé.

Le test parité historique T-200 (`score-carbone-enums.test.ts`) reste en place et passe : il valide que les 3 enums score-carbone correspondent à leur migration source via un parser ad hoc (orthogonal au codegen, double-check sain).

### Migration des call sites

V1 limitée — seul `lib/producers/score-carbone-enums.ts` est migré comme proof of concept :
```ts
// AVANT
export const MODE_ELEVAGE_VALUES = ["plein_air", ...] as const;
export type ModeElevage = (typeof MODE_ELEVAGE_VALUES)[number];

// APRÈS (T-220)
import {
  PRODUCERS_MODE_ELEVAGE_VALUES,
  type ProducersModeElevage,
} from "@/lib/types/generated/enums";

export const MODE_ELEVAGE_VALUES = PRODUCERS_MODE_ELEVAGE_VALUES;
export type ModeElevage = ProducersModeElevage;
```

LABELS / PUBLIC_LABELS / HINTS restent côté `score-carbone-enums.ts` (ils sont curated côté produit, pas en DB). Les autres call sites (`lib/auth/validators.ts` z.enum, etc.) restent inchangés en V1 — leur migration sera incrémentale selon le besoin (ajouter un enum value côté SQL → regen → consumer cassera à la compile s'il dépend d'une valeur retirée).

## Fichiers touchés

### Nouveaux

- **`scripts/codegen-enums.ts`** — script CLI extracting enums depuis migrations.
- **`lib/types/generated/enums.ts`** — fichier auto-généré (26 enums, ~80 lignes).
- **`lib/types/generated/README.md`** — doc workflow + patterns supportés.
- **`tests/scripts/codegen-enums.test.ts`** — 19 tests (parser + parité fichier ↔ migrations actuelles).
- **`docs/fixes/codegen-enums-2026-05-06.md`** — ce document.

### Modifiés

- **`package.json`** — `codegen:enums` (write) + `codegen:enums:check` (CI guard).
- **`lib/producers/score-carbone-enums.ts`** — VALUES + types ré-exportés depuis le fichier généré (proof of concept). Labels / Hints inchangés.

## Vérifications

- `npx tsc --noEmit` → exit 0.
- `npx vitest run` → 1930 tests passés (vs 1911 baseline T-080).
- `npm run codegen:enums` → 26 enums générés.
- `npm run codegen:enums:check` → exit 0 (synchronisé).
- DB : SELECT du `pg_constraint` confirme 23 enums simples + 3 array subset = **26**, identique au codegen.

## Évolutions possibles

- **CI hook** : ajouter `npm run codegen:enums:check` au pipeline GitHub Actions / Vercel pre-build pour bloquer un PR qui aurait modifié `supabase/migrations/*.sql` sans rejouer le codegen. Aujourd'hui le test vitest le couvre déjà mais un check séparé pré-build serait plus rapide en feedback.
- **Migration call sites étendue** : remplacer les `z.enum([...])` hardcodés (`lib/auth/validators.ts` formeJuridiqueEnum, typeProductionEnum) par construction depuis `*_VALUES` générés. Demande une refacto Zod (`z.enum(VALUES as unknown as [string, ...string[]])`) — déjà fait pour modeElevageEnum / alimentationEnum / densiteAnimaleEnum dans `validators.ts`.
- **Pattern range / numeric** : aujourd'hui `note between 1 and 5` n'est pas extrait. Pas en scope T-220 (ce n'est pas un enum stricto sensu) — V2 si besoin de générer des bornes numériques pour Zod.
- **Postgres native ENUM** : si TerrOir migre une colonne vers `CREATE TYPE x AS ENUM`, le codegen le supportera (regex prête, tests covers).
