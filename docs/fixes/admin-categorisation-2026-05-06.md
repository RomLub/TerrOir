# /admin/categorisation — UI CRUD catégorisation produits — T-130

> Date : 2026-05-06
> Branche : master
> Tickets : T-130 (chantier ouvert dans cette session)
> Chantier parent : T-220 PR-A (DB livrée 2026-05-01)

---

## Contexte — l'audit a invalidé la prémisse du spec initial

Le spec de session démarrait sur l'hypothèse « TerrOir n'a pas de système de catégorisation produits structuré ». **L'audit LOT 0 a montré le contraire** : le chantier T-220 PR-A (`supabase/migrations/20260501002856_t220_pra_categories_animals_cuts.sql`, livré 2026-05-01) a déjà shippé un schéma 3 tables :

| Table | Rows en prod | Schéma |
|---|---|---|
| `public.product_categories` | 7 (Viande, Charcuterie, Légumes, Fromages, Miel, Œufs, Autres) | `id, slug (unique), name, sort_order, created_at` |
| `public.animals` | 6 (Bœuf, Veau, Porc, Agneau, Volaille, Lapin) | idem |
| `public.cuts` | 30 (uniquement Bœuf en MVP) | + `animal_id` FK ON DELETE RESTRICT, `UNIQUE (animal_id, slug)` |

`products` porte 3 FK nullables ON DELETE SET NULL : `category_id`, `animal_id`, `cut_id`. Les 16 produits prod sont tous NULL sur ces 3 colonnes — backfill T-220 PR-B en cours côté UI producer.

**Aucune UI admin n'existait** pour ces 3 référentiels. C'est ce que livre cette session.

## Décisions arbitrées par Romain (Option A — adapte le scope à l'existant)

1. **Pas de migration DB** ni de modification du schéma existant T-220 PR-A.
2. **3 pages séparées** sous `/admin/categorisation/{categories,animaux,morceaux}` (pas d'onglets dans une page unique). Cohérence pattern admin (`/admin/gestion-producteurs`, `/admin/gms-prices`), CRUD hétérogènes (cuts a un scoping animal_id propre), deep-linking propre.
3. **Pas de seed nouveau dans cette session** — l'UI admin EST l'outil d'enrichissement. Sera utilisée pour étendre les seeds une fois shippée (cuts hors-bovin, catégories manquantes type Pains/Boissons/Laitiers).
4. **Garde-fous DELETE STRICTS, pas de SET NULL silencieux côté API** — l'API count les dépendances avant DELETE et throw une erreur typée si > 0. Le ON DELETE SET NULL côté DB reste comme filet de sécurité hors-flow normal.

## Architecture finale

### Helpers backend (LOT 1)

`lib/products/admin/{categories,animals,cuts}.ts` exposent chacun :
- `list(supabase)` / `get(supabase, id)` — lecture admin
- `countDependencies(supabase, id)` — count produits liés (+ cuts pour animals)
- `create(supabase, input)` / `update(supabase, id, input)` — retourne `AdminWriteResult { ok, data | error }` aligné `lib/gms-prices/admin-write.ts`
- `delete(supabase, id)` — vérifie dépendances avant DELETE, throw `AdminCategorisationDeleteBlocked` si > 0

`lib/products/admin/errors.ts` :
- `AdminCategorisationDeleteBlocked { resource, dependencies }` — capturée par les routes pour 409.
- `AdminCategorisationSlugDuplicate { resource, slug }` — détectée via SQLSTATE 23505 (unique_violation). Capturée pour 409 distinct du 500 générique.
- `isUniqueViolation(error)` — détection multi-champ (`error.code === '23505'` OU message Postgres).

### Routes API admin (LOT 2)

| Route | Méthodes |
|---|---|
| `app/api/admin/categories/route.ts` | GET list, POST create |
| `app/api/admin/categories/[id]/route.ts` | GET (+deps), PATCH, DELETE |
| `app/api/admin/animals/route.ts` | GET list, POST create |
| `app/api/admin/animals/[id]/route.ts` | GET (+deps), PATCH, DELETE |
| `app/api/admin/cuts/route.ts` | GET list (+filter `?animal_id=<uuid>`), POST create |
| `app/api/admin/cuts/[id]/route.ts` | GET (+deps), PATCH, DELETE |

Pattern aligné `app/api/admin/gms-prices/*` :
- `getSessionUser()` + `session.isAdmin` → 403 si manquant ou non-admin.
- Validation Zod inline sur chaque body (`slug` kebab-case, `name` 1..100, `sort_order` int 0..10000, `animal_id` UUID strict pour cuts).
- Pre-SELECT pour 404 + capture before pour audit log diff (PATCH/DELETE).
- Translation erreurs typées :
  - `AdminCategorisationSlugDuplicate` → 409 `{ error: 'slug_duplicate', slug }`
  - `AdminCategorisationDeleteBlocked` → 409 `{ error: 'delete_blocked', dependencies: { products?, cuts? } }`
  - helper.ok=false → 500
- Audit log via cluster catalog (T-130) à chaque mutation (cf. infra).

### UI admin (LOT 3)

| Page | Particularité |
|---|---|
| `app/(admin)/categorisation/categories/page.tsx` | Table simple slug/name/sort_order/products_count |
| `app/(admin)/categorisation/animaux/page.tsx` | Table avec 2 colonnes deps : products + cuts |
| `app/(admin)/categorisation/morceaux/page.tsx` | Colonne animal explicite + filtre query param `?animal=<slug>` deep-link depuis page animaux |

Pattern aligné `/admin/gms-prices/page.tsx` :
- 'use client' complet
- READ direct `createSupabaseBrowserClient` (RLS public read sur les 3 tables, T-220 PR-A)
- WRITE via `fetch /api/admin/...` (jamais service_role côté client)
- AdminPageHeader + table + recherche locale (name OU slug, case-insensitive, trim)
- Modale create/edit shell partagé (`AdminModal` du design system)
- Error inline dans header

**Composants partagés** :
- `_components/SimpleEntityFormModal.tsx` — create/edit pour categories ET animals (3 champs identiques, paramétré via `resourceLabel` + `apiPath`).
- `_components/CutFormModal.tsx` — dédié cuts (select `animal_id` obligatoire + hint UNIQUE composite).
- `_lib/format-deps.ts` — pure functions : `matchesSearch`, `formatDependencyCount`, `formatDeleteBlockedMessage` par ressource.

### Sidebar admin (LOT 4)

Refactor `AdminSidebar.tsx` : NAV passe de `NavItem[]` à `NavEntry[] = NavItem | NavGroup`. Les groupes rendent un `<li role="presentation">` avec séparateur top + label uppercase terra-green-700, sans interactivité. Choix retenu : entrées plates groupées (séparateur + label) plutôt qu'un drawer collapsible nested — ajouter un système collapsible juste pour 3 entrées serait sur-ing.

3 entrées ajoutées sous le label de groupe « Catégorisation produits » :
- Catégories → `/categorisation/categories`
- Espèces animales → `/categorisation/animaux`
- Morceaux → `/categorisation/morceaux`

Inline SVG (cohérent avec les 8 entrées historiques, pas de lucide-react ailleurs dans la sidebar).

## Garde-fous DELETE — détail

### En API (filet applicatif strict)

```ts
// lib/products/admin/categories.ts
export async function deleteCategory(admin, id) {
  const deps = await countCategoryDependencies(admin, id);
  if (deps.products > 0) {
    throw new AdminCategorisationDeleteBlocked("category", { products: deps.products });
  }
  // … DELETE ne s'exécute que si zéro produits liés
}
```

### Par ressource

| Ressource | Bloquant si | Message UI |
|---|---|---|
| `category` | products avec `category_id` > 0 | `"Suppression impossible : N produit(s) utilise(nt) cette catégorie. Re-tagguer ces produits avant suppression."` |
| `animal` | products avec `animal_id` > 0 OU cuts avec `animal_id` > 0 | `"Suppression impossible : N produit(s) + M morceau(x) lié(s) à cette espèce. Re-tagguer / supprimer ces dépendances avant retrait."` |
| `cut` | products avec `cut_id` > 0 | `"Suppression impossible : N produit(s) utilise(nt) ce morceau. Re-tagguer ces produits avant suppression."` |

### En UI (double protection)

- Comptes affichés par ligne dans le tableau (colonne « Produits liés », + colonne « Morceaux » pour animals).
- Bouton « Supprimer » `disabled={deps > 0}` + `title={blockedMsg}` (tooltip HTML natif).
- En cas de race condition (un produit tagué entre count UI et DELETE), 409 du serveur → message exact affiché + refresh table.

### Filet DB

`ON DELETE SET NULL` sur `products.category_id`, `products.animal_id`, `products.cut_id` reste actif côté DB pour les corner cases (suppression manuelle SQL Studio, scripts ad-hoc). Mais l'API ne l'enclenche jamais en flux normal — toute suppression admin via UI passe par le check applicatif.

## Audit logs — nouveau cluster `catalog`

Helper `lib/audit-logs/log-categorisation-event.ts` symétrique aux autres clusters (auth/payment/review/legal). Contrat fail-safe identique : un échec d'écriture audit ne casse jamais le flow CRUD principal.

**9 event types** (3 ressources × 3 actions) :
- `admin_category_{created,updated,deleted}`
- `admin_animal_{created,updated,deleted}`
- `admin_cut_{created,updated,deleted}`

**Metadata par action** :
- `created` : `{ id, slug, name, sort_order }` (+ `animal_id` pour cut)
- `updated` : `{ id, before: {...}, after: {...} }` — diff visible côté page admin /audit-logs
- `deleted` : snapshot complet pré-suppression `{ id, slug, name, sort_order }` (+ `animal_id` pour cut)

**Intégrations cross-fichiers** :
- `app/(admin)/audit-logs/_lib/event-types.ts` : `ALL_EVENT_TYPES` inclut `CATEGORISATION_EVENT_TYPES` → page admin /audit-logs filtre auto.
- `app/(admin)/audit-logs/_lib/categorize-event-type.ts` : nouvelle catégorie visuelle `'catalog'` (palette teal) qui capture les 3 préfixes `admin_{category,animal,cut}_` AVANT le fallback auth.
- `lib/audit-logs/labels.ts` : 9 libellés FR (« Catégorie créée », « Espèce animale modifiée », « Morceau supprimé », etc.).

Le test parité existant `tests/lib/audit-logs/labels.test.ts` couvre auto les 9 nouveaux events via `ALL_EVENT_TYPES`.

## Tests ajoutés (+76 vitest, baseline 1982 → 2058)

| LOT | Fichier | Nombre |
|---|---|---|
| 1 | `tests/lib/products/admin/categories.test.ts` | 15 |
| 1 | `tests/lib/products/admin/animals.test.ts` | 14 |
| 1 | `tests/lib/products/admin/cuts.test.ts` | 13 |
| 2 | `tests/app/api/admin/categories/route.test.ts` | 10 |
| 2 | `tests/app/api/admin/categories/[id]/route.test.ts` | 14 |
| 2 | `tests/app/api/admin/animals/[id]/route.test.ts` | 5 (focus multi-deps) |
| 2 | `tests/app/api/admin/cuts/route.test.ts` | 7 (focus animal_id) |
| 2 | `tests/lib/audit-logs/log-categorisation-event.test.ts` | 6 |
| 2 | `tests/app/(admin)/audit-logs/_lib/categorize-event-type.test.ts` | +1 (préfixe catalog) |
| 3 | `tests/app/(admin)/categorisation/format-deps.test.ts` | 23 |
| 4 | `tests/app/(admin)/admin-sidebar.test.tsx` | 7 |

Mock SupabaseClient factor dans `tests/lib/products/admin/_supabase-mock.ts` (Bus + thenable builder qui supporte select/insert/update/delete + count via `{ count: 'exact', head: true }`).

## Hors scope cette session

- **Pas de migration DB** ni de modification du schéma existant T-220 PR-A.
- **Pas de seed nouveau** — l'UI livrée EST l'outil d'enrichissement.
- **Pas de modification de** `lib/products/types.ts`, `lib/products/fetch-references.ts`, `lib/products/categories-with-animal.ts` (côté lecture publique intact).
- **Pas de modification de** `app/(producer)/catalogue/*` (workflow producer T-220 PR-B intact) ni `app/(public)/produits/*`.
- **Pas de tests d'intégration page** — cohérent avec l'existant (aucun test sur `/admin/gms-prices/page.tsx` ou `/admin/gestion-producteurs/page.tsx`). La logique critique (filter, delete blocked message, dep counts) est isolée dans `_lib/format-deps.ts` → 100% couverte unit.

## Suite possible

### Court terme (chantier suite identifié)

- **Enrichissement seeds via UI livrée** — utiliser `/admin/categorisation/*` pour ajouter :
  - Cuts hors-bovin (Veau, Porc, Agneau, Volaille, Lapin — 0 cuts seedés actuellement)
  - Catégories manquantes (Pains, Boissons, Laitiers, Fruits — pas dans le seed initial T-220 PR-A)
- **Backfill T-220 PR-B** — re-tagging des 16 produits prod (tous NULL sur category_id/animal_id/cut_id). Email aux 6 producteurs concernés.

### Moyen terme

- **Migration follow-up T-220** : passer `products.category_id`, `animal_id`, `cut_id` en NOT NULL une fois le backfill terminé.
- **Option C hybride** (si besoin émerge) : ajouter `parent_id` nullable sur `product_categories` pour permettre des sous-catégorisations non-viande (Légumes → Tomate, Fromages → Vache → Camembert) sans casser animals/cuts. Compatible avec T-220 PR-B existant.
- **Sous-catégorisation par métier** : les 3 enums score carbone T-200 sont taillés pour l'élevage (cf. T-211). Un système de tagging par `type_production` pourrait s'appuyer sur la categorisation côté producteur.

### Liens / dépendances

- T-220 PR-A : DB livrée (origine schéma)
- T-220 PR-B : UI producer en cours (utilise les 3 référentiels en lecture)
- T-220 PR-C/D : codegen TS depuis migration SQL — livré 2026-05-06 (commit 5c1c2e5)
- T-080/T-081 (audit logs) : cluster catalog s'inscrit dans le pipeline existant
