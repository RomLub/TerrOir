import Link from 'next/link';
import type { Metadata } from 'next';
import { Logo, Button } from '@/components/ui';
import { NEXT_PUBLIC_APP_URL } from '@/lib/env/urls';

const APPLY_URL = `${NEXT_PUBLIC_APP_URL}/devenir-producteur`;
const CONSUMER_URL = `${NEXT_PUBLIC_APP_URL}/`;

export const metadata: Metadata = {
  title: 'Devenir producteur partenaire — TerrOir',
  description:
    'Vendez en direct aux consommateurs sarthois. TerrOir est la marketplace circuit court qui vous connecte aux amateurs de produits locaux. Commission 6% unique, paiement garanti.',
};

const STEPS = [
  {
    n: '01',
    title: 'Candidatez en 48h',
    text: "Déposez votre candidature en ligne. Un membre de l'équipe TerrOir vous rappelle sous 48h pour échanger sur votre exploitation.",
  },
  {
    n: '02',
    title: 'Publiez votre catalogue',
    text: 'Créez votre page producteur, ajoutez vos produits, définissez vos créneaux de retrait à la ferme. Vous gardez la main sur tout.',
  },
  {
    n: '03',
    title: 'Vendez en direct',
    text: 'Les clients commandent et paient en ligne. Vous préparez la commande, ils passent la récupérer au créneau choisi.',
  },
];

const COMMITMENTS = [
  {
    n: '6%',
    title: 'Commission unique',
    text: "Pas d'abonnement, pas de frais cachés. Vous payez 6% uniquement sur les commandes finalisées.",
  },
  {
    n: '01',
    title: 'Une page dédiée à votre ferme',
    text: 'Racontez votre histoire, mettez en avant vos labels et vos pratiques. Une vitrine que vous contrôlez.',
  },
  {
    n: '✓',
    title: 'Paiement garanti',
    text: "Le client paie au retrait. Pas d'impayés, pas de relances : la commande est validée avant le passage à la ferme.",
  },
];

const FAQ = [
  {
    q: 'Quelle commission prélevez-vous ?',
    a: "6% TTC, uniquement sur les commandes finalisées. Aucun abonnement, aucun frais d'inscription.",
  },
  {
    q: 'Comment sont payés les producteurs ?',
    a: 'Via Stripe Connect. Les fonds sont reversés automatiquement après chaque retrait client validé.',
  },
  {
    q: 'Faut-il livrer les commandes ?',
    a: 'Non. Les clients viennent récupérer à la ferme sur les créneaux que vous définissez. Pas de logistique à gérer.',
  },
  {
    q: 'Quelle zone géographique est couverte ?',
    a: "TerrOir est aujourd'hui déployé en Sarthe. D'autres territoires viendront ensuite.",
  },
  {
    q: 'Quel délai pour la première vente ?',
    a: 'Une fois validé, vous pouvez publier votre catalogue immédiatement. Les premiers clients commandent dans les jours qui suivent.',
  },
];

export default function ProAccueilPage() {
  const year = new Date().getFullYear();

  return (
    <div className="bg-bg min-h-screen flex flex-col">
      <header className="border-b border-dark/[0.06] bg-white">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Logo size="md" href="/" />
          <Link
            href="/connexion"
            className="text-sm text-dark/70 hover:text-green-700 transition-colors"
          >
            Connexion
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="bg-green-900 text-white">
          <div className="max-w-7xl mx-auto px-6 py-20 md:py-28">
            <div className="max-w-3xl">
              <span className="text-[11px] uppercase tracking-[0.2em] text-terra-300 font-semibold">
                Espace producteur · Sarthe
              </span>
              <h1 className="mt-3 font-serif text-[44px] md:text-[68px] leading-[1.02] tracking-tight">
                Vendez en direct
                <br />
                aux consommateurs sarthois.
              </h1>
              <p className="mt-6 text-[17px] text-white/80 max-w-2xl leading-relaxed">
                TerrOir est la marketplace circuit court qui vous connecte aux amateurs de produits locaux. Vous fixez vos prix, vos créneaux, vos quantités. Commission 6% unique, paiement garanti.
              </p>
              <div className="mt-8 flex items-center gap-4 flex-wrap">
                <a href={APPLY_URL}>
                  <Button size="lg" className="bg-terra-700 text-white hover:bg-terra-700/90">
                    Candidater →
                  </Button>
                </a>
                <Link
                  href="/connexion"
                  className="inline-flex items-center px-5 py-3 rounded-md border border-white/30 text-white text-sm font-medium hover:bg-white/10 transition-colors"
                >
                  Déjà membre ? Connexion
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-6 py-20 md:py-24">
          <div className="text-center mb-12">
            <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">
              Comment ça marche
            </span>
            <h2 className="mt-2 font-serif text-[36px] md:text-[44px] text-green-900 leading-tight">
              De votre ferme à vos clients, en trois étapes.
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {STEPS.map((s) => (
              <article
                key={s.n}
                className="bg-white rounded-2xl p-7 border border-dark/[0.06] shadow-soft"
              >
                <div className="font-serif text-[40px] text-terra-700 tabular-nums leading-none">
                  {s.n}
                </div>
                <h3 className="mt-4 font-serif text-[22px] text-green-900 leading-tight">
                  {s.title}
                </h3>
                <p className="mt-3 text-[14px] text-dark/75 leading-relaxed">
                  {s.text}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="bg-green-100/40 border-y border-dark/[0.04]">
          <div className="max-w-7xl mx-auto px-6 py-20 md:py-24">
            <div className="text-center mb-12">
              <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">
                Nos engagements
              </span>
              <h2 className="mt-2 font-serif text-[36px] md:text-[44px] text-green-900 leading-tight">
                Trois promesses, pour vous.
              </h2>
            </div>
            <div className="grid md:grid-cols-3 gap-6">
              {COMMITMENTS.map((c) => (
                <article
                  key={c.title}
                  className="bg-white rounded-2xl p-7 border border-dark/[0.06] shadow-soft"
                >
                  <div className="font-serif text-[56px] text-terra-700 tabular-nums leading-none">
                    {c.n}
                  </div>
                  <h3 className="mt-4 font-serif text-[24px] text-green-900 leading-tight">
                    {c.title}
                  </h3>
                  <p className="mt-3 text-[14px] text-dark/75 leading-relaxed">
                    {c.text}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="max-w-3xl mx-auto px-6 py-20 md:py-24">
          <div className="text-center mb-12">
            <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">
              Questions fréquentes
            </span>
            <h2 className="mt-2 font-serif text-[36px] md:text-[44px] text-green-900 leading-tight">
              Vos questions, nos réponses.
            </h2>
          </div>
          <div className="space-y-6">
            {FAQ.map((item) => (
              <article
                key={item.q}
                className="border-b border-dark/[0.08] pb-6 last:border-0"
              >
                <h3 className="font-serif text-[20px] text-green-900 leading-tight">
                  {item.q}
                </h3>
                <p className="mt-2 text-[14px] text-dark/75 leading-relaxed">
                  {item.a}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="bg-terra-700 text-white">
          <div className="max-w-5xl mx-auto px-6 py-16 md:py-20 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <h2 className="font-serif text-[32px] md:text-[40px] leading-tight">
                Prêt à nous rejoindre ?
              </h2>
              <p className="mt-3 text-[15px] text-terra-100/90 max-w-xl">
                Réponse sous 48h · Entretien téléphonique · Sans engagement
              </p>
            </div>
            <a href={APPLY_URL}>
              <Button size="lg" className="bg-white text-terra-700 hover:bg-terra-100">
                Déposer ma candidature →
              </Button>
            </a>
          </div>
        </section>
      </main>

      <footer className="bg-white border-t border-dark/[0.06]">
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4 text-[13px] text-dark/60">
          <Logo size="sm" href="/" />
          <div className="flex items-center gap-6 flex-wrap">
            <a
              href={CONSUMER_URL}
              className="hover:text-green-700 transition-colors"
            >
              Voir la marketplace consommateur
            </a>
            <span>© {year} TerrOir</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
