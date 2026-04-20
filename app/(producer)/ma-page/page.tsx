'use client';

import { useState } from 'react';
import { Button, Badge, Input, Textarea, ProducerCard } from '@/components/ui';
import { ProducerLayout } from '../_components/ProducerLayout';

const ALL_SPECIES = ['Bœuf', 'Veau', 'Porc', 'Agneau', 'Volaille', 'Lapin'];
const ALL_LABELS = ['Agriculture Biologique', 'Label Rouge', 'HVE', 'AOP', 'Bleu-Blanc-Cœur'];

type Tab = 'preview' | 'edit';

export default function MaPagePage() {
  const [tab, setTab] = useState<Tab>('preview');
  const [form, setForm] = useState({
    name: 'Ferme des Chênes',
    shortDesc: "Élevage de bovins Charolais et d'agneaux de pré, à 15 min du Mans.",
    longStory: "La Ferme des Chênes est installée au cœur de la vallée du Loir depuis 1978. Quatre générations de Durand s'y sont succédées, avec une même conviction : on élève mieux quand on élève moins.\n\nNos 42 hectares de prairies naturelles accueillent un troupeau de bovins Charolais et un petit cheptel d'agneaux de pré.",
    species: ['Bœuf', 'Agneau'] as string[],
    labels: ['Agriculture Biologique', 'Label Rouge'] as string[],
    generations: '4',
  });
  const [saved, setSaved] = useState(false);

  const toggleArr = (key: 'species' | 'labels', value: string) => {
    setForm((f) => ({ ...f, [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value] }));
  };

  const preview = {
    name: form.name,
    commune: "Parigné-l'Évêque",
    distanceKm: 8,
    species: form.species.map((s) => s.toLowerCase()),
    labels: form.labels.map((l) => l === 'Agriculture Biologique' ? 'AB' : l === 'Label Rouge' ? 'LabelRouge' : l),
    scores: { stock: 98, response: 72, reliability: 100 },
    rating: 4.8,
    reviewCount: 127,
    productCount: 6,
  };

  return (
    <ProducerLayout>
      <div className="max-w-6xl mx-auto px-8 py-10">
        <header className="mb-6">
          <div className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Ma page</div>
          <h1 className="mt-1 font-serif text-[40px] text-green-900 leading-tight">Ma page publique</h1>
          <p className="text-[14px] text-dark/60 mt-1">Cette page représente votre exploitation auprès des consommateurs.</p>
        </header>

        <div className="flex gap-1.5 border-b border-dark/[0.08] mb-8">
          {([{ v: 'preview' as const, l: 'Prévisualisation' }, { v: 'edit' as const, l: 'Modifier' }]).map((t) => (
            <button key={t.v} onClick={() => setTab(t.v)}
              className={`px-4 py-3 text-[14px] font-medium border-b-2 -mb-px transition-colors ${
                tab === t.v ? 'border-green-700 text-green-900' : 'border-transparent text-dark/60 hover:text-green-900'
              }`}>{t.l}</button>
          ))}
        </div>

        {tab === 'preview' ? (
          <div className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft overflow-hidden">
            <div className="relative h-64 bg-green-700">
              <div className="absolute inset-0 flex items-center justify-center text-white/40 font-mono text-[11px] uppercase"
                   style={{ backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0 14px, rgba(255,255,255,0.04) 14px 28px)' }}>
                Photo principale
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-green-900/80 to-transparent" />
              <div className="absolute bottom-5 left-6 right-6">
                <h2 className="font-serif text-[40px] text-white leading-tight">{form.name}</h2>
                <p className="text-green-100/90 text-[14px] mt-1">Parigné-l&apos;Évêque · Sarthe</p>
              </div>
            </div>
            <div className="p-6">
              <p className="text-[16px] text-dark/80 leading-relaxed">{form.shortDesc}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {form.species.map((s) => <Badge key={s}>{s}</Badge>)}
                {form.labels.map((l) => <Badge key={l} variant="terra">{l}</Badge>)}
              </div>
              <div className="mt-6 text-[14px] text-dark/75 leading-relaxed whitespace-pre-line">{form.longStory}</div>
            </div>
          </div>
        ) : (
          <div className="grid lg:grid-cols-[1fr_340px] gap-8 items-start">
            <div className="space-y-6">
              <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
                <h2 className="font-serif text-[22px] text-green-900 mb-4">Informations générales</h2>
                <div className="space-y-4">
                  <Input label="Nom de l'exploitation *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  <Textarea label="Description courte" rows={2} value={form.shortDesc} onChange={(e) => setForm({ ...form, shortDesc: e.target.value })}
                    placeholder="En une phrase, votre ferme." />
                </div>
              </section>

              <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
                <h2 className="font-serif text-[22px] text-green-900 mb-4">Votre histoire</h2>
                <Textarea label="Récit long" rows={8} value={form.longStory} onChange={(e) => setForm({ ...form, longStory: e.target.value })}
                  placeholder="Racontez votre ferme, vos générations, vos pratiques…" />
              </section>

              <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
                <h2 className="font-serif text-[22px] text-green-900 mb-4">Photos</h2>
                <div className="aspect-[2/1] rounded-xl border-2 border-dashed border-dark/15 bg-bg flex flex-col items-center justify-center">
                  <div className="font-serif text-[18px] text-green-900">Photo principale</div>
                  <p className="text-[12px] text-dark/55 mt-1">Glissez une photo ici ou cliquez</p>
                </div>
                <div className="mt-3 text-[12px] text-dark/60 font-medium">Galerie (jusqu&apos;à 6 photos)</div>
                <div className="mt-2 grid grid-cols-6 gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="aspect-square rounded-lg border-2 border-dashed border-dark/15 bg-bg flex items-center justify-center text-dark/30 text-xl">+</div>
                  ))}
                </div>
              </section>

              <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
                <h2 className="font-serif text-[22px] text-green-900 mb-4">Espèces élevées</h2>
                <div className="flex flex-wrap gap-2">
                  {ALL_SPECIES.map((s) => {
                    const on = form.species.includes(s);
                    return (
                      <button key={s} type="button" onClick={() => toggleArr('species', s)}
                        className={`h-10 px-4 rounded-full text-[13px] font-medium border transition-colors ${
                          on ? 'bg-green-700 text-white border-green-700' : 'bg-white text-dark/70 border-dark/10 hover:border-green-500'
                        }`}>{s}</button>
                    );
                  })}
                </div>
              </section>

              <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
                <h2 className="font-serif text-[22px] text-green-900 mb-4">Labels & certifications</h2>
                <div className="flex flex-wrap gap-2">
                  {ALL_LABELS.map((l) => {
                    const on = form.labels.includes(l);
                    return (
                      <button key={l} type="button" onClick={() => toggleArr('labels', l)}
                        className={`h-10 px-4 rounded-full text-[13px] font-medium border transition-colors ${
                          on ? 'bg-terra-700 text-white border-terra-700' : 'bg-white text-dark/70 border-dark/10 hover:border-terra-300'
                        }`}>{l}</button>
                    );
                  })}
                </div>
              </section>

              <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
                <Input label="Depuis combien de générations ?" type="number" value={form.generations}
                  onChange={(e) => setForm({ ...form, generations: e.target.value })} />
              </section>

              <div className="flex items-center justify-between gap-3 pt-2">
                <p className="text-[12px] text-dark/55 max-w-sm">
                  {saved ? '✓ Modifications enregistrées. Votre page sera vérifiée avant publication.' : 'Vos modifications ne sont pas encore enregistrées.'}
                </p>
                <Button size="lg" onClick={() => setSaved(true)}>Enregistrer</Button>
              </div>
            </div>

            <aside className="lg:sticky lg:top-10">
              <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold mb-3">Aperçu dans la carte</div>
              <ProducerCard producer={preview} />
            </aside>
          </div>
        )}
      </div>
    </ProducerLayout>
  );
}
