import Link from 'next/link';
import type { Cut } from '@/lib/products/types';

// Carte placeholder grid des morceaux animaux (T-220 PR-C C2).
//
// Décisions Q6 :
// - Zones AVEC produit en stock : <Link> cliquable vers
//   /produits?cut=<slug>, background terra-100 + hover effet.
// - Zones SANS produit en stock : <div> statique, opacity réduite,
//   cursor-not-allowed, tooltip natif title="Aucun produit en stock".
//
// Le composant reste agnostique de l'animal : il prend N cuts en
// entrée et les rend en grid uniforme. Réutilisable pour porc/agneau
// quand on étendra la couverture au-delà du bœuf.
//
// Chaque zone expose `data-cut-slug` — c'est le contrat structurel
// qu'un futur SVG vache (Claude Design / graphiste) réutilisera pour
// câbler ses <path> sur les mêmes cuts. Pas de SVG fonctionnel
// dans cette PR — juste la structure de données.

export type CutsMapProps = {
  cuts: Cut[];
  cutsWithStock: Set<string>;
  ariaLabel?: string;
};

export function CutsMap({ cuts, cutsWithStock, ariaLabel }: CutsMapProps) {
  if (cuts.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-dark/[0.06] p-12 text-center">
        <p className="font-serif text-[20px] text-green-900">
          Aucun morceau référencé pour cet animal.
        </p>
      </div>
    );
  }

  // Grid responsive : 2 cols mobile → 6 cols desktop. 30 cuts boeuf
  // tiennent dans 5 lignes × 6 cols sur grand écran.
  const baseClasses =
    'flex items-center justify-center rounded-xl border text-center px-3 py-4 text-[13px] font-medium min-h-[80px] leading-tight';

  return (
    <div
      role="group"
      aria-label={ariaLabel ?? 'Carte des morceaux'}
      className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-3"
    >
      {cuts.map((cut) => {
        const hasStock = cutsWithStock.has(cut.slug);

        if (hasStock) {
          return (
            <Link
              key={cut.id}
              href={`/produits?cut=${cut.slug}`}
              data-cut-slug={cut.slug}
              className={`${baseClasses} border-terra-700/30 bg-terra-50 text-green-900 shadow-soft hover:bg-terra-100 hover:border-terra-700 hover:shadow-card focus:outline-none focus:ring-2 focus:ring-green-700 transition-all`}
            >
              <span>{cut.name}</span>
            </Link>
          );
        }

        return (
          <div
            key={cut.id}
            data-cut-slug={cut.slug}
            title="Aucun produit en stock"
            aria-disabled="true"
            className={`${baseClasses} border-dark/[0.06] bg-white text-dark/40 opacity-60 cursor-not-allowed`}
          >
            <span>{cut.name}</span>
          </div>
        );
      })}
    </div>
  );
}
