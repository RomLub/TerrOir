'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { Button, NavbarPublic, Footer } from '@/components/ui';

const ORDER = {
  items: [
    { name: 'Entrecôte maturée 21 jours', qty: '1,50 kg', price: 51.75 },
    { name: 'Rôti de bœuf Charolais', qty: '2,00 kg', price: 49.80 },
  ],
  producerName: 'Ferme des Chênes',
  producerAddress: "Route de la Vallée, 72250 Parigné-l'Évêque",
  slot: 'Samedi 25 avril 2026 · 10h00 – 12h00',
  total: 101.55,
};

export default function CheckoutPage() {
  const router = useRouter();
  const [card, setCard] = useState({ number: '', exp: '', cvc: '', name: '' });
  const [processing, setProcessing] = useState(false);

  const format = (v: string) => v.replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim().slice(0, 19);
  const valid = card.number.replace(/\s/g, '').length >= 16 && card.exp.length >= 5 && card.cvc.length >= 3 && card.name;

  const handlePay = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!valid) return;
    setProcessing(true);
    setTimeout(() => router.push('/compte/confirmation/TRO-7A9K2X'), 1200);
  };

  return (
    <div className="min-h-screen bg-bg">
      <NavbarPublic />
      <section className="max-w-6xl mx-auto px-6 py-10">
        <Link href="/compte/panier" className="text-[13px] text-dark/60 hover:text-green-900">← Retour au panier</Link>
        <h1 className="mt-3 font-serif text-[40px] md:text-[52px] text-green-900 leading-tight">Finaliser la commande</h1>

        <div className="mt-10 grid lg:grid-cols-[1fr_380px] gap-10 items-start">
          <div className="space-y-6">
            <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
              <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold mb-3">Votre commande</div>
              <ul className="divide-y divide-dark/[0.06]">
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
            </section>

            <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
              <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold mb-3">Retrait à la ferme</div>
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <div className="font-serif text-[20px] text-green-900">{ORDER.producerName}</div>
                  <div className="text-[13px] text-dark/60 mt-0.5">{ORDER.producerAddress}</div>
                  <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-100 text-green-900 text-[13px] font-medium">
                    🕐 {ORDER.slot}
                  </div>
                </div>
                <div className="w-32 h-32 rounded-xl overflow-hidden flex-shrink-0">
                  <svg viewBox="0 0 120 120" className="w-full h-full">
                    <rect width="120" height="120" fill="#D8F3DC"/>
                    <path d="M0 60 Q 40 50 70 62 T 120 55" stroke="#fff" strokeWidth="4" fill="none"/>
                    <circle cx="60" cy="60" r="8" fill="#2D6A4F" stroke="#fff" strokeWidth="2"/>
                  </svg>
                </div>
              </div>
            </section>

            <form onSubmit={handlePay} className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold">Paiement</div>
                <span className="text-[11px] mono text-dark/50">🔒 Stripe · SSL</span>
              </div>
              <div className="space-y-3">
                <label className="block">
                  <span className="text-[12px] text-dark/70 font-medium">Numéro de carte</span>
                  <input
                    value={card.number}
                    onChange={(e) => setCard({ ...card, number: format(e.target.value) })}
                    placeholder="4242 4242 4242 4242"
                    className="mt-1 w-full h-11 px-3 rounded-xl border border-dark/10 bg-white text-[15px] mono focus:border-green-700 focus:ring-2 focus:ring-green-700/15 outline-none"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[12px] text-dark/70 font-medium">Expiration</span>
                    <input
                      value={card.exp}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                        setCard({ ...card, exp: v.length >= 3 ? v.slice(0, 2) + '/' + v.slice(2) : v });
                      }}
                      placeholder="MM / AA"
                      className="mt-1 w-full h-11 px-3 rounded-xl border border-dark/10 bg-white text-[15px] mono focus:border-green-700 focus:ring-2 focus:ring-green-700/15 outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[12px] text-dark/70 font-medium">Cryptogramme</span>
                    <input
                      value={card.cvc}
                      onChange={(e) => setCard({ ...card, cvc: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                      placeholder="123"
                      className="mt-1 w-full h-11 px-3 rounded-xl border border-dark/10 bg-white text-[15px] mono focus:border-green-700 focus:ring-2 focus:ring-green-700/15 outline-none"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="text-[12px] text-dark/70 font-medium">Nom sur la carte</span>
                  <input
                    value={card.name}
                    onChange={(e) => setCard({ ...card, name: e.target.value })}
                    placeholder="Jean Dupont"
                    className="mt-1 w-full h-11 px-3 rounded-xl border border-dark/10 bg-white text-[15px] focus:border-green-700 focus:ring-2 focus:ring-green-700/15 outline-none"
                  />
                </label>
              </div>

              <div className="mt-5 flex items-start gap-3 p-3 rounded-xl bg-green-100/60 border border-green-300/40">
                <span className="text-xl">🛡️</span>
                <p className="text-[12px] text-dark/75 leading-relaxed">
                  <span className="font-semibold text-green-900">Paiement 100% sécurisé.</span> Remboursement garanti si le producteur annule la commande.
                </p>
              </div>
            </form>
          </div>

          <aside className="lg:sticky lg:top-24 bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
            <h2 className="font-serif text-[24px] text-green-900">À régler</h2>
            <div className="mt-4 flex items-baseline justify-between">
              <span className="text-[14px] text-dark/60">Total TTC</span>
              <span className="font-serif text-[38px] text-green-900 tabular-nums">{ORDER.total.toFixed(2).replace('.', ',')} €</span>
            </div>
            <Button type="button" size="lg" className="w-full mt-6" disabled={!valid || processing} onClick={handlePay}>
              {processing ? 'Traitement…' : `Payer ${ORDER.total.toFixed(2).replace('.', ',')} €`}
            </Button>
            <p className="text-[11px] text-dark/50 text-center mt-3">Vous recevrez un code de commande à présenter au retrait.</p>
          </aside>
        </div>
      </section>
      <Footer />
    </div>
  );
}
