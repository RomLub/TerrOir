# Fix Vercel React perf — Phase 1 quick wins (2026-05-05)

> Source audit : [`docs/audits/audit-vercel-react-perf-2026-05-05.md`](../audits/audit-vercel-react-perf-2026-05-05.md) §C-1, §C-2, §H-2, §H-3, §L-3.
> Périmètre : poser les fondations d'instrumentation (Speed Insights + Analytics + Bundle Analyzer)
> et résoudre les CRITICAL bundle quick wins (`mapbox-gl` lazy + `optimizePackageImports`) +
> nettoyage logs DevTools.
> Phases 2-4 (streaming UX, SSR migration, polish) restent ouvertes — cf. backlog.

## Synthèse

| Lot | Périmètre | Fichiers principaux | Audit refs |
|---|---|---|---|
| LOT 1 | Vercel Speed Insights + Analytics | `app/layout.tsx`, `package.json` | H-3 |
| LOT 2 | Bundle Analyzer (instrumentation bundle size) | `next.config.js`, `package.json`, `docs/conventions/perf-tooling.md` | H-2 |
| LOT 3 | `experimental.optimizePackageImports` | `next.config.js` | C-2 |
| LOT 4 | MiniMap lazy-load via `next/dynamic` | `app/(public)/producteurs/[slug]/produits/[id]/_components/MiniMapLazy.tsx` (NEW), `ProductPageClient.tsx`, `components/ui/index.ts` | C-1, C-2 |
| LOT 5 | Helper `clientLog` no-op en prod | `lib/utils/client-log.ts` (NEW), `app/(consumer)/compte/checkout/page.tsx` | L-3 |
| LOT 6 | Doc | ce fichier + audit FIXED + `docs/conventions/perf-tooling.md` (NEW) | n/a |

## Évolution package.json (3 nouvelles deps)

| Package | Type | Version | Rôle |
|---|---|---|---|
| `@vercel/speed-insights` | dep | ^2.0.0 | Mesure LCP/CLS/INP/TTFB en prod Vercel |
| `@vercel/analytics` | dep | ^2.0.1 | Pageviews + custom events (non utilisés pour l'instant) |
| `@next/bundle-analyzer` | devDep | 14.2.15 | Analyse bundle JS, aligné sur `next@14.2.15` |

→ Pas de conflit peerDeps. `npm install` propre, build TS et lint OK.

Script ajouté : `"analyze": "ANALYZE=true next build"` (à lancer en bash/CI ;
sur Windows PowerShell utiliser `$env:ANALYZE='true'; npm run build`).

## Évolution vitest

| Avant | Après | Delta |
|---|---|---|
| 1725 tests / 148 fichiers (post Stripe phase 2 H-2 + email H-3) | **1725 tests / 148 fichiers** | **0** |

Aucun test ajouté ou modifié. Helper `clientLog` est un wrapper trivial
(no-op en prod), couvert par les tests d'intégration UI existants. Le
build TS strict + le lint Next valident la signature.

## Diff résumé `next.config.js`

```diff
+const withBundleAnalyzer = require("@next/bundle-analyzer")({
+  enabled: process.env.ANALYZE === "true",
+});
+
 /** @type {import('next').NextConfig} */
 const nextConfig = {
   reactStrictMode: true,
+  experimental: {
+    optimizePackageImports: [
+      "@/components/ui",
+      "date-fns",
+      "@stripe/react-stripe-js",
+    ],
+  },
   images: { /* inchangé */ },
 };
-module.exports = nextConfig;
+module.exports = withBundleAnalyzer(nextConfig);
```

## Liste des fichiers touchés par LOT 5 (clientLog)

Un seul fichier client identifié avec `console.warn` côté navigateur :

- `app/(consumer)/compte/checkout/page.tsx` — 7 occurrences migrées
  - `[CHECKOUT_ORDER_CREATE_ERR]` (L177)
  - `[CHECKOUT_INIT_409]` (L236)
  - `[LIST_PM]` (L456)
  - `[CHECKOUT_${kind}]` × 2 (L488, L534)
  - `[ENSURE_DEFAULT_PM]` × 2 (L549, L552)

Volontairement **non modifiés** :
- API routes / Server Actions / Server Components (`app/api/**`, `lib/**`,
  pages SSR) — leurs logs vont vers Vercel Logs, utiles en prod.
- `console.error` côté client — légitime de remonter les erreurs réelles
  en DevTools utilisateur.

## Décisions / trade-offs autonomes

1. **`@next/bundle-analyzer` épinglé sur 14.2.15** au lieu de la latest 16.x.
   La latest cible Next 16, version d'API/webpack différente. Pin sur 14.2.15
   garantit l'alignement avec `next@14.2.15` actuellement utilisé. Nécessitera
   un bump conjoint quand le projet passera Next 15+.

2. **`MiniMapLazy` placé dans `_components/` de la fiche produit** plutôt qu'en
   `components/ui/` partagé. Justification : un seul consommateur, le wrapper
   est trivial (5 lignes), pas besoin d'abstraction prématurée. Si un second
   appelant émerge (Phase 3), promouvoir vers `components/ui/mini-map-lazy.tsx`.

3. **`/carte/page.tsx` non touché** — le fichier importe `mapbox-gl` au top
   directement (pas via `MiniMap`). C'est un sujet Phase 3 (refonte SSR
   coquille + sub-client) et hors scope ici. Acceptable car la page `/carte`
   EST une carte — l'utilisateur attend mapbox.

4. **`MapSarthe` reste dans le barrel** : pas SVG inline pur, pas de risque
   bundle. Pas besoin de le sortir.

5. **`script analyze` en bash-style** (`ANALYZE=true next build`) plutôt que
   `cross-env`. Justification : la cible principale est Vercel CI (Linux) ;
   en local Windows, l'utilisateur peut faire `$env:ANALYZE='true'; npm run build`.
   Pas la peine d'ajouter `cross-env` en devDep pour ça.

6. **Pas de `unfreeze` côté `optimizePackageImports`** : on a inclus
   `@stripe/react-stripe-js` mais PAS `@supabase/supabase-js` ni `mapbox-gl`.
   Raison : Supabase et Mapbox publient des bundles ESM déjà tree-shakable ;
   ajouter des entrées superflues ralentit le build sans bénéfice (cf.
   doc Next 14.2 sur `optimizePackageImports`).

## Validation

- ✅ `npx tsc --noEmit` — 0 erreur (warning user-provider.tsx pré-existant)
- ✅ `npx next lint` — clean (idem warning pré-existant)
- ✅ `npx vitest run` — 1725/1725
- ⏸️  Smoke E2E manuel `/producteurs/[slug]/produits/[id]` reporté à
  validation post-deploy preview (pas de `pnpm dev` lancé localement)

## Backlog ouvert (Phases 2-4)

### Phase 2 — Streaming UX (~7 h)
- C-3 : `loading.tsx` + `error.tsx` couverture 6 routes
  (`/produits`, `/morceaux/boeuf`, `/producteurs/[slug]`, fiche produit,
  `(consumer)`, `(producer)`)
- L-1 : skeletons sur les 5 `<Suspense fallback={null}>`

### Phase 3 — SSR migration (~14 h, le plus structurel)
- C-4 : 7 pages `'use client'` top-level → coquille SSR + sub-client
  - `/carte` (mapbox dynamic), `/producteurs`, `/compte/commandes`,
    `/(producer)/commandes`, `/(producer)/catalogue`, `/(admin)/suivi-commandes`
  - Inclut le fix mapbox-gl statique de `/carte/page.tsx`
- H-5 : auth re-check côté client (inclus dans C-4)
- H-6 : `getFeaturedProducts` Supabase (remplace mocks home)

### Phase 4 — Polish (~6 h)
- C-5 : affiner stratégies cache `revalidate` + tags
- H-1 : 7 `<img>` raw → `<Image>` next/image (LCP fiche produit, galerie ferme, panier)
- M-1 : URL sync filter `/carte` event handler (au lieu de useEffect)
- M-3 : polices `preload: false` Caveat (gain woff2)
- M-4 : `next/dynamic` sur 8-10 modals admin / producer / consumer

### Hors phases (instrumentation post-fix)
- Lancer `npm run analyze` après le premier déploiement avec ces fixes pour
  capturer la baseline `client.html`. Vérifier que `mapbox-gl` n'apparaît
  PLUS dans le chunk de `/producteurs/[slug]/produits/[id]`.
- Capturer LCP/CLS/INP via Speed Insights pendant 7 jours pour avoir une
  baseline avant Phase 3 (`audit §Q-8`).
