'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui';

// Error boundary route-level (public). Audit Vercel C-3 : avant ce fix,
// une erreur Supabase / fetch côté SSR public renvoyait l'écran d'erreur
// Next.js par défaut ("Application error") en prod. Ici on offre une UI
// alignée avec le design + un retry via reset().
//
// `error.digest` est l'identifiant Vercel à corréler dans les logs runtime
// (Vercel Functions Logs filtre par digest).
export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Vercel capture automatiquement les erreurs côté serveur. Côté
    // client, ce console.error est l'unique point de remontée vers Vercel
    // Speed Insights / Web Analytics.
    console.error('[error.tsx] (public)', { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-6 py-16 text-center">
      <h1 className="font-serif text-[40px] text-green-900 leading-tight">
        Oups, ça a glissé.
      </h1>
      <p className="mt-3 max-w-md text-[15px] text-dark/70">
        Une erreur s&apos;est produite côté serveur. Réessayez dans quelques
        secondes — si le problème persiste, écrivez-nous.
      </p>
      {error.digest ? (
        <p className="mono mt-3 text-[11px] uppercase tracking-[0.14em] text-dark/40">
          Réf : {error.digest}
        </p>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={reset} variant="primary">
          Réessayer
        </Button>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md bg-terra-100 px-4 py-2 text-sm font-medium text-terra-700 transition-colors hover:bg-terra-100/70 focus:outline-none focus:ring-2 focus:ring-terra-700"
        >
          Retour à l&apos;accueil
        </Link>
      </div>
    </div>
  );
}
