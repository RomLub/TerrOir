import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui";

// Page placeholder /charte-qualite (P0 légales 2026-05-06).
//
// Page créée pour que le maillage interne /faq → /charte-qualite (Q4.1 +
// Q5.1) pointe vers une cible existante, en attendant la rédaction
// finale de la charte avec les producteurs partenaires. Bandeau
// placeholder violet identique au pattern /faq pour signaler clairement
// l'état "à venir".
//
// `robots: noindex, nofollow` : la page est volontairement maintenue
// hors index Google jusqu'à la publication du contenu réel — éviter
// que la version stub soit référencée comme "charte qualité TerrOir"
// par les moteurs.
//
// Liens entrants attendus :
//   - Footer global (à ajouter quand la page est finalisée)
//   - app/(public)/faq/page.tsx (Q4.1 "Qui sont les producteurs" + Q5.1
//     "Comment sont sélectionnés les producteurs")
//   - app/(public)/a-propos/page.tsx (à câbler ultérieurement)
//   - app/(public)/devenir-producteur/page.tsx (à câbler ultérieurement)
//   - app/(public)/comment-ca-marche/page.tsx (à câbler ultérieurement)

export const metadata: Metadata = {
  title: "Charte qualité — TerrOir",
  description:
    "Nos critères de sélection des producteurs et nos engagements qualité — page en cours de finalisation.",
  robots: { index: false, follow: false },
};

export default function CharteQualitePage() {
  return (
    <div className="bg-bg">
      {/* Bandeau placeholder global — pattern aligné /faq. */}
      <div
        role="status"
        className="bg-violet-50 border-b-2 border-violet-300 text-violet-900"
      >
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-500 text-white text-[13px] font-bold"
          >
            !
          </span>
          <div>
            <p className="font-semibold text-[14px] uppercase tracking-[0.12em]">
              [PLACEHOLDER] Charte qualité à venir
            </p>
            <p className="mt-1 text-[14px] leading-relaxed">
              Notre charte qualité détaillée sera publiée prochainement,
              après échange avec nos producteurs partenaires.
            </p>
          </div>
        </div>
      </div>

      {/* HERO */}
      <section className="max-w-3xl mx-auto px-6 pt-16 md:pt-20 pb-10 text-center">
        <span className="text-[11px] uppercase tracking-[0.2em] text-terra-700 font-semibold">
          Engagements
        </span>
        <h1 className="mt-3 font-serif text-[40px] md:text-[56px] text-green-900 leading-[1.05] tracking-tight">
          Charte qualité TerrOir
        </h1>
        <p className="mt-6 text-[17px] text-dark/70 leading-relaxed">
          Nos critères de sélection des producteurs et nos engagements
          qualité seront publiés ici très prochainement.
        </p>
      </section>

      {/* Texte d'attente */}
      <section className="max-w-3xl mx-auto px-6 pb-16">
        <div className="rounded-2xl border border-dark/[0.06] bg-white p-7 md:p-10 shadow-soft">
          <p className="text-[15px] text-dark/75 leading-relaxed">
            Nous sommes en train de finaliser notre charte qualité avec nos
            producteurs partenaires. Cette charte précisera nos critères
            de sélection (mode de production, distance géographique,
            transparence, engagements environnementaux) ainsi que nos
            engagements vis-à-vis des consommateurs et des producteurs.
          </p>
        </div>
      </section>

      {/* CTA fin */}
      <section className="max-w-3xl mx-auto px-6 pb-20">
        <div className="rounded-2xl border border-dark/[0.06] bg-white p-7 md:p-10 shadow-soft text-center">
          <p className="font-serif text-[24px] md:text-[28px] text-green-900 leading-tight">
            Une question sur nos critères&nbsp;?
          </p>
          <p className="mt-2 text-[14px] text-dark/65 max-w-md mx-auto leading-relaxed">
            L&apos;équipe TerrOir vous répond sous 24 heures ouvrées.
          </p>
          <div className="mt-6">
            <Link href="/contact">
              <Button size="md">Contactez-nous →</Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
