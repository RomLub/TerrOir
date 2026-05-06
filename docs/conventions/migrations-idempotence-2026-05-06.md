# Convention — idempotence des migrations Supabase

> Source canonique : ce document. Pattern instauré par **T-241** (`update_producer_onboarding`), confirmé par **T-218-bis** (lat/lng admin-only trigger), formalisé par **T-297** (cette doc).
>
> Session de création : 2026-05-06 (T-297). Articulation T-225 (workflow staging → prod, où l'idempotence est un pré-requis), T-296 (infra tests intégration SQL).

---

## Pourquoi cette convention

Une migration **idempotente** est une migration qu'on peut ré-exécuter N fois sans produire d'erreur ni d'effet de bord, à partir d'un état déjà migré. C'est un pré-requis pratique pour :

1. **Workflow staging → prod (T-225)** : la même migration est appliquée 2 fois (staging puis prod) ; en plus, staging peut être reset partiellement ou totalement entre deux PR — chaque migration doit pouvoir se ré-jouer dessus sans casser.
2. **Reprise post-incident** : si un apply prod échoue à mi-parcours (timeout, perte connexion), on doit pouvoir relancer la migration sans risque d'erreur « column already exists » ou « index already exists ».
3. **Initialisation d'un environnement local** : un dev qui fait `supabase db reset` re-joue toutes les migrations dans l'ordre, sur une base vide. Pas idempotent → risque de blocage à mi-chemin.
4. **Forward-compatibility hot-fix** : si un correctif urgent doit re-jouer une migration partiellement appliquée (ex. `132b469` apprentissage), l'idempotence garantit que le rejeu ne casse rien.

Coût d'écrire idempotent : ~30 secondes de plus par migration (3-4 caractères supplémentaires `IF NOT EXISTS`). Bénéfice : zéro recovery jamais perdu sur une race d'apply.

---

## Les 5 règles

### Règle 1 — `CREATE OR REPLACE FUNCTION`, jamais `DROP FUNCTION` + `CREATE FUNCTION`

**Bonne forme :**

```sql
create or replace function public.my_rpc(p_arg uuid)
returns void
language plpgsql
security definer
as $$
begin
  -- ...
end;
$$;
```

**Mauvaise forme :**

```sql
drop function if exists public.my_rpc(uuid);  -- ⚠️ NON
create function public.my_rpc(p_arg uuid) ... ;
```

**Pourquoi** : `DROP FUNCTION` casse les ACLs (`GRANT EXECUTE ...`) et les triggers qui pointent vers la fonction. Tous les `GRANT/REVOKE` doivent alors être ré-écrits dans la même migration. `OR REPLACE` préserve les ACLs et triggers — le contrat d'appel reste stable.

### Règle 2 — `ADD COLUMN IF NOT EXISTS` quand pertinent

**Bonne forme :**

```sql
alter table public.producers
  add column if not exists declaration_indicateurs_veracite_at timestamptz null;
```

**Mauvaise forme :**

```sql
alter table public.producers
  add column declaration_indicateurs_veracite_at timestamptz null;  -- ⚠️ NON
```

**Pourquoi** : si la migration est partiellement appliquée (la colonne existe déjà), le rejeu plante avec `column already exists`. Avec `IF NOT EXISTS`, le rejeu est un no-op.

**Cas particulier** : `ALTER COLUMN ... SET NOT NULL` ou `ALTER COLUMN ... SET DEFAULT` ne supportent pas `IF EXISTS` — ces ALTER sont par nature non idempotents si la valeur courante est différente. Pour les rendre idempotents, wrapper dans un bloc `do ... begin / exception when others then null; end;` OU découper en deux migrations (une qui ajoute la colonne nullable, une qui la passe NOT NULL après backfill).

### Règle 3 — `CREATE TABLE IF NOT EXISTS`

**Bonne forme :**

```sql
create table if not exists public.geocode_cache (
  cp text primary key,
  -- ...
);
```

**Mauvaise forme :**

```sql
create table public.geocode_cache ( ... );  -- ⚠️ NON
```

### Règle 4 — `CREATE INDEX IF NOT EXISTS`

**Bonne forme :**

```sql
create index if not exists idx_producers_slug on public.producers(slug);
```

**Mauvaise forme :**

```sql
create index idx_producers_slug on public.producers(slug);  -- ⚠️ NON
```

**Cas particulier** : `CREATE UNIQUE INDEX ... CONCURRENTLY` — supporte `IF NOT EXISTS` côté PostgreSQL ≥ 9.5. Toujours utilisable en prod TerrOir (Supabase Postgres ≥ 15).

### Règle 5 — `DROP POLICY IF EXISTS` avant `CREATE POLICY`

**Bonne forme :**

```sql
drop policy if exists "producers_self_read" on public.producers;
create policy "producers_self_read" on public.producers
  for select to authenticated using (user_id = auth.uid());
```

**Mauvaise forme :**

```sql
create policy "producers_self_read" on public.producers ...;  -- ⚠️ NON
```

**Pourquoi** : `CREATE POLICY` ne supporte pas `IF NOT EXISTS` ni `OR REPLACE` (limitation Postgres). Le pattern `DROP POLICY IF EXISTS` + `CREATE POLICY` reproduit la sémantique idempotente.

**Cas particulier** : si la policy n'a pas changé entre deux versions, on peut omettre le DROP+CREATE (la policy existante reste valide). Mais dès qu'une policy est modifiée (USING, WITH CHECK, FOR, TO), pattern DROP+CREATE obligatoire.

---

## Audit migrations existantes (état 2026-05-06)

> 76 migrations dans `supabase/migrations/`. L'audit ci-dessous identifie les migrations historiques **non conformes** aux 5 règles. **Pas de rétrofit** sur les migrations déjà applied prod (forward-only) — l'audit sert à durcir les migrations futures.

### Règle 1 — `CREATE OR REPLACE FUNCTION`

| Statut | Nb | Détail |
|---|---|---|
| ✅ Conforme (`CREATE OR REPLACE FUNCTION`) | 35 | Pattern dominant. |
| ⚠️ Non conforme (`CREATE FUNCTION` sans `OR REPLACE`) | 3 | `20260421000000_search_producers_product_count.sql`, `20260505300400_perf_search_producers_cte.sql`, `20260505300500_perf_search_producers_cte_fix_statut.sql`. |

Les 3 non-conformes sont des migrations `search_producers` itératives (création initiale + 2 itérations perf). En pratique, chaque itération a été précédée par un `DROP FUNCTION` implicite via Postgres (signature inchangée → REPLACE OK), ou les migrations ne se rejouaient pas (forward-only). **Statut acceptable post-hoc.**

### Règle 2 — `ADD COLUMN IF NOT EXISTS`

| Statut | Nb | Détail |
|---|---|---|
| ✅ Conforme | 100 % | Aucun `ADD COLUMN` sans `IF NOT EXISTS` détecté. |

### Règle 3 — `CREATE TABLE IF NOT EXISTS`

| Statut | Nb | Détail |
|---|---|---|
| Migrations contenant `CREATE TABLE` | 15 | Mélange conforme / non conforme — vérification au cas par cas. |

L'audit grossier ne distingue pas les `CREATE TABLE IF NOT EXISTS` des `CREATE TABLE` simples. À durcir lors d'un audit fin si T-225 est activé. Forward-only acceptable en l'état (aucune table existante n'est ré-créée par les migrations).

### Règle 4 — `CREATE INDEX IF NOT EXISTS`

| Statut | Nb | Détail |
|---|---|---|
| Migrations contenant `CREATE INDEX` | 21 | Mélange conforme / non conforme — vérification au cas par cas. |

Idem règle 3 — audit fin non bloquant tant que les migrations ne sont pas re-jouées.

### Règle 5 — `DROP POLICY IF EXISTS` + `CREATE POLICY`

| Statut | Nb | Détail |
|---|---|---|
| ✅ Conforme (DROP + CREATE) | 17 | Pattern instauré par les audits RLS lots 1-8 (mai 2026). |
| ⚠️ Non conforme (CREATE seul) | 3 | `20260419000000_initial_schema.sql`, `20260419010000_producer_invitations.sql`, `20260421100000_cumulative_roles_admin_users.sql`. |

Les 3 non-conformes sont des migrations historiques (initial schema + producer invitations + cumulative roles) qui datent d'avant l'instauration du pattern. **Statut acceptable post-hoc** car re-jouer ces migrations sur une base vide ne pose pas de problème (les policies n'existent pas encore). Le risque émerge UNIQUEMENT si quelqu'un re-joue ces migrations sur une base où les policies existent déjà — ce qui ne se produit pas en pratique (Supabase track les migrations applied dans `supabase_migrations.schema_migrations`).

---

## Verdict global

- **Migrations forward-only** : aucun retrofit nécessaire, le tracking Supabase empêche le rejeu sur des objets existants.
- **Migrations futures** : la convention 5 règles est désormais **opposable**. Toute nouvelle migration livrée par CC ou Romain doit la respecter.
- **Cas marginal staging reset** : si T-225 est activé et que staging est régulièrement reset à zéro, la migration `20260419000000_initial_schema.sql` (et compagnes) s'exécutent sur une base vide → pas de problème pratique.
- **Pas de rétrofit des 6 migrations non-conformes** (3 fonctions + 3 policies) : le coût (modification d'historique git pour des migrations déjà applied) est supérieur au bénéfice.

---

## Articulation autres chantiers

- **T-225** (livré dans la même session) — workflow staging → prod, où l'idempotence est un pré-requis pratique.
- **T-296** (backlog) — infra tests intégration SQL, qui pourrait re-jouer les migrations contre Postgres en CI.
- **Apprentissage incident `132b469`** — quasi-incident où on a frôlé le rejeu manuel d'une migration partiellement applied. La convention idempotence couvre ce risque.

---

## Liens

- `supabase/migrations/` — répertoire des migrations historiques.
- Postgres docs — [`CREATE OR REPLACE FUNCTION`](https://www.postgresql.org/docs/current/sql-createfunction.html).
- Postgres docs — [`IF NOT EXISTS` clauses](https://www.postgresql.org/docs/current/sql-altertable.html).
- Supabase docs — [Migrations](https://supabase.com/docs/guides/cli/local-development#database-migrations).
