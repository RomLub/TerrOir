'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, Input, Textarea } from '@/components/ui';

const ADVANTAGES = [
  { n: '6%', title: 'Commission unique', text: "Pas d'abonnement, pas de frais cachés. Tu payes 6% uniquement sur les commandes finalisées." },
  { n: '01', title: 'Une page dédiée à ta ferme', text: "Raconte ton histoire, mets en avant tes labels et tes pratiques. Une vitrine que tu contrôles." },
  { n: '✓', title: 'Paiement garanti', text: "Le client paie en ligne au moment de la commande. Pas d'impayés, pas de relances : tu prépares la commande en toute sérénité." },
];

type SubmitStatus = 'created' | 'updated';

export default function DevenirProducteurPage() {
  const [form, setForm] = useState({ prenom: '', nom: '', email: '', phone: '', exploitation: '', commune: '', message: '' });
  const [sent, setSent] = useState<SubmitStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const valid = form.prenom && form.nom && form.email && form.phone && form.exploitation && form.commune;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    setError(null);

    const message = form.message.trim();
    const res = await fetch('/api/producer-interests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prenom: form.prenom.trim(),
        nom: form.nom.trim(),
        email: form.email.trim().toLowerCase(),
        telephone: form.phone.trim(),
        nom_exploitation: form.exploitation.trim(),
        commune: form.commune.trim(),
        ...(message ? { message } : {}),
      }),
    });

    setSubmitting(false);
    if (!res.ok) {
      setError('Impossible d\'envoyer ta candidature. Merci de réessayer.');
      return;
    }
    const data = (await res.json().catch(() => null)) as { status?: SubmitStatus } | null;
    setSent(data?.status === 'updated' ? 'updated' : 'created');
  };

  if (sent) {
    const heading = sent === 'updated'
      ? 'Merci, ta demande a bien été mise à jour.'
      : 'Merci, c\'est noté.';
    return (
      <div className="bg-bg">
        <section className="max-w-2xl mx-auto px-6 py-32 text-center">
          <div className="w-20 h-20 mx-auto rounded-full bg-green-100 border-2 border-green-700 flex items-center justify-center text-green-700 text-4xl">✓</div>
          <h1 className="mt-6 font-serif text-[44px] text-green-900 leading-tight">{heading}</h1>
          <p className="mt-4 text-[16px] text-dark/70 leading-relaxed">
            Nous avons bien reçu ta demande. Un membre de l&apos;équipe TerrOir va t&apos;appeler dans les 48 heures pour échanger sur ton exploitation et te présenter la plateforme.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="bg-bg">
      <section className="bg-terra-700 text-white">
        <div className="max-w-7xl mx-auto px-6 py-20 md:py-28 grid md:grid-cols-[6fr_5fr] gap-10 items-center">
          <div>
            <span className="text-[11px] uppercase tracking-[0.2em] text-terra-100 font-semibold">Pour les éleveurs sarthois</span>
            <h1 className="mt-3 font-serif text-[44px] md:text-[68px] leading-[1.02] tracking-tight">
              Reprends la main<br/>sur ton prix.
            </h1>
            <p className="mt-6 text-[17px] text-terra-100/90 max-w-lg leading-relaxed">
              TerrOir te met en contact direct avec les consommateurs sarthois. Tu fixes tes prix, tes créneaux, tes quantités. Nous nous occupons du reste.
            </p>
            <div className="mt-8 flex items-center gap-6 flex-wrap">
              <a href="#formulaire">
                <Button size="lg" className="bg-white text-terra-700 hover:bg-terra-100">Déposer ma candidature →</Button>
              </a>
              <span className="text-[13px] text-terra-100/80">Réponse sous 48h · Entretien téléphonique</span>
            </div>
          </div>
          <div className="aspect-4/5 rounded-2xl hidden md:flex items-center justify-center text-white/40 font-mono text-[11px] uppercase tracking-wider"
               style={{ backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0 14px, rgba(255,255,255,0.04) 14px 28px)' }}>
            Photo éleveur en pré
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 py-20 md:py-24">
        <div className="text-center mb-12">
          <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Pourquoi TerrOir</span>
          <h2 className="mt-2 font-serif text-[36px] md:text-[44px] text-green-900 leading-tight">Trois engagements, pour toi.</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {ADVANTAGES.map((a) => (
            <article key={a.title} className="bg-white rounded-2xl p-7 border border-dark/[0.06] shadow-soft">
              <div className="font-serif text-[56px] text-terra-700 tabular-nums leading-none">{a.n}</div>
              <h3 className="mt-4 font-serif text-[24px] text-green-900 leading-tight">{a.title}</h3>
              <p className="mt-3 text-[14px] text-dark/75 leading-relaxed">{a.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-16">
        <div className="rounded-2xl border border-dark/[0.08] bg-white p-7 md:p-10 shadow-soft text-center">
          <p className="font-serif text-[24px] md:text-[28px] text-green-900 leading-tight">
            Une question avant de candidater ?
          </p>
          <p className="mt-2 text-[14px] text-dark/65 max-w-md mx-auto leading-relaxed">
            L&apos;équipe TerrOir te répond sous 24 heures ouvrées.
          </p>
          <div className="mt-5">
            <Link href="/contact">
              <Button size="md" variant="secondary">Nous contacter →</Button>
            </Link>
          </div>
        </div>
      </section>

      <section id="formulaire" className="bg-green-100/40 border-y border-dark/[0.04] scroll-mt-20">
        <div className="max-w-3xl mx-auto px-6 py-20 md:py-24">
          <div className="text-center mb-10">
            <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Candidature</span>
            <h2 className="mt-2 font-serif text-[36px] md:text-[44px] text-green-900 leading-tight">Parle-nous de ton exploitation.</h2>
            <p className="mt-3 text-[15px] text-dark/70">Nous te rappelons sous 48h pour faire connaissance.</p>
          </div>

          <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 md:p-10 border border-dark/[0.06] shadow-soft space-y-5">
            <div className="grid sm:grid-cols-2 gap-4">
              <Input label="Prénom" value={form.prenom} onChange={update('prenom')} autoComplete="given-name" required />
              <Input label="Nom" value={form.nom} onChange={update('nom')} autoComplete="family-name" required />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Input label="Email" type="email" value={form.email} onChange={update('email')} autoComplete="email" required />
              <Input label="Téléphone" type="tel" value={form.phone} onChange={update('phone')} autoComplete="tel" required />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Input label="Nom de l'exploitation" value={form.exploitation} onChange={update('exploitation')} required />
              <Input label="Commune" value={form.commune} onChange={update('commune')} autoComplete="address-level2" required />
            </div>
            <Textarea label="Ton message (optionnel)" rows={5} value={form.message} onChange={update('message')}
                      placeholder="Parle-nous de ton activité, tes labels, tes volumes…" />

            <div className="pt-2">
              <Button type="submit" size="lg" className="w-full" disabled={!valid || submitting}>
                {submitting ? 'Envoi…' : 'Envoyer ma demande →'}
              </Button>
              {error && (
                <p className="text-[13px] text-terra-700 text-center mt-3">{error}</p>
              )}
              <p className="text-[12px] text-dark/55 text-center mt-3">
                En envoyant ce formulaire, tu acceptes d&apos;être recontacté par l&apos;équipe TerrOir.
              </p>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
