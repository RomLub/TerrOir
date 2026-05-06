'use client';

import Link from 'next/link';
import { Button } from '@/components/ui';

const VALUES = [
  { title: 'Transparence', text: "Chaque éleveur affiche son nom, son adresse, ses pratiques. Tu sais exactement d'où vient ta viande, et qui l'a produite." },
  { title: 'Qualité', text: "Pas de centrale d'achat, pas de mois en chambre froide. Des bêtes élevées dans le respect, des morceaux préparés à la demande." },
  { title: 'Lien humain', text: "Le retrait à la ferme n'est pas une contrainte, c'est le cœur du projet. Rencontre l'éleveur, vois le pré, pose tes questions." },
];

export default function AProposPage() {
  return (
    <div className="bg-bg">
      <section className="max-w-5xl mx-auto px-6 pt-20 pb-12 text-center">
        <span className="text-[11px] uppercase tracking-[0.2em] text-terra-700 font-semibold">Notre histoire</span>
        <h1 className="mt-3 font-serif text-[44px] md:text-[68px] text-green-900 leading-[1.02] tracking-tight">
          Une marketplace<br/>née dans la Sarthe.
        </h1>
        <p className="mt-6 text-[17px] text-dark/70 max-w-2xl mx-auto leading-relaxed">
          Nous croyons qu&apos;il existe un autre modèle pour la viande. Plus court, plus juste, plus humain.
        </p>
      </section>

      <section className="max-w-7xl mx-auto px-6 mb-20">
        <div className="aspect-[16/7] rounded-3xl flex items-center justify-center text-green-900/30 font-mono text-[12px] uppercase tracking-wider"
             style={{ backgroundImage: 'repeating-linear-gradient(45deg, #D8F3DC 0 14px, #C9EAD0 14px 28px)' }}>
          Photo panoramique — ferme sarthoise au lever du soleil
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 pb-20">
        <div className="grid md:grid-cols-[5fr_7fr] gap-10 md:gap-16 items-start">
          <div>
            <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">2024 — Le démarrage</span>
            <h2 className="mt-2 font-serif text-[38px] md:text-[48px] text-green-900 leading-tight">
              Tout est parti d&apos;un constat simple.
            </h2>
          </div>
          <div className="space-y-5 text-[16px] text-dark/80 leading-relaxed">
            <p>En 2024, à force d&apos;écouter les éleveurs de la Sarthe, un même refrain revenait : ils n&apos;avaient plus la main sur leur prix de vente. Pris entre les centrales d&apos;achat et la grande distribution, beaucoup peinaient à vivre de leur métier.</p>
            <p>De l&apos;autre côté, des consommateurs cherchaient à manger mieux mais ne savaient plus où trouver une viande dont ils connaissaient l&apos;origine. Les circuits courts existaient, mais restaient confidentiels et compliqués à organiser.</p>
            <p>TerrOir est né de cette double frustration. Une plateforme simple, dédiée à la Sarthe, qui remet l&apos;éleveur et le consommateur en contact direct. Sans intermédiaire qui marge, sans logistique lourde, sans promesse marketing.</p>
            <p className="font-serif text-[22px] text-green-900 italic">« Notre vision : que chaque famille sarthoise connaisse l&apos;éleveur qui la nourrit. »</p>
          </div>
        </div>
      </section>

      <section className="bg-green-100/40 border-y border-dark/[0.04]">
        <div className="max-w-7xl mx-auto px-6 py-20 md:py-24">
          <div className="text-center mb-14">
            <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Nos valeurs</span>
            <h2 className="mt-2 font-serif text-[36px] md:text-[44px] text-green-900 leading-tight">Trois principes, jamais négociés.</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {VALUES.map((v, i) => (
              <article key={v.title} className="bg-white rounded-2xl p-7 border border-dark/[0.06] shadow-soft">
                <div className="font-serif text-[44px] text-terra-700 tabular-nums leading-none">0{i + 1}</div>
                <h3 className="mt-4 font-serif text-[26px] text-green-900 leading-tight">{v.title}</h3>
                <p className="mt-3 text-[14px] text-dark/75 leading-relaxed">{v.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-20 grid sm:grid-cols-3 gap-8 text-center">
        {[{ n: '23', l: 'Éleveurs partenaires' }, { n: '6%', l: 'Commission unique' }, { n: '0', l: 'Intermédiaire' }].map((s) => (
          <div key={s.l}>
            <div className="font-serif text-[64px] md:text-[80px] text-green-900 leading-none tabular-nums">{s.n}</div>
            <div className="mt-2 text-[12px] uppercase tracking-[0.14em] text-dark/60 font-semibold">{s.l}</div>
          </div>
        ))}
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-12">
        <div className="rounded-2xl border border-dark/[0.08] bg-white p-7 md:p-10 shadow-soft text-center">
          <p className="font-serif text-[24px] md:text-[28px] text-green-900 leading-tight">
            Une question ?
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

      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="bg-terra-700 text-white rounded-3xl p-10 md:p-16 text-center">
          <span className="text-[11px] uppercase tracking-[0.2em] text-terra-100 font-semibold">Tu es éleveur ?</span>
          <h2 className="mt-3 font-serif text-[36px] md:text-[48px] leading-tight">Rejoins la première marketplace dédiée à la Sarthe.</h2>
          <p className="mt-4 text-[16px] text-terra-100/90 max-w-xl mx-auto">6% de commission. Une page dédiée. Le contrôle total sur tes prix et tes créneaux.</p>
          <div className="mt-7">
            <Link href="/devenir-producteur">
              <Button size="lg" className="bg-white text-terra-700 hover:bg-terra-100">Devenir producteur →</Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
