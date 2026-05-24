'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button, PageHeader } from '@/components/ui';

// Landing de retour après onboarding Stripe Connect Express (return_url).
// Cf. app/api/stripe/connect/onboard/route.ts lignes 61-62.
// Pas de vérif Stripe server-side ici : la source de vérité du statut Connect
// remontera via webhook account.updated (non implémenté à ce jour — dette).
const REDIRECT_DELAY_MS = 3000;

export default function ConnectDonePage() {
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => router.push('/parametres'), REDIRECT_DELAY_MS);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <div className="max-w-3xl mx-auto px-8 py-10">
      <PageHeader
        tone="producer"
        eyebrow="Paiements"
        title="Onboarding Stripe terminé"
      />

      <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
        <div className="rounded-xl border border-green-500 bg-green-100/50 p-5">
          <div className="text-[15px] font-semibold text-green-900">
            ✓ Compte Stripe connecté
          </div>
          <p className="text-[13px] text-dark/65 mt-2">
            Vos informations ont été transmises à Stripe. Vous pourrez
            recevoir vos virements hebdomadaires dès la validation de votre
            compte par Stripe.
          </p>
        </div>

        <p className="text-[12px] text-dark/55 mt-4">
          Redirection vers vos paramètres dans quelques secondes…
        </p>

        <div className="flex justify-end mt-6">
          <Button type="button" variant="primary" onClick={() => router.push('/parametres')}>
            Accéder à mes paramètres
          </Button>
        </div>
      </section>
    </div>
  );
}
