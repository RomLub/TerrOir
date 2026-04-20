'use client';

import { useState } from 'react';
import { Button, Input, Textarea } from '@/components/ui';
import { ProducerLayout } from '../_components/ProducerLayout';

type Settings = {
  name: string;
  address: string;
  siret: string;
  iban: string;
  bic: string;
  holder: string;
  notifyEmail: boolean;
  notifySms: boolean;
};

const INITIAL: Settings = {
  name: 'Ferme des Chênes',
  address: '2 chemin des Chênes\n71120 Charolles\nFrance',
  siret: '812 345 678 00012',
  iban: 'FR76 3000 1000 0123 4567 8901 234',
  bic: 'BNPAFRPPXXX',
  holder: 'EARL Ferme des Chênes',
  notifyEmail: true,
  notifySms: false,
};

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-center justify-between gap-4 py-3 cursor-pointer">
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-medium text-green-900">{label}</div>
        {hint && <div className="text-[12px] text-dark/55 mt-0.5">{hint}</div>}
      </div>
      <span className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-green-700' : 'bg-dark/20'}`}>
        <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
      </span>
    </label>
  );
}

export default function ProducerSettingsPage() {
  const [s, setS] = useState<Settings>(INITIAL);
  const [saved, setSaved] = useState(false);

  const up = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setS((prev) => ({ ...prev, [k]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 2400);
  };

  const ibanMasked = s.iban.length > 8
    ? `${s.iban.slice(0, 4)} •••• •••• •••• •••• ${s.iban.slice(-4)}`
    : s.iban;

  return (
    <ProducerLayout>
      <div className="max-w-3xl mx-auto px-8 py-10">
        <header className="mb-8">
          <div className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Paramètres</div>
          <h1 className="mt-1 font-serif text-[40px] text-green-900 leading-tight">Votre compte</h1>
          <p className="text-[14px] text-dark/60 mt-1">Gérez les informations de votre exploitation, vos coordonnées bancaires et vos notifications.</p>
        </header>

        <form onSubmit={submit} className="space-y-6">
          <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
            <h2 className="font-serif text-[22px] text-green-900 mb-1">Exploitation</h2>
            <p className="text-[12px] text-dark/55 mb-5">Ces informations apparaissent sur vos factures et votre page publique.</p>
            <div className="space-y-4">
              <Input label="Nom de l'exploitation *" value={s.name} onChange={up('name')} placeholder="Ex : Ferme des Chênes" />
              <Textarea label="Adresse *" rows={3} value={s.address} onChange={up('address')} placeholder="Rue, code postal, ville" />
              <Input label="SIRET *" value={s.siret} onChange={up('siret')} placeholder="14 chiffres" hint="Visible uniquement par l'équipe TerrOir." />
            </div>
          </section>

          <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
            <h2 className="font-serif text-[22px] text-green-900 mb-1">Coordonnées bancaires</h2>
            <p className="text-[12px] text-dark/55 mb-5">Vos virements hebdomadaires arriveront sur ce compte. Stocké chiffré côté TerrOir.</p>
            <div className="space-y-4">
              <Input label="Titulaire du compte *" value={s.holder} onChange={up('holder')} />
              <Input label="IBAN *" value={s.iban} onChange={up('iban')} placeholder="FR76 …" hint={`Affiché : ${ibanMasked}`} />
              <Input label="BIC / SWIFT" value={s.bic} onChange={up('bic')} placeholder="BNPAFRPPXXX" />
            </div>
          </section>

          <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
            <h2 className="font-serif text-[22px] text-green-900 mb-1">Notifications</h2>
            <p className="text-[12px] text-dark/55 mb-2">Choisissez comment TerrOir vous avertit des nouvelles commandes.</p>
            <div className="divide-y divide-dark/[0.06]">
              <Toggle
                checked={s.notifyEmail}
                onChange={(v) => setS((prev) => ({ ...prev, notifyEmail: v }))}
                label="Notifications par email"
                hint="Nouvelles commandes, rappels de retrait, confirmations de virement."
              />
              <Toggle
                checked={s.notifySms}
                onChange={(v) => setS((prev) => ({ ...prev, notifySms: v }))}
                label="Notifications par SMS"
                hint="Alertes urgentes uniquement (nouvelle commande, retrait du jour)."
              />
            </div>
          </section>

          <div className="flex items-center justify-end gap-3 pt-2">
            {saved && (
              <span className="text-[13px] text-green-700 font-medium animate-[fadeIn_0.3s_ease-out]">
                ✓ Modifications enregistrées
              </span>
            )}
            <Button type="submit" size="lg">Enregistrer</Button>
          </div>
        </form>
      </div>

      <style jsx>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </ProducerLayout>
  );
}
