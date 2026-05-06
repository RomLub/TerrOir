'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui';

const STEPS_CONSO = [
  { n: '01', title: 'Trouvez un éleveur près de chez vous', text: "Explorez la carte interactive et filtrez par espèce, label ou distance. Chaque ferme a sa fiche détaillée." },
  { n: '02', title: 'Choisissez vos pièces et un créneau', text: "Sélectionnez vos produits et réservez un créneau de retrait à la ferme parmi ceux proposés par l'éleveur." },
  { n: '03', title: 'Récupérez et savourez', text: "Présentez votre code de commande à la ferme. Vous payez sur place, en direct, et vous repartez avec votre viande." },
];

const STEPS_PROD = [
  { n: '01', title: 'Créez votre fiche exploitation', text: "Présentez votre ferme, vos valeurs, vos labels. Une page dédiée pour raconter votre travail." },
  { n: '02', title: 'Gérez votre catalogue et vos créneaux', text: "Mettez à jour stocks et prix en temps réel. Définissez vos créneaux de retrait selon votre activité." },
  { n: '03', title: 'Recevez les commandes et vendez direct', text: "Notification à chaque commande, paiement garanti, et seulement 6% de commission. Pas d'intermédiaire en plus." },
];

const FAQ = [
  { q: 'Comment fonctionne le paiement ?', a: "Vous payez directement à l'éleveur lors du retrait, en espèces ou par carte selon ses moyens. TerrOir ne prend aucune commission sur le paiement." },
  { q: 'Et si la quantité varie au moment du retrait ?', a: "C'est normal pour de la viande à la pièce. Le prix final est ajusté au poids réel pesé à la ferme. Le total estimé sur la commande sert de base." },
  { q: 'Puis-je annuler une commande ?', a: "Oui, tant que le créneau de retrait n'est pas dépassé. Prévenez simplement l'éleveur via la messagerie pour libérer le créneau." },
  { q: "Les producteurs sont-ils vérifiés ?", a: "Tous les producteurs présents sur TerrOir sont des éleveurs sarthois certifiés. Nous vérifions les labels, l'adresse d'exploitation et le numéro SIRET avant publication." },
  { q: 'Y a-t-il une livraison à domicile ?', a: "Non. TerrOir est un site de retrait à la ferme uniquement. C'est ce qui nous permet de garder des prix justes et de préserver le lien direct." },
];

export default function CommentCaMarchePage() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="bg-bg">
      <section className="max-w-5xl mx-auto px-6 pt-20 pb-12 text-center">
        <span className="text-[11px] uppercase tracking-[0.2em] text-terra-700 font-semibold">Le fonctionnement</span>
        <h1 className="mt-3 font-serif text-[44px] md:text-[64px] text-green-900 leading-[1.02] tracking-tight">
          Du pré à votre table,<br/>en trois étapes.
        </h1>
        <p className="mt-5 text-[17px] text-dark/70 max-w-2xl mx-auto leading-relaxed">
          TerrOir met en relation directe les éleveurs de la Sarthe et les amateurs de viande de qualité. Pas d&apos;intermédiaire, pas de stock, pas de gâchis.
        </p>
      </section>

      <Section eyebrow="Côté consommateur" title="Acheter sur TerrOir" subtitle="Une commande prend moins de 3 minutes.">
        <StepsRow steps={STEPS_CONSO} variant="green" />
      </Section>

      <Section eyebrow="Côté éleveur" title="Vendre sur TerrOir" subtitle="Reprenez la main sur votre prix de vente." dark>
        <StepsRow steps={STEPS_PROD} variant="terra" />
      </Section>

      <Section eyebrow="Questions fréquentes" title="Tout ce que vous voulez savoir" subtitle={null}>
        <div className="max-w-3xl mx-auto divide-y divide-dark/[0.08] rounded-2xl bg-white border border-dark/[0.06] shadow-soft">
          {FAQ.map((item, i) => {
            const isOpen = open === i;
            return (
              <button key={i} type="button" onClick={() => setOpen(isOpen ? null : i)} className="w-full text-left px-6 py-5 hover:bg-green-100/30 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <span className="font-serif text-[20px] text-green-900 leading-snug">{item.q}</span>
                  <span className={`text-2xl text-terra-700 transition-transform ${isOpen ? 'rotate-45' : ''}`}>+</span>
                </div>
                {isOpen && <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">{item.a}</p>}
              </button>
            );
          })}
        </div>
      </Section>

      <section className="max-w-5xl mx-auto px-6 pt-16">
        <div className="rounded-2xl border border-dark/[0.08] bg-white p-7 md:p-10 shadow-soft text-center">
          <p className="font-serif text-[24px] md:text-[28px] text-green-900 leading-tight">
            Vous avez d&apos;autres questions ?
          </p>
          <p className="mt-2 text-[14px] text-dark/65 max-w-md mx-auto leading-relaxed">
            L&apos;équipe TerrOir vous répond sous 24 heures ouvrées.
          </p>
          <div className="mt-5">
            <Link href="/contact">
              <Button size="md" variant="secondary">Nous contacter →</Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className="bg-green-900 text-white rounded-3xl p-10 md:p-16 text-center">
          <h2 className="font-serif text-[36px] md:text-[48px] leading-tight">Prêt à goûter la différence ?</h2>
          <p className="mt-4 text-[16px] text-green-100/85 max-w-xl mx-auto">
            Trouvez un éleveur près de chez vous et passez votre première commande dès aujourd&apos;hui.
          </p>
          <div className="mt-7">
            <Link href="/carte"><Button size="lg">Trouver un producteur →</Button></Link>
          </div>
          <p className="mt-5 text-[13px] text-green-100/70">
            En savoir plus sur les modalités :{" "}
            <Link
              href="/livraison"
              className="text-white underline decoration-dotted underline-offset-4 hover:text-green-100"
            >
              Livraison et retrait
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}

function Section({ eyebrow, title, subtitle, dark, children }: { eyebrow: string; title: string; subtitle: string | null; dark?: boolean; children: React.ReactNode }) {
  return (
    <section className={dark ? 'bg-green-100/40 border-y border-dark/[0.04]' : ''}>
      <div className="max-w-7xl mx-auto px-6 py-20 md:py-24">
        <div className="text-center mb-12">
          <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">{eyebrow}</span>
          <h2 className="mt-2 font-serif text-[36px] md:text-[44px] text-green-900 leading-tight">{title}</h2>
          {subtitle && <p className="mt-3 text-[15px] text-dark/70 max-w-xl mx-auto">{subtitle}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

function StepsRow({ steps, variant }: { steps: { n: string; title: string; text: string }[]; variant: 'green' | 'terra' }) {
  return (
    <div className="grid md:grid-cols-3 gap-6 md:gap-8 max-w-6xl mx-auto">
      {steps.map((s, i) => (
        <div key={s.n}>
          <div className="aspect-[4/3] rounded-2xl mb-5 flex items-center justify-center text-green-900/30 font-mono text-[11px] uppercase tracking-wider"
               style={{ backgroundImage: 'repeating-linear-gradient(45deg, #D8F3DC 0 14px, #C9EAD0 14px 28px)' }}>
            Illustration étape {i + 1}
          </div>
          <div className="flex items-baseline gap-3 mb-2">
            <span className={`font-serif text-[40px] tabular-nums ${variant === 'terra' ? 'text-terra-700' : 'text-green-700'}`}>{s.n}</span>
            <h3 className="font-serif text-[22px] text-green-900 leading-tight">{s.title}</h3>
          </div>
          <p className="text-[14px] text-dark/70 leading-relaxed">{s.text}</p>
        </div>
      ))}
    </div>
  );
}
