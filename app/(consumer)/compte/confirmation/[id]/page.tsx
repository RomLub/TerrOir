'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, CodeCommande, NavbarPublic, Footer } from '@/components/ui';

const ORDER = {
  id: 'TRO-7A9K2X',
  items: [
    { name: 'Entrecôte maturée 21 jours', qty: '1,50 kg', price: 51.75 },
    { name: 'Rôti de bœuf Charolais', qty: '2,00 kg', price: 49.80 },
  ],
  producer: { name: 'Ferme des Chênes', address: "Route de la Vallée, 72250 Parigné-l'Évêque" },
  slot: { date: 'Samedi 25 avril 2026', time: '10h00 – 12h00', iso: '20260425T100000' },
  total: 101.55,
};

export default function ConfirmationPage({ params }: { params: { id: string } }) {
  const [animate, setAnimate] = useState(false);
  useEffect(() => { const t = setTimeout(() => setAnimate(true), 80); return () => clearTimeout(t); }, []);

  const orderId = params.id || ORDER.id;

  const icsUrl = () => {
    const dtStart = ORDER.slot.iso;
    const dtEnd = '20260425T120000';
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
      `UID:${orderId}@terroir.fr`,
      `DTSTART:${dtStart}`, `DTEND:${dtEnd}`,
      `SUMMARY:Retrait TerrOir — ${ORDER.producer.name}`,
      `LOCATION:${ORDER.producer.address}`,
      `DESCRIPTION:Code commande : ${orderId}`,
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
  };

  return (
    <div className="min-h-screen bg-bg">
      <NavbarPublic />
      <section className="max-w-3xl mx-auto px-6 py-16 text-center">
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
          Votre commande est transmise à {ORDER.producer.name}. Un email de confirmation vient de vous être envoyé.
        </p>

        <div className="mt-10">
          <CodeCommande code={orderId} />
          <p className="mt-4 text-[14px] text-dark/70 font-medium">
            Notez ce code — vous devrez le présenter au producteur.
          </p>
        </div>

        <div className="mt-12 text-left bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6 md:p-8">
          <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold">Récapitulatif</div>
          <ul className="mt-3 divide-y divide-dark/[0.06]">
            {ORDER.items.map((it) => (
              <li key={it.name} className="py-3 flex items-center justify-between gap-4">
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
            <span className="font-serif text-[24px] text-green-900 tabular-nums">{ORDER.total.toFixed(2).replace('.', ',')} €</span>
          </div>

          <div className="mt-6 pt-6 border-t border-dark/[0.08] grid sm:grid-cols-2 gap-4 text-[14px]">
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-dark/55 font-semibold mb-1">Lieu de retrait</div>
              <div className="font-serif text-[18px] text-green-900">{ORDER.producer.name}</div>
              <div className="text-dark/70 mt-0.5">{ORDER.producer.address}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-dark/55 font-semibold mb-1">Date et créneau</div>
              <div className="font-serif text-[18px] text-green-900">{ORDER.slot.date}</div>
              <div className="text-dark/70 mt-0.5">{ORDER.slot.time}</div>
            </div>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
          <a href={icsUrl()} download={`terroir-${orderId}.ics`}>
            <Button variant="secondary" size="lg">📅 Ajouter au calendrier</Button>
          </a>
          <Link href="/compte/commandes"><Button size="lg">Voir mes commandes →</Button></Link>
        </div>
      </section>
      <Footer />
    </div>
  );
}
