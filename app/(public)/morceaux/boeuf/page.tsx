import type { Metadata } from 'next';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { fetchCutsByAnimalSlug } from '@/lib/products/fetch-cuts-by-animal';
import { fetchCutsWithStock } from '@/lib/products/fetch-cuts-with-stock';
import { CutsMap } from './_components/CutsMap';

// Page placeholder de la carte interactive des morceaux de bœuf
// (T-220 PR-C C2).
//
// Layout : H1 + intro + grid 6×5 des 30 cuts du bœuf. Chaque zone
// expose data-cut-slug et redirige vers /produits?cut=<slug> si stock.
//
// Server Component, fetch SSR en parallèle :
// - fetchCutsByAnimalSlug('boeuf') : les 30 morceaux ordered sort_order
// - fetchCutsWithStock() : Set des slugs ayant ≥1 produit actif chez
//   un producer public (filtre RLS-bypass appliqué côté query)
//
// Audit Vercel C-5 (2026-05-05) : passé de force-dynamic à revalidate=300.
// La taxonomie cuts est statique (pas de mutation runtime), seul
// `cutsWithStock` évolue avec le stock réel. Tolérance 5 min raisonnable
// pour une page éducative (l'utilisateur ne fait pas une décision d'achat
// stricte ici — il découvre la nomenclature). En cas de besoin de fraîcheur
// immédiate, étendre revalidatePublicProducts pour tagger aussi cette page.
//
// Le SVG fonctionnel viendra plus tard (Claude Design ou graphiste
// freelance). Il réutilisera les data-cut-slug du placeholder pour
// câbler ses <path> sur la même structure de données.

export const metadata: Metadata = {
  title: 'Les morceaux de bœuf | TerrOir',
  description:
    'Découvrez les différents morceaux de bœuf et trouvez ceux disponibles chez nos éleveurs sarthois. Carte interactive éducative.',
};

export const revalidate = 300;

export default async function MorceauxBoeufPage() {
  const admin = createSupabaseAdminClient();
  const [cuts, cutsWithStock] = await Promise.all([
    fetchCutsByAnimalSlug(admin, 'boeuf'),
    fetchCutsWithStock(admin),
  ]);

  return (
    <div className="max-w-7xl mx-auto px-8 py-10">
      <header className="mb-10">
        <h1 className="font-serif text-[40px] text-green-900 leading-tight">
          Les morceaux de bœuf
        </h1>
        <p className="text-[15px] text-dark/70 mt-3 max-w-3xl">
          Découvrez les différents morceaux de bœuf et trouvez ceux disponibles
          chez nos éleveurs sarthois. Cliquez sur un morceau pour voir les
          produits en stock.
        </p>
      </header>

      <CutsMap
        cuts={cuts}
        cutsWithStock={cutsWithStock}
        ariaLabel="Carte des morceaux de bœuf"
      />
    </div>
  );
}
