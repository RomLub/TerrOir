# Dependencies rationale

Documente les dépendances dont la raison de présence n'est pas évidente
en lisant le code applicatif, pour éviter qu'un onboarding les retire
par méprise.

## sharp (devDep)

`sharp` est une devDep utilisée IMPLICITEMENT par `next/image` pour
l'optimisation d'images au build time / runtime.

- Aucun `import sharp from "sharp"` direct dans le code applicatif
- Next 16 détecte automatiquement la présence de `sharp` dans
  `node_modules` et l'utilise pour redimensionner / encoder les
  images servies via `<Image>` (formats AVIF, WebP)
- Sans `sharp`, Next fallback sur le binaire WASM qui est ~10x plus
  lent au build et runtime sur Vercel

Ne pas retirer même si la commande `grep -r "from \"sharp\""` ne
retourne aucun match. Audit debt-P2-7.

## @types/mapbox-gl (devDep)

Conservé même si `mapbox-gl` est utilisé via les imports directs
`import mapboxgl from 'mapbox-gl'` (cf. `app/(public)/carte/CarteClient.tsx`,
`components/ui/mini-map.tsx`).

`react-map-gl` a été retiré (debt-P1-4) car wrapper jamais utilisé,
mais `mapbox-gl` reste la dep principale.

## @vercel/functions

Utilisé pour `waitUntil` (background tasks post-response) sur les routes
critiques (webhook Stripe pre-refacto, audit logs async). Ne pas
confondre avec `@vercel/analytics` ou `@vercel/speed-insights` qui sont
des trackers client-side.
