# Fix Vercel React Perf — Phases 2 + 3 + 4
Date : 2026-05-06
Période : 2026-05-05 → 2026-05-06
Réf audit : `docs/audits/audit-vercel-react-perf-2026-05-05.md`
Réf Phase 1 : `docs/fixes/fix-vercel-perf-phase-1-quick-wins-2026-05-05.md`

---

## Résumé exécutif

Trois phases enchaînées (~21h CC effort), regroupées thématiquement « streaming UX
+ SSR migration + polish » :

| Phase | Thème | Effort | Commit |
|---|---|---|---|
| **Phase 2** | Streaming UX (loading/error/not-found) | ~7h | `58c7436` |
| **Phase 3** | SSR migration coquille (7 pages) | ~14h | `58c7436` |
| **Phase 4** | Polish (cache + Image + fonts + dynamic + URL sync) | ~6h | (en cours) |

**Findings traités** : 17 / 21 (81%). Backlog résiduel V1.x : 4 findings non bloquants
(`/(producer)/creneaux` cache + `/(admin)/audit-logs` cache : reportés pour arbitrage
Romain ; L-2 content-visibility et L-4 useMemo : non bloquants MVP).

**Tests** : vitest 1732/1732 maintenu sur les 3 phases. RLS isolation E2E couverte
(`tests/e2e/producer-rls-isolation.spec.ts`, 3/3 PASS).

---

## Phase 2 — Streaming UX (~7h)

### LOT 2.1 — `loading.tsx` (6 fichiers)

| Fichier | Skeleton |
|---|---|
| `app/(public)/loading.tsx` | grille générique 6 cards |
| `app/(public)/produits/loading.tsx` | grille 9 ProductCard 4:3 |
| `app/(public)/producteurs/[slug]/loading.tsx` | hero 16:10 + bloc identité + galerie 5 photos + grille 6 produits |
| `app/(consumer)/loading.tsx` | générique compte (4 lignes) |
| `app/(producer)/loading.tsx` | KPI cards + liste 5 lignes |
| `app/(admin)/loading.tsx` | table 8 lignes + header |

### LOT 2.2 — `error.tsx` (4 fichiers)

| Fichier | UI |
|---|---|
| `app/(public)/error.tsx` | Cormorant 40px + Réessayer + Retour accueil |
| `app/(consumer)/error.tsx` | UI compacte alignée /compte |
| `app/(producer)/error.tsx` | UI dans wrapper `bg-bg` |
| `app/(admin)/error.tsx` | UI gris admin |

`useEffect(() => console.error(...))` dans chaque, `error.digest` exposé pour
corrélation Vercel logs.

### LOT 2.3 — `not-found.tsx`

`app/not-found.tsx` (root) — Cormorant 64px, CTA accueil + CTA produits, `robots: noindex`.
Self-contained (pas de NavbarPublic — vit hors segment `(public)/`).

### LOT 2.4 — Suspense fallback skeletons (4 fichiers)

| Fichier | Fallback |
|---|---|
| `panier/page.tsx` | grille panier (3 lignes 80×80) |
| `compte/commandes/page.tsx` | liste commandes (5 cards + filter pills) |
| `(producer)/commandes/page.tsx` | liste commandes + sidebar `<ProducerLayout>` préservée |
| `(admin)/gestion-producteurs/page.tsx` | table 8 lignes + filter pills |

`(producer)/ma-page/page.tsx:253` gardé en `fallback={null}` avec commentaire justificatif
(banner conditionnel, skeleton flasherait pour 99% des utilisateurs).

---

## Phase 3 — SSR Migration coquille (~14h)

### LOT 3.1 — Audit pré-fix (rapport)

7 pages auditées : state local, fetches, interactions UI client. Stratégie SSR
définie par page. Pages non-migrables identifiées (panier zero-knowledge serveur).

### LOT 3.2 — Migration 6 + 1 partielle

| Page | Pattern | Sub-client |
|---|---|---|
| `/(consumer)/compte/commandes` | full SSR | `CommandesClient.tsx` (filter tabs + realtime channel) |
| `/(producer)/commandes` | full SSR | `ProducerCommandesClient.tsx` (tabs + confirm/cancel) |
| `/(producer)/catalogue` | full SSR | `CatalogueClient.tsx` (toggle + modal stock) |
| `/(admin)/suivi-commandes` | full SSR | `SuiviCommandesClient.tsx` (filter + search + CSV) |
| `/producteurs` | partiel | `ProducteursClient.tsx` (h1+CTA SSR ; filtres+géoloc+fetch client) |
| `/(consumer)/compte/panier` | coquille SSR | `PanierClient.tsx` (h1 SSR ; items Zustand client) |

Pattern systématique :
- Server Component : `getSessionUser` → `fetchProducerForUser` (cas applicable) →
  `parseCursor` → `Promise.all([items, count])` via admin client + filter explicite
  par `producer_id` / `consumer_id`
- Sub-client : reçoit `initial*` props, gère interactions locales + realtime
- `isVoidOrderRow` filter post-fetch côté serveur préservé pour consumer commandes

**Auth waterfall H-5 supprimé** : plus de `supabase.auth.getUser()` au mount sur les
4 pages full SSR.

### LOT 3.3 — H-4 UserProvider initial-skip

`components/providers/user-provider.tsx` : event `INITIAL_SESSION` désormais skip
`applySession` (SSR a déjà fourni initial). Les 3 queries Supabase ne tournent que
sur SIGNED_IN / SIGNED_OUT / USER_UPDATED / TOKEN_REFRESHED réels.

**Économie** : ~30k queries Supabase / jour à 10k visites.

### LOT 3.4 — H-6 FeaturedProducts Supabase

- `lib/products/fetch-featured.ts` créé : `getFeaturedProducts()` via `unstable_cache`
  (revalidate 600s + tag `'featured-products'`)
- Inner-join sur producers `statut='public' AND deleted_at IS NULL`
- Priorité badge cut > animal > category cohérente avec /produits
- Mock `lib/mocks/featured-products.ts` supprimé

### LOT 3.5 — Fix /carte mapbox SSR coquille

- `CarteClient.tsx` créé (named export, contient toute la logique mapbox)
- `_components/CarteClientLazy.tsx` : `dynamic(() => import('../CarteClient'), { ssr: false })`
- `page.tsx` : Server Component pur, juste `<CarteClientLazy />` + Metadata SEO

Mapbox-gl (~250-350 KB gzip) sort du bundle initial de la route.

### LOT 3.6 — Validation E2E RLS isolation

Couverture du risque #1 du refacto Phase 3 (admin client + filter explicite vs RLS
naturelle) via `tests/e2e/producer-rls-isolation.spec.ts` :
- Producer A/B sur `/commandes`
- Producer A/B sur `/catalogue`
- Consumer C/D sur `/compte/commandes`

3/3 PASS au 2026-05-06 (couverture validée par Romain hors scope CC).

---

## Phase 4 — Polish (~6h)

### LOT 4.1 — Cache strategies fines (C-5)

| Route | Avant | Après | Tag invalidation |
|---|---|---|---|
| `/produits` | `force-dynamic` + `revalidate=0` | `revalidate=60` | `public-products` |
| `/morceaux/boeuf` | `force-dynamic` + `revalidate=0` | `revalidate=300` | — |
| `/producteurs/[slug]` | `force-dynamic` | `force-dynamic` (page) + cache `unstable_cache` sur bloc producer (60s) | `producer:<slug>` |
| `/producteurs/[slug]/produits/[id]` | `force-dynamic` | inchangé (vraiment temps réel) | — |

**Infra ajoutée :**
- `lib/products/fetch-products-public-cached.ts` : wrapper unstable_cache de
  `fetchPublicProducts` avec clé `['public-products', JSON.stringify(filters)]`
- `lib/stats/revalidate.ts` : `revalidatePublicProducts` (tag `public-products`) +
  `revalidateProducerCard({slug})` (tag `producer:<slug>`)
- Wiré dans : `CatalogueClient.tsx` toggle, `catalogue/nouveau` create,
  `catalogue/[id]/modifier` update, `ma-page` save

**Reportés pour arbitrage Romain** :
- `/(producer)/creneaux` : conserve `force-dynamic` (cohérence flow producer en
  édition slot — caching = mauvaise UX)
- `/(admin)/audit-logs` : conserve `force-dynamic` (cache shared entre admins
  potentiellement risqué selon RLS session-bound)

### LOT 4.2 — `<img>` → `<Image>` (H-1)

7 cas migrés :
- `ProducerPageClient.tsx` galerie ferme (jusqu'à 6 photos)
- `ProductPageClient.tsx` photo principale (avec `priority`) + thumbs
- `PanierClient.tsx` thumbnails 80px
- `CatalogueClient.tsx` grid 4:3
- `catalogue/[id]/modifier/page.tsx` existing photos

4 cas blob URL préservés en raw `<img>` :
- `ma-page/page.tsx:295, 352, 368` (mixed blob/saved — conditionnel non rentable)
- `catalogue/nouveau/page.tsx:361` (preview form pure blob)

### LOT 4.3 — Polices preload (M-3)

`app/layout.tsx` :
- **Caveat** : `preload: false` (utilisé uniquement par `components/ui/post-it.tsx`)
- **Cormorant Garamond** : 4 poids → 2 poids (400 + 500). Grep `font-serif` confirme
  qu'aucune classe `font-serif font-(semibold|bold|black)` n'est utilisée.
  Économie woff2 ~60 KB sur la home.
- **Inter** : tel quel (poids variable, déjà optimal)

### LOT 4.4 — `next/dynamic` modals (M-4)

8 / 9 modals migrés en `dynamic({ ssr: false, loading: () => null })` :

| Modal | LoC | Wrapper |
|---|---|---|
| AdHocSlotModal | 156 | `AdHocSlotModalLazy.tsx` |
| SlotRuleModal | 316 | `SlotRuleModalLazy.tsx` |
| BulkExcludeRangeModal | 155 | `BulkExcludeRangeModalLazy.tsx` |
| ExcludeSlotModal | 199 | `ExcludeSlotModalLazy.tsx` |
| CreateGmsPriceModal | 270 | `CreateGmsPriceModalLazy.tsx` |
| EditGmsPriceModal | 208 | `EditGmsPriceModalLazy.tsx` |
| MonthlyUpdateModal | 279 | `MonthlyUpdateModalLazy.tsx` |
| AddCardModal | 213 | `AddCardModalLazy.tsx` |
| **Total LoC déférés** | **1796** | |

`OnboardingWizard` (75 LoC + types) **non migré** : son consumer (`/invitation/page.tsx`)
est un Server Component (ne supporte pas `dynamic({ ssr: false })`), et le wizard
est le contenu primaire de la route — lazy-load ajouterait latence sans gain.

### LOT 4.5 — URL sync /carte event handler (M-1)

`CarteClient.tsx` : URL sync (`router.replace`) déplacé du `useEffect` vers les
onClick handlers (`toggleEspece`, `toggleLabel`, `setRadiusAndSync`, `clearAll`).
Helper `buildFiltersUrl` extrait. Économise 1 re-render par toggle filter.

### LOT 4.6 — Doc

- `docs/audits/audit-vercel-react-perf-2026-05-05.md` : tous les findings traités
  marqués FIXED inline avec date + phase + commit.
- Présent fichier (`docs/fixes/fix-vercel-perf-phase-234-2026-05-05.md`).

---

## Trade-offs documentés

### Phase 2
- Skeletons en Tailwind inline plutôt qu'un `<Skeleton>` partagé (chaque page a
  une structure différente, factorisation prématurée).
- `error.tsx` n'utilise pas `<Button asChild>` (DS button n'a pas cette API) ;
  `<Link>` stylé manuellement avec classes secondary.

### Phase 3
- `/carte` n'a plus de h1 SSR (page applicative, pas contenu indexable).
- `/(consumer)/compte/panier` coquille SSR seule (zero-knowledge serveur par
  design — pas de table `cart_items` persistée).
- `/producteurs` migration partielle (fetch reste client géoloc-dependent).
- UserProvider H-4 fail-safe per-branch : si `getInitialUserPayload` partiel,
  l'état restera dégradé jusqu'au prochain event auth — accepté contre le gain
  perf.
- Migration `(producer)/*` du `createSupabaseBrowserClient()` (RLS) vers
  `createSupabaseAdminClient()` + filter explicite par `producer_id` : risque
  RLS leak théorique couvert par tests E2E isolation.

### Phase 4
- `/(producer)/creneaux` + `/(admin)/audit-logs` cache reportés pour arbitrage
  Romain (cf. LOT 4.1).
- 4 cas blob URL `<img>` préservés (form previews avec `URL.createObjectURL`).
- `OnboardingWizard` non lazy-loadé (Server Component consumer + primary content).

---

## Backlog résiduel V1.x

| Finding | Statut | Justification |
|---|---|---|
| C-5 `/(producer)/creneaux` | Reporté | Arbitrage Romain — flow édition producer, caching = mauvaise UX |
| C-5 `/(admin)/audit-logs` | Reporté | Arbitrage Romain — cache shared admins potentiellement risqué |
| C-5 `/producteurs/[slug]/produits/[id]` | Conservé | Vraiment temps réel (stock + slots) |
| L-2 `content-visibility` | Skip MVP | À activer si listings > 50 items en pratique |
| L-4 `useMemo` triviaux | Skip | Pas de finding réel après scan |
| H-1 `ma-page` 3 `<img>` | Skip | Mixed blob/saved, refacto conditionnel non rentable |
| H-1 `catalogue/nouveau:361` | Skip | Pure blob preview |
| M-2 SVG icons navbar | Pas un finding | Au top-level du module — pas de re-create per render |
| M-6 body-scroll-lock | Pas un finding | Pattern standard, OK |

---

## Action manuelle Romain post-deploy

1. **Smoke 4 pages auth-critiques** :
   - `/(consumer)/compte/commandes` (mes commandes consumer)
   - `/(producer)/commandes` (commandes reçues producer test)
   - `/(producer)/catalogue` (mes produits producer test)
   - `/(admin)/suivi-commandes` (admin)
2. **Vérifier RLS isolation** : aucun row leak inter-producers (déjà couvert par
   tests E2E mais smoke manuel = filet supplémentaire).
3. **Bundle baseline** : `npm run analyze` (ou
   `$env:ANALYZE="true"; npm run build` en PowerShell). Comparer avec baseline
   pré-Phase 4 capturée après Phase 1 quick wins. Diff attendu :
   - Bundle `/produits` : faible delta (cache strategy, pas de code split)
   - Bundle `/(producer)/creneaux` : -1500-2000 LoC (4 modals déférés)
   - Bundle `/(admin)/gms-prices` : -750 LoC (3 modals déférés)
   - Bundle `/compte/paiements` : -200 LoC (AddCardModal déféré)
   - Bundle `/carte` : -250-350 KB gzip (mapbox-gl complet déféré)
   - Bundle home : -60 KB woff2 (Cormorant 4 → 2 poids)
4. **Speed Insights / Web Analytics** (déjà branchés Phase 1) : observer les
   trends LCP / CLS / INP sur 7 jours post-deploy.
5. **Arbitrer cache strategies reportées** :
   - `/(producer)/creneaux` : garder `force-dynamic` ou tester `revalidate=60` ?
   - `/(admin)/audit-logs` : idem, garder `force-dynamic` ou tester `revalidate=30` ?

---

## Stats finales

- **Fichiers créés** : 30 (11 Phase 2 + 9 Phase 3 + 10 Phase 4)
- **Fichiers modifiés** : ~25
- **Fichiers supprimés** : 1 (`lib/mocks/featured-products.ts`)
- **Tests vitest** : 1732 → 1732 (delta 0, refacto preserves tests)
- **Tests E2E** : `stripe-smoke-phase3.spec.ts` intact + nouvelle couverture
  `producer-rls-isolation.spec.ts` (3/3 PASS)
- **Lint** : 1 warning préexistant `user-provider.tsx:118` (non lié au refacto)
- **TS strict** : 0 erreur
