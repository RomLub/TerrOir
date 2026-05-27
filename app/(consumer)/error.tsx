'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui';

// Error boundary route-level (consumer) — couvre /compte/* + /auth/*.
// Audit Vercel C-3 : avant ce fix, une erreur côté SSR (auth, queries
// orders/cart, RLS) renvoyait l'écran d'erreur Next par défaut. Ici on
// affiche une UI cohérente avec /compte/page.tsx.
export default function ConsumerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[error.tsx] (consumer)', { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="rounded-2xl border border-terroir-border bg-white p-8 shadow-sm">
      <h1 className="font-serif text-[28px] text-green-900">
        Cette page n&apos;a pas pu s&apos;afficher.
      </h1>
      <p className="mt-3 text-[14px] text-dark/70">
        Une erreur côté serveur a interrompu le chargement de ton espace
        compte. Réessaie — on a peut-être juste eu un hoquet réseau.
      </p>
      {error.digest ? (
        <p className="mt-3 text-[11px] uppercase tracking-[0.14em] text-dark/40">
          Réf : {error.digest}
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={reset} variant="primary">
          Réessayer
        </Button>
        <Link
          href="/compte"
          className="inline-flex items-center justify-center rounded-md bg-terra-100 px-4 py-2 text-sm font-medium text-terra-700 transition-colors hover:bg-terra-100/70 focus:outline-none focus:ring-2 focus:ring-terra-700"
        >
          Retour au compte
        </Link>
      </div>
    </div>
  );
}
