'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui';

// Error boundary route-level (admin). Les pages admin font des queries
// massives (audit-logs, suivi-commandes, gestion-producteurs) qui peuvent
// dépasser le timeout serverless Vercel. Cette boundary garde la sidebar
// admin SSR rendue tout en offrant un retry.
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[error.tsx] (admin)', { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
      <h1 className="text-[24px] font-semibold text-gray-900">
        Cette vue admin a échoué.
      </h1>
      <p className="mt-3 text-[14px] text-gray-600">
        Erreur côté serveur — la query a probablement timeout ou un filtre
        URL est invalide. Réessayez ou retournez au tableau de bord.
      </p>
      {error.digest ? (
        <p className="mt-3 text-[11px] uppercase tracking-[0.14em] text-gray-400">
          Réf : {error.digest}
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={reset} variant="primary">
          Réessayer
        </Button>
        <Link
          href="/tableau-de-bord"
          className="inline-flex items-center justify-center rounded-md bg-terra-100 px-4 py-2 text-sm font-medium text-terra-700 transition-colors hover:bg-terra-100/70 focus:outline-none focus:ring-2 focus:ring-terra-700"
        >
          Retour au tableau de bord
        </Link>
      </div>
    </div>
  );
}
