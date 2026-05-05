import { PanierClient } from './PanierClient';

// Server Component coquille — audit Vercel C-4 (2026-05-05).
// Trade-off documenté : coquille SSR pour réduire le flash pré-hydratation
// (h1 visible immédiatement). Items panier restent en Zustand localStorage,
// zero-knowledge serveur par design — le serveur ne peut PAS connaître le
// contenu du panier (pas de table cart_items persistée). La validation
// /api/cart/validate au mount reste légitime (seule façon de détecter les
// items orphelins post-hydratation).
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function PanierPage() {
  return (
    <section>
      <h1 className="font-serif text-[40px] md:text-[52px] text-green-900 leading-tight">Votre panier</h1>
      <PanierClient />
    </section>
  );
}
