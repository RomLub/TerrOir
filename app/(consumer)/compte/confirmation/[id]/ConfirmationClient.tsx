'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, CodeCommande } from '@/components/ui';
import { OrderProvenance } from '@/components/consumer/OrderProvenance';

export type ConfirmationProps = {
  orderId: string;
  codeCommande: string;
  statut: string;
  closureReason: string | null;
  items: { name: string; qty: string; price: number }[];
  producer: { name: string; address: string; lat: number | null; lng: number | null };
  slot: { dateLabel: string; timeLabel: string; dateISO: string; startISO: string; endISO: string };
  total: number;
};

// Cas pathologique : commande arrivée jusqu'à la page confirmation mais
// la résurrection 3DS-retry a été bloquée (stock épuisé ou slot saturé
// entre temps). Stripe a refundé automatiquement (cf webhook commit
// 9d6cb13), on doit afficher un message clair plutôt que le banner
// "Merci, c'est payé." qui serait trompeur.
function RevivalBlockedView({
  codeCommande,
  closureReason,
  producer,
  items,
  total,
}: {
  codeCommande: string;
  closureReason: 'revival_blocked_stock' | 'revival_blocked_slot';
  producer: { name: string };
  items: { name: string; qty: string; price: number }[];
  total: number;
}) {
  const isStock = closureReason === 'revival_blocked_stock';
  const headline = 'Commande non honorée';
  const reasonText = isStock
    ? 'Le stock du produit a été épuisé entre ta tentative initiale de paiement et la validation finale.'
    : 'Le créneau de retrait a été pris par un autre client entre ta tentative initiale et la validation finale.';
  const fixSuggestion = isStock
    ? 'Tu peux repasser commande chez ce producteur ou un autre.'
    : 'Tu peux choisir un autre créneau ou un autre producteur.';

  return (
    <section className="max-w-3xl mx-auto py-8 text-center">
      <div className="w-24 h-24 mx-auto rounded-full bg-terra-100 border-2 border-terra-700 flex items-center justify-center">
        <span className="text-terra-700 text-5xl leading-none" aria-hidden>!</span>
      </div>
      <span className="mt-6 inline-block text-[11px] uppercase tracking-[0.2em] text-terra-700 font-semibold">Paiement remboursé</span>
      <h1 className="mt-2 font-serif text-[44px] md:text-[56px] text-green-900 leading-tight">{headline}</h1>
      <p className="mt-3 text-[16px] text-dark/70 max-w-xl mx-auto">
        {reasonText}{' '}
        <strong>Un remboursement intégral a été initié</strong> sur ton moyen de paiement
        (3 à 5 jours ouvrés). {fixSuggestion}
      </p>

      <div className="mt-12 text-left bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6 md:p-8">
        <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold">
          Détails de la tentative
        </div>
        {codeCommande && (
          <div className="mt-2 text-[12px] mono text-dark/55">Code : {codeCommande}</div>
        )}
        <div className="mt-1 font-serif text-[18px] text-green-900">{producer.name}</div>

        <ul className="mt-4 divide-y divide-dark/[0.06]">
          {items.map((it, i) => (
            <li key={i} className="py-3 flex items-center justify-between gap-4">
              <div>
                <div className="text-[15px] text-dark font-medium">{it.name}</div>
                <div className="text-[12px] text-dark/50 mono">{it.qty}</div>
              </div>
              <div className="font-serif text-[18px] text-green-900 tabular-nums">{it.price.toFixed(2).replace('.', ',')} €</div>
            </li>
          ))}
        </ul>
        <div className="border-t border-dark/[0.08] mt-3 pt-3 flex items-baseline justify-between">
          <span className="font-serif text-[18px] text-green-900">Montant remboursé</span>
          <span className="font-serif text-[24px] text-green-900 tabular-nums">{total.toFixed(2).replace('.', ',')} €</span>
        </div>
      </div>

      <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
        <Link href="/carte"><Button size="lg">Trouver un autre producteur →</Button></Link>
        <Link href="/compte/commandes"><Button variant="secondary" size="lg">Voir mes commandes</Button></Link>
      </div>
    </section>
  );
}

export function ConfirmationClient({ orderId, codeCommande, statut, closureReason, items, producer, slot, total }: ConfirmationProps) {
  // Hooks d'animation du path nominal — déclarés AVANT le branchement
  // conditionnel pour respecter les rules-of-hooks (mêmes hooks dans le
  // même ordre à chaque render). Inutilisés sur le path RevivalBlockedView
  // mais le coût est négligeable et la conformité ESLint est nécessaire.
  const [animate, setAnimate] = useState(false);
  useEffect(() => { const t = setTimeout(() => setAnimate(true), 80); return () => clearTimeout(t); }, []);

  // Cas pathologique : la commande a été refusée à la résurrection
  // (stock épuisé ou slot saturé entre temps). Affiche un message clair
  // au lieu du banner "Merci, c'est payé." qui serait trompeur.
  if (
    statut === 'cancelled' &&
    (closureReason === 'revival_blocked_stock' ||
      closureReason === 'revival_blocked_slot')
  ) {
    return (
      <RevivalBlockedView
        codeCommande={codeCommande}
        closureReason={closureReason}
        producer={{ name: producer.name }}
        items={items}
        total={total}
      />
    );
  }

  const icsUrl = () => {
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
      `UID:${codeCommande}@terroir-local.fr`,
      `DTSTART:${slot.startISO}`, `DTEND:${slot.endISO}`,
      `SUMMARY:Retrait TerrOir — ${producer.name}`,
      `LOCATION:${producer.address}`,
      `DESCRIPTION:Code commande : ${codeCommande}`,
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
  };

  return (
    <section className="max-w-3xl mx-auto py-8 text-center">
        <div className="w-24 h-24 mx-auto rounded-full bg-green-100 border-2 border-green-700 flex items-center justify-center">
          <svg width="48" height="48" viewBox="0 0 48 48" className="text-green-700">
            <path
              d="M12 24 L20 32 L36 16"
              stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round"
              style={{ strokeDasharray: 60, strokeDashoffset: animate ? 0 : 60, transition: 'stroke-dashoffset 700ms ease-out 200ms' }}
            />
          </svg>
        </div>
        <span className="mt-6 inline-block text-[11px] uppercase tracking-[0.2em] text-terra-700 font-semibold">Commande confirmée</span>
        <h1 className="mt-2 font-serif text-[44px] md:text-[56px] text-green-900 leading-tight">Merci, c&apos;est payé.</h1>
        <p className="mt-3 text-[16px] text-dark/70 max-w-xl mx-auto">
          Ta commande est transmise à {producer.name}. Un email de confirmation vient de t&apos;être envoyé.
        </p>

        <div className="mt-10">
          <CodeCommande code={codeCommande} />
          <p className="mt-4 text-[14px] text-dark/70 font-medium">
            Note ce code — tu devras le présenter au producteur.
          </p>
        </div>

        <div className="mt-12 text-left bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6 md:p-8">
          <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold">Récapitulatif</div>
          <ul className="mt-3 divide-y divide-dark/[0.06]">
            {items.map((it, i) => (
              <li key={i} className="py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="text-[15px] text-dark font-medium">{it.name}</div>
                  <div className="text-[12px] text-dark/50 mono">{it.qty}</div>
                </div>
                <div className="font-serif text-[18px] text-green-900 tabular-nums">{it.price.toFixed(2).replace('.', ',')} €</div>
              </li>
            ))}
          </ul>
          <div className="border-t border-dark/[0.08] mt-3 pt-3 flex items-baseline justify-between">
            <span className="font-serif text-[18px] text-green-900">Total payé</span>
            <span className="font-serif text-[24px] text-green-900 tabular-nums">{total.toFixed(2).replace('.', ',')} €</span>
          </div>

          <div className="mt-6 pt-6 border-t border-dark/[0.08] grid sm:grid-cols-2 gap-4 text-[14px]">
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-dark/55 font-semibold mb-1">Lieu de retrait</div>
              <div className="font-serif text-[18px] text-green-900">{producer.name}</div>
              <div className="text-dark/70 mt-0.5">{producer.address}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-dark/55 font-semibold mb-1">Date et créneau</div>
              <div className="font-serif text-[18px] text-green-900">{slot.dateLabel}</div>
              <div className="text-dark/70 mt-0.5">{slot.timeLabel}</div>
            </div>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
          <a href={icsUrl()} download={`terroir-${codeCommande}.ics`}>
            <Button variant="secondary" size="lg">📅 Ajouter au calendrier</Button>
          </a>
          <Link href={`/compte/commandes/${orderId}`}><Button size="lg">Voir ma commande →</Button></Link>
        </div>

        <div className="mt-12 text-left">
          <OrderProvenance
            producerName={producer.name}
            producerLat={producer.lat}
            producerLng={producer.lng}
          />
        </div>
    </section>
  );
}
