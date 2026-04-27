'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { ProducerLayout } from '../../_components/ProducerLayout';

// Landing de reprise d'onboarding Stripe Connect Express (refresh_url).
// Cf. app/api/stripe/connect/onboard/route.ts lignes 61-62.
// Stripe renvoie ici quand l'Account Link a expiré ou que l'utilisateur a
// abandonné le flux en cours de route. On relance un POST sur la route
// d'onboard pour obtenir une nouvelle Account Link (même logique que le
// bouton "Démarrer" de /parametres).
export default function ConnectRefreshPage() {
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resume = async () => {
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch('/api/stripe/connect/onboard', {
        method: 'POST',
      });
      const body = await res.json();
      if (!res.ok || !body.url) {
        setError(body.error ?? "Impossible de reprendre l'onboarding Stripe");
        return;
      }
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <ProducerLayout>
      <div className="max-w-3xl mx-auto px-8 py-10">
        <header className="mb-8">
          <div className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">
            Paiements
          </div>
          <h1 className="mt-1 font-serif text-[40px] text-green-900 leading-tight">
            Lien Stripe expiré
          </h1>
        </header>

        <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
            <div className="text-[15px] font-semibold text-dark">
              Onboarding interrompu
            </div>
            <p className="text-[13px] text-dark/65 mt-2">
              Le lien d&apos;onboarding Stripe a expiré, ou le flux a été interrompu
              avant la fin. Reprenez la configuration pour pouvoir recevoir
              vos virements.
            </p>
          </div>

          {error && (
            <p className="mt-4 text-[13px] text-terra-700">{error}</p>
          )}

          <div className="flex items-center justify-between mt-6">
            <button
              type="button"
              onClick={() => router.push('/parametres')}
              className="text-[13px] text-dark/65 hover:text-dark underline"
            >
              Retour aux paramètres
            </button>
            <Button type="button" variant="accent" onClick={resume} disabled={connecting}>
              {connecting ? 'Redirection…' : "Reprendre l'onboarding"}
            </Button>
          </div>
        </section>
      </div>
    </ProducerLayout>
  );
}
