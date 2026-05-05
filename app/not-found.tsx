import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Page introuvable | TerrOir',
  robots: { index: false, follow: false },
};

// Page 404 globale (root). Affichée par Next quand notFound() est appelé
// (ex : producteurs/[slug]/page.tsx) ou pour toute URL non matchée.
//
// Pas de NavbarPublic/Footer ici : on n'est PAS dans le segment (public)/,
// le 404 doit rester self-contained pour matcher tous les hosts (www,
// pro, admin) sans casser l'isolation des layouts.
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-terroir-bg px-6 py-16 text-center">
      <p className="mono text-[12px] uppercase tracking-[0.18em] text-terra-700">
        Erreur 404
      </p>
      <h1 className="mt-4 font-serif text-[48px] leading-tight text-green-900 md:text-[64px]">
        Cette page n&apos;existe plus.
      </h1>
      <p className="mt-4 max-w-md text-[15px] text-dark/70">
        Le lien est peut-être expiré, le producteur n&apos;est plus actif, ou
        l&apos;URL a été mal recopiée. Reprenez la marketplace depuis
        l&apos;accueil.
      </p>
      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md bg-terra-700 px-5 py-3 text-base font-medium text-white transition-colors hover:bg-terra-800 focus:outline-none focus:ring-2 focus:ring-terra-700"
        >
          Retour à l&apos;accueil
        </Link>
        <Link
          href="/produits"
          className="inline-flex items-center justify-center rounded-md bg-terra-100 px-5 py-3 text-base font-medium text-terra-700 transition-colors hover:bg-terra-100/70 focus:outline-none focus:ring-2 focus:ring-terra-700"
        >
          Voir tous les produits
        </Link>
      </div>
    </div>
  );
}
