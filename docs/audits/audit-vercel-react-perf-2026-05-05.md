# Audit performance React / Next.js — TerrOir
Date : 2026-05-05
Référence : skill `vercel-react-best-practices` (Vercel Engineering, 70 règles)
Stack auditée : Next.js 14.2.15 (App Router) + React 18.3.1 + Vercel
Périmètre : `app/`, `components/`, `lib/` (côté client), `next.config.js`, `package.json`
Mode : audit lecture seule, statique (pas de `next build`, pas de bundle-analyzer runtime)

---

## Synthèse priorisée

| Sévérité | Count | Items |
|----------|-------|-------|
| **CRITICAL** | 5 | C-1 mapbox-gl statique · C-2 barrel `@/components/ui` · C-3 zéro `loading.tsx` / `error.tsx` · C-4 pages publiques full-client · C-5 `force-dynamic` partout |
| **HIGH** | 6 | H-1 `<img>` raw · H-2 pas de bundle-analyzer · H-3 pas d'analytics Vercel · H-4 UserProvider 3 queries au mount · H-5 auth re-check client redondant · H-6 mocks en prod (FeaturedProducts) |
| **MEDIUM** | 6 | M-1 cascade useEffect /carte · M-2 SVG icons inline navbar · M-3 polices Google secondaires non-deferred · M-4 0 `next/dynamic` · M-5 fetches client séquentiels (cart panier) · M-6 navbar drawer body-scroll-lock effect |
| **LOW** | 4 | L-1 Suspense fallback `null` · L-2 pas de `content-visibility` listings · L-3 logs console en prod · L-4 hooks `useMemo` triviaux |

## Verdict opérationnel

1. **Le bundle JS client est gonflé d'environ 250-350 KB (gzip) inutilement** par `mapbox-gl` (1.7 MB unminified) importé statiquement dans `components/ui/mini-map.tsx`, lui-même ré-exporté par le **barrel `@/components/ui/index.ts`** que 33 fichiers consomment. Sans `experimental.optimizePackageImports` configuré dans `next.config.js`, le tree-shaking n'est pas garanti. C'est le risque #1 sur LCP/TTI mobile.

2. **L'application a zéro `loading.tsx`, zéro `error.tsx`, zéro `not-found.tsx` dans `app/`**. Combiné à `dynamic = 'force-dynamic'` + `revalidate = 0` sur 6 routes SSR, l'utilisateur voit une page blanche pendant toute la durée du fetch DB. Le streaming Next 14 n'est pas exploité.

3. **Quatre pages critiques sont des `'use client'` top-level avec data-fetching client** (`/producteurs`, `/carte`, `/compte/commandes`, `/(producer)/commandes`, `/(producer)/catalogue`, `/(admin)/suivi-commandes`) — chacune introduit un waterfall : hydrate → `auth.getUser()` → query Supabase. Ces auth checks dupliquent le check serveur déjà fait par `(producer)/layout.tsx` et `(consumer)/compte/page.tsx`.

4. **Onze occurrences de `<img>` raw au lieu de `<Image>` next/image** dans des pages à fort impact LCP (galeries producer, photos produit, hero panier). Aucun lazy-load, pas de srcset responsive, pas de WebP/AVIF malgré `sharp` installé.

5. **Aucun `next/dynamic`, aucun `@next/bundle-analyzer`, aucun `@vercel/speed-insights`** : on ne mesure rien et on ne split rien au-delà du routing par défaut. La marketplace navigue à l'aveugle sur ses Core Web Vitals.

---

## CRITICAL

### C-1. `mapbox-gl` importé statiquement dans 2 fichiers client — FIXED (2026-05-05, fiche produit)
**Règle violée :** `bundle-dynamic-imports` (Vercel CRITICAL)

> ✅ **Fix Phase 1** : `MiniMap` est désormais lazy-loadée via `next/dynamic({ ssr: false })` dans
> `app/(public)/producteurs/[slug]/produits/[id]/_components/MiniMapLazy.tsx`. Mapbox-gl ne plombe plus le
> chunk de la fiche produit. Reste à traiter : `/carte/page.tsx` qui importe `mapbox-gl` au top — Phase 3
> (refonte SSR coquille + sub-client).

**Fichiers :**
- `app/(public)/carte/page.tsx:6` — `import mapboxgl from 'mapbox-gl'` au top, `'use client'` page
- `components/ui/mini-map.tsx:4` — `import mapboxgl from 'mapbox-gl'` au top, `'use client'` composant

**Mesure :** `node_modules/mapbox-gl/dist/mapbox-gl.js` = **1.77 MB** non-minifié, soit ~250-350 KB gzip selon les benchmarks Vercel publics. C'est le plus gros poids du bundle après React/Next runtime.

**Impact :**
- Sur `/carte`, c'est tolérable (la page EST une carte).
- Sur `/producteurs/[slug]/produits/[id]`, la `<MiniMap>` est en bas de page (section retrait à la ferme, line 333-344 de `ProductPageClient.tsx`). Elle est bundlée même si l'utilisateur ne scrolle jamais jusque-là, et bloque le LCP de la fiche produit.
- Sur toutes les pages qui importent depuis `@/components/ui` (33 fichiers), cf. C-2.

**Fix recommandé :**
```tsx
// components/ui/mini-map.tsx (laisser tel quel)

// Wrapper dans un composant lazy
// app/(public)/producteurs/[slug]/produits/[id]/_components/MiniMapLazy.tsx
'use client';
import dynamic from 'next/dynamic';
export const MiniMapLazy = dynamic(
  () => import('@/components/ui/mini-map').then((m) => m.MiniMap),
  { ssr: false, loading: () => <div className="h-full w-full bg-green-100/50" /> }
);
```
Et retirer l'export de `MiniMap` du barrel `@/components/ui/index.ts`.

Pour `/carte/page.tsx` : convertir la page en Server Component coquille + un `<CarteClient>` chargé via `next/dynamic({ ssr: false })`.

**Effort :** 2 h.

---

### C-2. Barrel file `components/ui/index.ts` ré-exporte mapbox-gl — FIXED (2026-05-05)
**Règles violées :** `bundle-barrel-imports`, `bundle-analyzable-paths` (Vercel CRITICAL)

> ✅ **Fix Phase 1** : (a) `MiniMap` retiré du barrel `@/components/ui/index.ts` ; les futurs consommateurs
> doivent passer par `MiniMapLazy` via dynamic import. (b) `experimental.optimizePackageImports` ajouté dans
> `next.config.js` pour `@/components/ui`, `date-fns`, `@stripe/react-stripe-js` — Next.js réécrit les
> imports automatiquement, plus de risque de bundle entier sur barrel.

**Fichier :** `components/ui/index.ts:90` exporte `MiniMap` (qui charge mapbox-gl) ET `MapSarthe` (SVG inline OK).

**Consommateurs :** 33 fichiers font `import { Button, ... } from '@/components/ui'`. Sans `experimental.optimizePackageImports: ['@/components/ui']` dans `next.config.js`, Webpack/SWC peut se retrouver à inclure la totalité du barrel dans chaque chunk client, notamment si un fichier en CommonJS quelque part déclenche un chargement non tree-shakable. **Le risque réel est à valider via `@next/bundle-analyzer`** (cf. H-2).

**Vérification possible (sans installer) :**
```sh
npx @next/bundle-analyzer  # nécessite ajout devDep
```

**Fix recommandé (par ordre de coût) :**
1. **Quick :** ajouter dans `next.config.js` :
   ```js
   experimental: { optimizePackageImports: ['@/components/ui'] }
   ```
2. **Mieux :** retirer `MiniMap` (et `MapSarthe` si pertinent) du barrel — forcer les consommateurs à importer en chemin direct `@/components/ui/mini-map`.
3. **Idéal :** scinder `@/components/ui/index.ts` en sous-modules par domaine (forms, layout, data-display, maps).

**Effort :** 1 h pour quick + 3 h pour mieux.

---

### C-3. Aucun `loading.tsx` / `error.tsx` / `not-found.tsx` dans `app/`
**Règles violées :** `async-suspense-boundaries`, `rerender-transitions` (Vercel CRITICAL/MEDIUM)

**Mesure :** `find app -name "loading.tsx"` retourne 0 résultat. Idem `error.tsx`, `not-found.tsx`.

**Conséquences :**
- Aucune UI streamable. Les Server Components avec `dynamic = 'force-dynamic'` (cf. C-5) bloquent tout rendu jusqu'au retour Supabase. L'utilisateur voit une page blanche.
- Aucun error boundary route-level. Une erreur Supabase = écran d'erreur Next.js par défaut (en prod : "Application error").
- Notamment critique sur `/produits` (catalogue 320+ produits potentiellement), `/producteurs/[slug]`, `/morceaux/boeuf`.

**Fix recommandé :** ajouter au minimum :
- `app/(public)/loading.tsx` — skeleton list générique
- `app/(public)/error.tsx` — div + bouton "Réessayer" + log
- `app/(public)/produits/loading.tsx` — skeleton grille
- `app/(public)/producteurs/[slug]/loading.tsx` — skeleton hero
- `app/(consumer)/loading.tsx` + `app/(producer)/loading.tsx`

**Effort :** 4 h pour couverture complète + skeletons fidèles au design.

---

### C-4. Pages publiques critiques en `'use client'` top-level avec data-fetch client
**Règles violées :** `server-parallel-fetching`, `async-parallel`, `bundle-defer-third-party` (Vercel HIGH)

**Pages identifiées :**

| Page | Fetch client (waterfall) | Pourquoi c'est un problème |
|------|--------------------------|----------------------------|
| `app/(public)/carte/page.tsx` | géoloc → `/api/producers/search` | searchParams + auth supabase pourraient être SSR |
| `app/(public)/producteurs/page.tsx` | géoloc → `/api/producers/search` | Listing SSR-able, intéraction filtres en sub-component |
| `app/(consumer)/compte/commandes/page.tsx` | `auth.getUser()` → `Promise.all(orders, count)` | Auth déjà checkée par middleware, double round-trip |
| `app/(consumer)/compte/panier/page.tsx` | hydrate Zustand → `/api/cart/validate` | Panier en localStorage, OK pour client mais le validate au mount = waterfall |
| `app/(producer)/commandes/page.tsx` | `auth.getUser()` → query orders | Layout (producer) déjà SSR auth-checked |
| `app/(producer)/catalogue/page.tsx` | `auth.getUser()` → query producers + products | Idem |
| `app/(admin)/suivi-commandes/page.tsx` | query orders (admin) | Idem |

**Pattern à adopter (cf. dashboard, qui le fait bien) :**
```tsx
// Server Component
export default async function ProducerCommandesPage() {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');
  const producer = await fetchProducerForUser(session.id);
  const orders = await fetchProducerOrders(producer.id);
  return <CommandesClient initial={orders} producerId={producer.id} />;
}
```

`app/(producer)/dashboard/page.tsx` (lines 73-166) est l'exemple à suivre : 11 queries en `Promise.all()` côté serveur, puis `<DashboardClient data={...}>` pour la partie interactive (realtime).

**Effort :** 6-8 h pour migrer les 7 pages.

---

### C-5. `dynamic = 'force-dynamic'` + `revalidate = 0` partout — pas de cache, pas de PPR
**Règles violées :** `server-cache-react`, `server-cache-lru` (Vercel HIGH)

**Pages :**
- `app/(public)/produits/page.tsx:37-38`
- `app/(public)/morceaux/boeuf/page.tsx:32-33`
- `app/(public)/producteurs/[slug]/page.tsx:16-17`
- `app/(public)/producteurs/[slug]/produits/[id]/page.tsx:19-20`
- `app/(producer)/creneaux/page.tsx`
- `app/(admin)/audit-logs/page.tsx`

**Justification existante (commentaires dans le code) :** "stock évolue en temps réel, on n'accepte pas de cache statique". Légitime pour la fiche produit (stock, slots), discutable pour `/produits` (catalogue) et `/morceaux/boeuf` (taxonomie + flag stock).

**Recommandations :**
- `/produits` : passer en `revalidate = 60` + `revalidateTag('public-products')` au moment d'un changement de stock significatif (déjà infra `unstable_cache` utilisée dans `lib/stats/public-stats.ts`).
- `/morceaux/boeuf` : `revalidate = 300` (la liste des cuts ne change jamais, le `cutsWithStock` peut tolérer 5 min de retard).
- `/producteurs/[slug]` : conserver `force-dynamic` (slot capacity) MAIS partial-caching le bloc producer via `unstable_cache` avec tag par slug.
- `/producteurs/[slug]/produits/[id]` : conserver tel quel (vraiment temps réel) mais ajouter un `loading.tsx` (cf. C-3).

**Effort :** 3 h.

---

## HIGH

### H-1. 11 occurrences de `<img>` raw au lieu de `<Image>` next/image
**Règle violée :** `bundle-defer-third-party`, optimisation LCP (Vercel HIGH)

**Fichiers (avec `// eslint-disable-next-line @next/next/no-img-element`) :**
- `app/(producer)/ma-page/page.tsx:277, 334, 350` (preview hero + galerie)
- `app/(consumer)/compte/panier/page.tsx:213` (image produit panier)
- `app/(public)/producteurs/[slug]/ProducerPageClient.tsx:196` (galerie ferme — JUSQU'À 6 photos)
- `app/(public)/producteurs/[slug]/produits/[id]/ProductPageClient.tsx:188, 210` (photo produit principale + thumbs)
- `app/(producer)/catalogue/nouveau/page.tsx:361`, `app/(producer)/catalogue/[id]/modifier/page.tsx:465, 474` (form preview)
- `app/(producer)/catalogue/page.tsx:219` (catalogue list)

**Impact LCP :**
- Photo produit en haut de fiche (`ProductPageClient.tsx:188`) = **probable LCP de la page**. Sans `<Image>`, pas de WebP/AVIF, pas de srcset responsive. Sur 4G mobile, +500ms à 1s sur LCP estimé.
- Galerie producer 6 photos = 6 fetches non-lazy.

**Fix recommandé :** remplacer par `<Image src={url} fill sizes="..." className="object-cover" />` partout. Les patterns Supabase Storage URLs sont déjà autorisées dans `next.config.js:11-19`.

Le seul cas où `<img>` reste légitime : preview d'un Blob URL côté form (`previewHero` → URL.createObjectURL), `<Image>` ne supporte pas blob URLs proprement. Cf. `ma-page/page.tsx:277, 334, 350` et `catalogue/nouveau/page.tsx:361`. Ces 4 cas peuvent rester.

→ **7 cas à migrer**, dont 3 critiques (hero galerie producer, photo produit principale, panier).

**Effort :** 2 h.

---

### H-2. Pas de `@next/bundle-analyzer` configuré — FIXED (2026-05-05)
**Règle violée :** méta-règle (instrumentation préalable obligatoire pour valider C-1, C-2)

> ✅ **Fix Phase 1** : `@next/bundle-analyzer@14.2.15` installé en devDep, `next.config.js` wrappé avec
> `withBundleAnalyzer({ enabled: process.env.ANALYZE === 'true' })`, script `npm run analyze` ajouté.
> Doc d'usage et d'interprétation : `docs/conventions/perf-tooling.md`.

**État :** `next.config.js` n'a aucune configuration custom au-delà de `reactStrictMode` et `images.remotePatterns`. Pas de `withBundleAnalyzer`, pas de `experimental.optimizePackageImports`, pas de `swcMinify`.

**Recommandation :**
```js
// next.config.js
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ['@/components/ui', 'date-fns', '@stripe/react-stripe-js'],
  },
  images: { /* existant */ },
};
module.exports = withBundleAnalyzer(nextConfig);
```

Puis `package.json` : `"analyze": "ANALYZE=true next build"`.

**Effort :** 30 min installation + 1 h analyse première sortie.

---

### H-3. Pas de mesure Vercel Speed Insights / Analytics — FIXED (2026-05-05)
**Règle violée :** méta-règle (mesure des Core Web Vitals)

> ✅ **Fix Phase 1** : `@vercel/speed-insights` + `@vercel/analytics` installés et montés dans
> `app/layout.tsx` (juste avant `</body>`). Aucune action en local (NODE_ENV !== 'production'), émission
> uniquement sur déploiements Vercel. Doc : `docs/conventions/perf-tooling.md`.

**État :** ni `@vercel/analytics` ni `@vercel/speed-insights` installés. `@vercel/functions` est installé mais c'est runtime serveur.

**Conséquence :** zéro visibilité sur LCP/CLS/INP/TTFB réels en production. Les fixes C-1 / H-1 ne pourront pas être quantifiés.

**Fix :** `pnpm add @vercel/speed-insights @vercel/analytics`, ajouter `<SpeedInsights />` et `<Analytics />` dans `app/layout.tsx`. Coût bundle : ~3 KB gzip.

**Effort :** 30 min.

---

### H-4. `UserProvider` (client) lance 3 queries Supabase au mount sur TOUTES les pages
**Règle violée :** `server-parallel-fetching` violation par redondance (Vercel HIGH)

**Fichier :** `components/providers/user-provider.tsx:121-159`.

**Problème :**
1. `app/layout.tsx:61` appelle `getInitialUserPayload()` SSR → user, roles, isAdmin, isProducer, producerLite passés via `<UserProvider initial={...}>`.
2. Au mount client, `loadProfile()` (line 124) refait : `Promise.all(supabase.from('users').select('roles'), supabase.from('admin_users').select('id'), supabase.from('producers').select(...))`.
3. C'est exécuté à CHAQUE page, pour CHAQUE user, sur CHAQUE hydratation.

**Justification dans le code :** "filet pour promotion/démotion en cours de session". Légitime mais hyper-coûteux.

**Fix recommandé :**
- N'exécuter `loadProfile()` que sur événement `auth.onAuthStateChange` réel (SIGNED_IN / USER_UPDATED), pas au mount initial.
- L'`INITIAL_SESSION` event peut être absorbé par l'`initial` payload.

```tsx
useEffect(() => {
  // Skip initial load: SSR a déjà fourni user + roles
  // Refetch ne se déclenche que sur transition réelle
  const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION') return; // SSR déjà fourni
    applySession(session?.user ?? null);
    if (IDENTITY_EVENTS.has(event)) broadcaster.broadcast();
  });
  // ...
}, [supabase]);
```

→ Économise 3 queries Supabase × N pages visitées × M utilisateurs / jour. À 10k visites/jour = 30k queries en moins/jour.

**Effort :** 2 h + tests régression auth.

---

### H-5. Auth re-check côté client sur pages déjà SSR-protégées
**Règle violée :** `server-auth-actions` (par redondance)

**Pattern :** `(producer)/layout.tsx:20` fait `getSessionUser()` puis redirect. Le middleware fait le même check. Mais `(producer)/commandes/page.tsx:99-110`, `(producer)/catalogue/page.tsx:51-52`, `(admin)/suivi-commandes/page.tsx` rappellent `supabase.auth.getUser()` au mount client → round-trip réseau redondant.

**Fix :** consommer `useUserContext()` (déjà SSR-fourni) au lieu de re-fetcher. Et passer en SSR (cf. C-4).

**Effort :** inclus dans C-4.

---

### H-6. Données mock en production sur la home : `FeaturedProducts`
**Règle violée :** dette projet, pas vercel directement

**Fichier :** `app/(public)/_components/home/FeaturedProducts.tsx:3` importe `FEATURED_PRODUCTS` depuis `@/lib/mocks/featured-products`. Le commentaire dit "Phase 2 : remplacer par getFeaturedProducts({ limit: 4 }) Supabase".

**Impact perf :** zéro direct, mais le composant rend 4 `<ProductCard>` avec données fictives en home → cognitive dissonance + risque de pousser de l'image Unsplash hardcodée dans le LCP.

**Fix :** créer `lib/products/fetch-featured.ts` avec `unstable_cache(..., { revalidate: 600, tags: ['featured-products'] })`.

**Effort :** 2 h.

---

## MEDIUM

### M-1. `/carte/page.tsx` : 7 useEffect en cascade
**Règle violée :** `rerender-split-combined-hooks` OK / `rerender-move-effect-to-event` partiellement violée

**Fichier :** `app/(public)/carte/page.tsx`, useEffects aux lignes 122, 142, 152, 197, 312, 317, 338, 355.

**Liste :**
1. L122 : géoloc (mount once)
2. L142 : sync URL params via `router.replace` (sur changement filtres)
3. L152 : fetch producers (sur userLoc + filters)
4. L197 : init mapbox map + sources/layers
5. L312 : flyTo userLoc
6. L317 : update user marker
7. L338 : update geojson source
8. L355 : feature-state hover

**Diagnostic :**
- L142 (sync URL) **devrait être déplacé en event handler** sur les onClick de Chip — `rerender-move-effect-to-event`. Actuellement chaque setState filter déclenche un re-render + un useEffect + un router.replace, soit 2 re-renders au lieu de 1.
- L152 fetch + L142 URL-sync se déclenchent sur les MÊMES deps → l'URL sync est purement décoratif côté UI.
- L312 / L317 / L338 / L355 sont des effets de synchronisation imperative DOM → légitimes (mapbox impératif).

**Fix prioritaire :** combiner L142 + onClick handler (1h). Le reste = pas urgent.

**Effort :** 1 h pour le fix principal.

---

### M-2. SVG icons re-définis dans `navbar-public.tsx` à chaque render
**Règle violée :** `rendering-hoist-jsx`, `rerender-no-inline-components` (Vercel MEDIUM)

**Fichier :** `components/ui/navbar-public.tsx:38-108` — 4 components `UserIcon`, `ShoppingBagIcon`, `MenuIcon`, `CloseIcon` définis comme functions internes SOUS le top-level mais avant le composant.

**Diagnostic :** elles sont au top-level du module donc OK ✓. Pas un problème.

→ **Pas un finding réel après vérification**, retiré.

---

### M-3. 3 polices Google chargées sur tout le site avec poids multiples
**Règle violée :** `bundle-defer-third-party` (Vercel CRITICAL pour fonts)

**Fichier :** `app/layout.tsx:7-25`.

**Mesure :**
- Inter : 1 poids variable (~30 KB woff2)
- Cormorant Garamond : 4 poids (400, 500, 600, 700) (~120 KB woff2 total)
- Caveat : 2 poids (500, 600) (~40 KB woff2 total)
- **Total : ~190 KB woff2 chargés sur chaque page** (avant tree-shaking de glyphes)

**Diagnostic :** `display: 'swap'` ✓, `subsets: ['latin']` ✓, `variable: '--font-...'` ✓ → bonne config standard.

**Limites :**
- Pas de `preload: false` sur Cormorant et Caveat → toutes les 3 sont preloadées sur la home même si Caveat n'est utilisé que sur 1-2 pages.
- 4 poids de Cormorant : vérifier le DESIGN.md, peut-être 2 poids suffisent.

**Fix possible :**
```ts
const caveat = Caveat({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-caveat", display: "swap", preload: false });
```

**Effort :** 30 min.

---

### M-4. Aucun `next/dynamic` dans le projet
**Règle violée :** `bundle-dynamic-imports`, `bundle-conditional`

**Mesure :** `grep -r "next/dynamic" app components` = 0 occurrence.

**Conséquence :** zéro code-splitting custom. Le splitting est uniquement basé sur les boundaries de routes Next 14. Tout composant lourd-conditionnel (modals admin, MiniMap, charts éventuels) est bundlé immédiatement.

**Candidats `dynamic({ ssr: false })` :**
- `MiniMap` (cf. C-1) — ROI immédiat
- `AdHocSlotModal`, `BulkExcludeRangeModal`, `SlotRuleModal`, `ExcludeSlotModal` (`(producer)/creneaux/_components/`) : 4 modals chargés même si user ne les ouvre jamais
- `MonthlyUpdateModal`, `EditGmsPriceModal`, `CreateGmsPriceModal` (`(admin)/gms-prices/_components/`)
- `AddCardModal` (`(consumer)/compte/paiements/_components/`)
- `OnboardingWizard` (`(producer)/invitation/_components/`) — c'est très lourd, candidat fort

**Effort :** 3 h pour les 8-10 candidats.

---

### M-5. `(consumer)/compte/panier/page.tsx` : 2 fetches client séquentiels
**Règle violée :** `async-parallel`

**Fichier :** `app/(consumer)/compte/panier/page.tsx:77-140`.

**Pattern :**
1. Hydrate Zustand depuis localStorage
2. Au mount → `fetch('/api/cart/validate')` pour détecter items orphelins

C'est légitime car le panier est en localStorage (zero-knowledge serveur). Ne peut pas être SSR.

→ **Pas un finding bloquant**, mais documenté pour traçabilité. Le `/api/cart/validate` est <100ms en pratique.

---

### M-6. `useEffect` body-scroll-lock dans `navbar-public.tsx`
**Règle violée :** `client-event-listeners` (Vercel MEDIUM)

**Fichier :** `components/ui/navbar-public.tsx:190-197`.

**Diagnostic :** un `document.body.style.overflow = 'hidden'` quand drawer ouvert. Pattern standard. OK.

→ **Pas un finding réel**, retiré.

---

## LOW

### L-1. `<Suspense>` autour de pages 'use client' avec `fallback={null}`
**Règle :** `async-suspense-boundaries`

**Fichiers :** 5 pages utilisent `<Suspense fallback={null}>` — `panier/page.tsx`, `commandes/page.tsx` (consumer + producer), `gestion-producteurs/page.tsx`, `ma-page/page.tsx`.

**Problème :** flash visuel possible (page blanche pendant Suspense resolve). `fallback={null}` est strictement valide mais sous-optimal.

**Fix :** remplacer par un mini skeleton.

**Effort :** 1 h.

---

### L-2. Pas de `content-visibility: auto` sur listings longs
**Règle :** `rendering-content-visibility`

**Fichiers candidats :** `(consumer)/compte/commandes/page.tsx`, `(producer)/commandes/page.tsx`, `(public)/producteurs/page.tsx` (peuvent rendre 100+ items).

**Fix :** Tailwind `[content-visibility:auto] [contain-intrinsic-size:80px]` sur les `<Link>` de la liste. Skip pour MVP, à activer si listings > 50 items en pratique.

**Effort :** 30 min.

---

### L-3. `console.warn` côté client en prod (DevTools) — FIXED (2026-05-05)
**Fichier :** `app/(consumer)/compte/checkout/page.tsx:177-178, 236, 486, 532, 547, 549` etc.

> ✅ **Fix Phase 1** : helper `lib/utils/client-log.ts` (no-op en prod), 7 occurrences `console.warn`
> migrées dans `checkout/page.tsx`. Les `console.error` (légitimes en prod) et tous les logs serveur
> (lib/**, app/api/**) sont volontairement préservés.

**Diagnostic :** logs structurés `[CHECKOUT_*]` poussés en `console.warn` côté navigateur — pollution DevTools, pas un risque sécurité (pas de PII dans les payloads observés).

**Fix :** wrapper dans un helper `clientLog` qui no-op en prod (ou logge vers Vercel Analytics events).

**Effort :** 1 h.

---

### L-4. `useMemo` sur expressions triviales
**Règle :** `rerender-simple-expression-in-memo`

**Cas :** `app/(public)/carte/page.tsx:387` — `const activeFilters = especes.length + labels.length + (radius !== 50 ? 1 : 0)` — pas memo ✓ OK.

→ Pas de finding réel après scan rapide.

---

## Annexes

### A-1. Inventaire des `'use client'` (65 fichiers — extrait des plus lourds)

| Fichier | LoC approx | Justification | Pourrait passer SSR ? |
|---------|------------|---------------|----------------------|
| `app/(public)/carte/page.tsx` | 580 | mapbox-gl, géoloc | Coquille SSR + sub-client |
| `app/(public)/producteurs/page.tsx` | 280 | searchParams, géoloc | Coquille SSR + sub-client |
| `app/(public)/producteurs/[slug]/ProducerPageClient.tsx` | ~400 | tabs, lightbox, scroll | Non (interactions) |
| `app/(public)/producteurs/[slug]/produits/[id]/ProductPageClient.tsx` | ~720 | qty stepper, slot picker, popover, MiniMap | Non |
| `app/(consumer)/compte/checkout/page.tsx` | 680 | Stripe Elements | Non |
| `app/(consumer)/compte/commandes/page.tsx` | 300 | filter tabs, realtime | Coquille SSR + sub-client |
| `app/(consumer)/compte/panier/page.tsx` | 350 | Zustand localStorage | Non (cart est client-only) |
| `app/(producer)/commandes/page.tsx` | ~400 | filter tabs, realtime | Coquille SSR + sub-client |
| `app/(producer)/catalogue/page.tsx` | ~500 | modal stock | Coquille SSR + sub-client |
| `app/(producer)/dashboard/DashboardClient.tsx` | ~400 | realtime, charts | OK (data SSR-fed) |
| `app/(producer)/ma-page/page.tsx` | 600+ | upload, preview | Probablement non |
| `app/(admin)/suivi-commandes/page.tsx` | 400+ | filter tabs admin | Coquille SSR + sub-client |
| `app/(public)/a-propos/page.tsx` | ~300 | aucune ! | **OUI — bug, devrait être SSR** |
| `app/(public)/comment-ca-marche/page.tsx` | ~250 | seul un useState (FAQ accordion) | Mostly SSR + accordion en sub-client |
| `app/(public)/devenir-producteur/page.tsx` | ~400 | form | Coquille SSR + form en sub-client |

**Note `/a-propos`** : déclare `'use client'` sans aucun hook React → peut passer en SSR (économie 0 lib mais sortie du bundle client + amélioration metadata SEO).

### A-2. Composants client-heavy

| Composant | Pourquoi heavy | Bundle approximatif gzip |
|-----------|---------------|--------------------------|
| `mapbox-gl` (via `<MiniMap>`, `/carte`) | webgl renderer + tiles | **~250-350 KB** |
| `@stripe/stripe-js` (lazy loadStripe ✓) | iframe SDK Stripe | ~40 KB initial + iframe runtime à part |
| `@stripe/react-stripe-js` (Elements wrapper) | hooks + provider | ~12 KB |
| `@supabase/supabase-js` (browser client) | auth + realtime + postgrest | ~70 KB |
| `@supabase/ssr` (cookie adapter) | partagé client/server | ~10 KB |
| `zustand` + `zustand/middleware/persist` | store | ~3 KB |
| `date-fns` + `@date-fns/tz` (importé partout) | date utils | ~15-20 KB selon tree-shaking |
| `clsx` + `tailwind-merge` | className utils | ~3 KB |
| `react-map-gl` (DÉCLARÉ EN DEPS MAIS NON UTILISÉ) | wrapper React mapbox | **0 (pas importé)** |

→ **Action `react-map-gl`** : `pnpm remove react-map-gl` + `@types/mapbox-gl` (utilisé) à conserver. Le code utilise mapbox-gl directement sans le wrapper React. Économie : ~25 KB du package + 0 du bundle (pas tree-shaké en l'état).

### A-3. Waterfalls détectés (data-fetching séquentiel)

| Page | Waterfall |
|------|-----------|
| `/carte` (client) | géoloc (8s timeout) → fetch producers → render map |
| `/producteurs` (client) | géoloc → fetch producers |
| `/compte/commandes` (client) | hydrate → `auth.getUser()` → Promise.all(orders, count) → realtime |
| `/(producer)/catalogue` (client) | hydrate → `auth.getUser()` → query producers → query products |
| `/(producer)/commandes` (client) | hydrate → `auth.getUser()` → query orders |
| `/checkout` (client) | hydrate Zustand → `/api/cart/validate` → `/api/orders/create` → `/api/stripe/create-payment-intent` → `loadStripe()` → mount Elements |
| `/producteurs/[slug]/produits/[id]` (server) | `fetchPublicProducerBySlug` → `generateSlotsForProducer` → Promise.all(slots, otherProducts, bookings) ✓ partiellement parallel |

**Cas `/checkout` :** 4 round-trips séquentiels sur le chemin critique du paiement. C'est légitime (chaque step crée la ressource pour la suivante) mais l'expérience perçue est dégradée. Un endpoint composite `/api/checkout/init` qui fait validate + create-order + create-payment-intent en une transaction réduirait le TTFB du Stripe Elements. Cf. audit Stripe phase 2 si ce point a déjà été remonté.

### A-4. Estimation bundle JS client (sans bundle-analyzer)

| Catégorie | Estimation gzip |
|-----------|----------------|
| React + React-DOM | ~45 KB |
| Next.js runtime | ~40 KB |
| `@supabase/ssr` + `@supabase/supabase-js` | ~70-80 KB |
| `mapbox-gl` (sur pages le chargeant) | **~250-350 KB** |
| `@stripe/stripe-js` (initial, sans iframe) | ~40 KB |
| `@stripe/react-stripe-js` | ~12 KB |
| Code app (pages, composants) | ~150-200 KB (estimation) |
| Polices Google (woff2) | ~190 KB |
| **Total page sans mapbox** | **~360-450 KB JS gzip + 190 KB fonts** |
| **Total page AVEC mapbox** | **~610-800 KB JS gzip + 190 KB fonts** |

→ Confirmation par `next build` + bundle-analyzer requise.

### A-5. Pages sans `loading.tsx` / `error.tsx` / `not-found.tsx`

**Toutes** (50+ routes). Cf. C-3.

### A-6. Findings positifs (à conserver)

- ✅ `Promise.all()` systématique dans Server Components (`(public)/produits/page.tsx`, `(public)/producteurs/[slug]/page.tsx`, `(producer)/dashboard/page.tsx` 11 queries parallèles, `(consumer)/compte/page.tsx`)
- ✅ `unstable_cache` utilisé pour `getPublicStats` avec tags + revalidate 300s
- ✅ Stripe lazy-load via `loadStripe()` singleton (pattern correct)
- ✅ AbortController dans `/carte` fetch (anti race)
- ✅ Initial payload SSR via `getInitialUserPayload()` → évite flash auth
- ✅ `Sharp` installé (Next utilise pour image optim au build)
- ✅ Polices `display: swap` + `subsets: ['latin']` + variables CSS
- ✅ `images.remotePatterns` whitelisté correctement
- ✅ `<Suspense>` correctement placé pour `useSearchParams` (Next 14 requirement)
- ✅ `reactStrictMode: true`
- ✅ Pages SSR pures pour `/produits`, `/morceaux/boeuf`, `/producteurs/[slug]`, `/producteurs/[slug]/produits/[id]` — bon réflexe RSC

---

## Cross-références autres audits

- **`audit-stripe-2026-05-05.md`** : le checkout est mentionné en C-4 et waterfall A-3. La phase 2 Stripe a déjà optimisé `automatic_payment_methods` + Apple Pay/Google Pay ; ne pas re-auditer ici. **Question ouverte** : un endpoint composite `/api/checkout/init` est-il dans la roadmap Stripe phase 3 ? Ce serait le quick win pour TTFB Stripe Elements.
- **`audit-perf-postgres-2026-05-05.md`** : les queries Supabase consommées par les pages client (`/compte/commandes`, `/(producer)/catalogue`) sont déjà optimisées DB-side avec cursor pagination (M-2 + NEW-1). Le finding C-4 est complémentaire — passer en SSR ne change pas la query, mais supprime le round-trip d'auth.
- **`audit-rls-2026-05-05.md`** : pas d'impact direct côté React, mais migrer `/(producer)/*` en SSR (cf. C-4) implique d'utiliser `createSupabaseServerClient()` avec cookies → RLS s'applique nativement, pas de risque.

---

## Estimation effort fix (heures Claude Code)

| Sévérité | Item | Effort | Cumul |
|----------|------|--------|-------|
| C-1 | Dynamic import MiniMap + carte/page coquille | 2 h | 2 h |
| C-2 | `optimizePackageImports` + retirer MiniMap du barrel | 1 h | 3 h |
| C-3 | `loading.tsx` + `error.tsx` couverture 6 routes | 4 h | 7 h |
| C-4 | Migration 7 pages 'use client' → SSR + sub-client | 7 h | 14 h |
| C-5 | Affiner stratégies cache `revalidate` + tags | 3 h | 17 h |
| H-1 | Migrer 7 `<img>` → `<Image>` | 2 h | 19 h |
| H-2 | Installer + configurer bundle-analyzer | 1.5 h | 20.5 h |
| H-3 | Installer @vercel/speed-insights + analytics | 0.5 h | 21 h |
| H-4 | Refacto UserProvider initial-skip | 2 h | 23 h |
| H-5 | (inclus dans C-4) | 0 h | 23 h |
| H-6 | `getFeaturedProducts` Supabase | 2 h | 25 h |
| M-1 | URL sync filter `/carte` event handler | 1 h | 26 h |
| M-3 | Polices `preload: false` Caveat | 0.5 h | 26.5 h |
| M-4 | `next/dynamic` sur 8-10 modals | 3 h | 29.5 h |
| L-1 | Skeletons sur Suspense fallback | 1 h | 30.5 h |
| L-3 | Helper `clientLog` no-op prod | 1 h | 31.5 h |
| Test régression manuel | LCP/CLS/TTFB Vercel preview | 2 h | **33.5 h** |

**Total roadmap perf : ~33.5 h Claude Code (≈4 jours engineer humain).**

**Phase 1 quick wins (~6 h)** : H-3 (analytics) + H-2 (bundle-analyzer) + C-2 (optimizePackageImports) + C-1 (MiniMap dynamic import) + L-3 (clientLog).

**Phase 2 streaming UX (~7 h)** : C-3 (loading/error) + L-1 (skeletons).

**Phase 3 SSR migration (~14 h)** : C-4 + H-5 + H-6 (le plus structurel, à faire en avant-dernier).

**Phase 4 polish (~6 h)** : C-5 (cache strategies) + H-1 (Image migration) + M-1, M-3, M-4.

---

## Top 3 quick wins (high-ROI, low-effort)

### 1. ⚡ Lazy-load MiniMap via `next/dynamic` (~2 h, économise 250-350 KB gzip sur fiche produit)

**Pourquoi #1 :** la fiche produit `/producteurs/[slug]/produits/[id]` est probablement une page TOP-3 en trafic SEO + conversion. Aujourd'hui elle bundle mapbox-gl pour afficher une mini-carte de 176px de haut, en bas de page. ROI immédiat sur LCP mobile.

**Comment :** créer `MiniMapLazy.tsx` avec `dynamic(() => import('@/components/ui/mini-map'), { ssr: false })`. Retirer `MiniMap` du barrel `@/components/ui/index.ts`. Tester `next build` avec bundle-analyzer.

### 2. 📊 `@vercel/speed-insights` + `@next/bundle-analyzer` (~2 h, instrumentation préalable)

**Pourquoi #2 :** sans mesure, on ne valide pas le ROI du #1. Speed Insights remonte les LCP/CLS/INP réels en prod. Bundle Analyzer prouve l'effet du `optimizePackageImports`. Ces deux outils doivent être en place AVANT les autres optimisations sinon on optimise à l'aveugle.

**Comment :** `pnpm add @vercel/speed-insights @vercel/analytics`, ajouter dans `app/layout.tsx`. `pnpm add -D @next/bundle-analyzer`, modifier `next.config.js`.

### 3. 🛠️ `experimental.optimizePackageImports` (~30 min, supprime risque tree-shake barrel)

**Pourquoi #3 :** un changement de 3 lignes dans `next.config.js` qui couvre Vercel `bundle-barrel-imports` règle pour `@/components/ui`, `date-fns`, `@stripe/react-stripe-js`. ROI immédiat sans toucher le code applicatif. À combiner avec le #2 pour mesurer.

**Comment :**
```js
experimental: { optimizePackageImports: ['@/components/ui', 'date-fns', '@stripe/react-stripe-js'] }
```

---

## Questions / Ambiguïtés

1. **PPR (Partial Prerendering)** : Next 14.2 supporte PPR en stable (avec `experimental.ppr = true`). Aucune route ne l'active. Pertinent pour `/` (homepage) et `/produits` (header SSR statique + grille SSR-cached + Suspense user-greeting). Faut-il l'activer ? Risque : surface bug Next 14 nouveau.

2. **Migration `/(producer)/*` en SSR** : ces pages sont sur le sous-domaine `pro.terroir-local.fr` (`(producer)/layout.tsx:24-29`). Le coût SSR Vercel sera supérieur au mode client actuel (chaque requête = function invocation). À arbitrer côté CFO/CTO.

3. **`@/components/ui` barrel — option A (`optimizePackageImports`) vs option B (split barrel)** : option A est non-invasive, option B est plus pérenne. Recommandation A en quick win, B en dette technique.

4. **`react-map-gl` package install mais zéro import** : confirmer qu'il n'y a pas un futur usage prévu sinon supprimer la dep.

5. **Mocks `FEATURED_PRODUCTS`** : la home affiche des données mock — est-ce un blocage release P0 ou accepté pour MVP soft-launch ?

6. **Next 14.2.15 vs 14.2.x latest** : 14.2.15 est sortie avec App Router stable. Vérifier les patches mineurs disponibles. Pas un fix perf en soi mais bonne hygiène.

7. **`@vercel/functions` installé en prod** : utilisé où ? Si juste pour un endpoint, pas un sujet ici. À vérifier qu'il n'introduit pas de runtime client.

8. **Tests régression LCP** : on n'a aucune baseline chiffrée. Avant de lancer Phase 3 (refonte SSR), capturer LCP/CLS/INP actuels via Speed Insights pendant 7 jours.
