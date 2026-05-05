import type { Metadata } from 'next';
import { CarteClientLazy } from './_components/CarteClientLazy';

// Server Component coquille — audit Vercel C-1 + C-4 (2026-05-05).
// Avant : page 'use client' top-level qui importait mapboxgl statiquement
// (~250-350 KB gzip dans le chunk de la route). Maintenant : page server
// pure qui délègue à <CarteClientLazy />, lui-même un wrapper client thin
// utilisant next/dynamic({ ssr: false }) pour défèrer mapbox-gl + tout le
// state client jusqu'après l'hydratation.
//
// Trade-off : pas de SSR du h1 « Carte des éleveurs » (il est dans
// CarteClient). Le contenu SEO reste minimal pour /carte (interface
// applicative, pas page de contenu indexable). Si SEO devient critique,
// extraire l'aside header en server-side ici.
export const metadata: Metadata = {
  title: 'Carte des producteurs | TerrOir',
  description:
    'Trouvez les producteurs sarthois sur la carte interactive. Filtrez par espèce, label et distance.',
};

export default function CartePage() {
  return <CarteClientLazy />;
}
