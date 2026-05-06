'use client';

import dynamic from 'next/dynamic';

// Audit Vercel C-1 + C-4 (2026-05-05) : thin loader client qui défère
// l'import de mapbox-gl + CarteClient au runtime browser. Le bundle initial
// de la route /carte (chunk SSR shell) n'embarque plus le ~1.7 MB de
// mapbox-gl ; le module charge à la demande après hydratation.
//
// `ssr: false` est obligatoire ici : mapbox-gl utilise `window` et
// `document` au top-level (gestion de canvas WebGL) — il throw au SSR.
// Le pattern documenté Next 14 pour ce cas est exactement celui-ci.
export const CarteClientLazy = dynamic(
  () => import('../CarteClient').then((m) => m.CarteClient),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[calc(100dvh-4rem)] min-h-[600px] items-center justify-center bg-bg">
        <div className="text-center text-dark/60">
          <div className="font-serif text-[20px] text-green-900">Chargement de la carte…</div>
          <p className="mono mt-2 text-[12px]">Récupération des producteurs autour de toi</p>
        </div>
      </div>
    ),
  },
);
