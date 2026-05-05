# Perf tooling — bundle analyzer + Vercel instrumentation

Date d'introduction : 2026-05-05
Référence : `docs/audits/audit-vercel-react-perf-2026-05-05.md` (Phase 1 quick wins).

## Vercel Speed Insights + Analytics

Installés (`@vercel/speed-insights`, `@vercel/analytics`) et montés dans
`app/layout.tsx` (juste avant la fermeture `</body>`). Les deux composants
n'envoient rien en local (`NODE_ENV !== 'production'`) et émettent vers
Vercel uniquement sur les déploiements `vercel.app`.

- **Speed Insights** : remonte LCP / CLS / INP / TTFB / FCP réels par route.
  Visible dans Vercel Dashboard → projet → Speed Insights. Sample 100% par
  défaut, gratuit jusqu'à 10k events/mois sur le plan Hobby.
- **Analytics** : pageviews + custom events (non utilisés pour l'instant).

→ Pas d'opt-in cookies requis : Vercel anonymise les données serveur-side et
ne pose pas de cookie persistant (cf. doc `vercel.com/docs/analytics/privacy`).
Si une CMP est ajoutée plus tard, gérer l'opt-out via la prop `mode`.

## Bundle analyzer

Installé en devDep (`@next/bundle-analyzer@14.2.15`, version alignée sur
`next@14.2.15`).

### Usage

```bash
npm run analyze
```

→ Lance un `next build` avec `ANALYZE=true`. Génère 3 rapports HTML dans
`.next/analyze/` :

- `client.html` — bundle JS chargé par le navigateur (LE plus important pour
  Core Web Vitals)
- `nodejs.html` — bundle Server Components / API routes
- `edge.html` — bundle middleware / edge runtime (peu utilisé sur le projet)

Chaque rapport ouvre automatiquement dans le navigateur (treemap interactif).

### Interprétation

Ce qu'il faut surveiller en priorité dans `client.html` :

1. **`mapbox-gl`** : poids ~250-350 KB gzip. Doit n'apparaître QUE dans les
   chunks de `/carte` et de la fiche produit (via `MiniMapLazy`, lazy-load).
   S'il apparaît dans le chunk principal `_app` ou `layout`, il y a un import
   statique qui leak — bug à corriger.
2. **`@stripe/stripe-js` + `@stripe/react-stripe-js`** : ~50 KB gzip combinés.
   Doivent n'apparaître que dans le chunk `/checkout`. Stripe Elements iframe
   est chargé séparément à runtime.
3. **`@supabase/supabase-js`** : ~70-80 KB gzip, présent partout (auth +
   realtime). Acceptable mais à surveiller s'il monte.
4. **`date-fns`** : doit être tree-shaked grâce à `optimizePackageImports`.
   Si on voit le bundle entier (~100 KB), un import `import * as dateFns`
   leak quelque part.

### Quand le lancer ?

- Avant chaque PR qui touche un import lourd (mapbox, stripe, charts).
- Lors d'une régression LCP remontée par Speed Insights.
- 1× par mois pour vérifier que les chunks ne dérivent pas.

## `experimental.optimizePackageImports`

Activé dans `next.config.js` pour 3 packages :

- `@/components/ui` — barrel local, évite les imports en cascade
- `date-fns` — tree-shake les fonctions non utilisées
- `@stripe/react-stripe-js` — pareil pour les hooks/components Stripe

Pas besoin de toucher au code applicatif, Next.js réécrit les imports
automatiquement au build. Effet : Webpack ne charge que les modules
strictement référencés par fichier.
