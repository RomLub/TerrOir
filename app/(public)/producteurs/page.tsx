import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { ProducteursClient } from './ProducteursClient';

// Server Component shell — audit Vercel C-4 (2026-05-05).
// Migration partielle : le shell SEO (h1, eyebrow, CTA "Vue carte") est
// rendu côté serveur pour éliminer le poids du header dans le bundle
// client. Filtres + géoloc + fetch restent client (par nature : la query
// `search_producers` RPC dépend de navigator.geolocation, impossible côté
// serveur).
export const metadata: Metadata = {
  title: 'Tous les producteurs | TerrOir',
  description:
    'Annuaire des producteurs sarthois : trouve les éleveurs et maraîchers près de chez toi, filtre par espèce et label.',
};

export default function ProducteursPage() {
  return (
    <div className="min-h-screen bg-bg">
      <section className="max-w-7xl mx-auto px-6 pt-10 pb-2">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Annuaire</span>
            <h1 className="mt-2 font-serif text-[40px] md:text-[52px] text-green-900 leading-[1.05] tracking-tight">
              Tous les producteurs près de chez toi
            </h1>
          </div>
          <Link href="/carte">
            <Button variant="secondary">Vue carte →</Button>
          </Link>
        </div>
      </section>

      <ProducteursClient />
    </div>
  );
}
