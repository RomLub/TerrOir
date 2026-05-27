'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui';

// Error boundary route-level (producer). L'espace producer charge des
// queries Supabase (orders, products, slots) qui peuvent timeout. Cette
// boundary capture l'erreur sans casser la session : reset() retente le
// fetch côté serveur sans déconnecter l'utilisateur.
export default function ProducerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[error.tsx] (producer)', { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="min-h-[60vh] bg-bg">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <div className="rounded-2xl border border-terroir-border bg-white p-8 shadow-sm">
          <h1 className="font-serif text-[28px] text-green-900">
            Tableau indisponible.
          </h1>
          <p className="mt-3 text-[14px] text-dark/70">
            Le chargement de votre espace producteur a échoué. Réessayez —
            si l&apos;erreur persiste, contactez le support TerrOir.
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
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-md bg-terra-100 px-4 py-2 text-sm font-medium text-terra-700 transition-colors hover:bg-terra-100/70 focus:outline-none focus:ring-2 focus:ring-terra-700"
            >
              Retour au tableau de bord
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
