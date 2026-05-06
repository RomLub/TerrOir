import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui";

// Page placeholder /cgv (P0 légales 2026-05-06).
//
// Page créée pour que le maillage interne footer + /mentions-legales
// → /cgv pointe vers une cible existante. Bandeau placeholder violet
// pattern aligné /faq + /charte-qualite + /mentions-legales + /cgu.
//
// `robots: noindex, nofollow` : la page est volontairement maintenue
// hors index Google jusqu'à la rédaction du contenu réel. Les CGV
// nécessiteront un travail dédié (paiement Stripe Connect, frais
// d'envoi, droit de rétractation, garanties légales conformité &
// vices cachés, modalités annulation, conditions producteurs).
//
// Liens entrants attendus :
//   - Footer global (ligne juridique)
//   - app/(public)/mentions-legales/page.tsx (liens utiles)

export const metadata: Metadata = {
  title: "Conditions générales de vente — TerrOir",
  description:
    "CGV TerrOir — page en cours de rédaction. Sera publiée avant le lancement officiel.",
  robots: { index: false, follow: false },
};

export default function CgvPage() {
  return (
    <div className="bg-bg">
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
              [PLACEHOLDER] CGV en cours de rédaction
            </p>
            <p className="mt-1 text-[14px] leading-relaxed">
              Nos conditions générales de vente seront publiées avant le
              lancement officiel de la plateforme.
            </p>
          </div>
        </div>
      </div>

      <section className="max-w-3xl mx-auto px-6 pt-16 md:pt-20 pb-10 text-center">
        <span className="text-[11px] uppercase tracking-[0.2em] text-terra-700 font-semibold">
          Cadre de vente
        </span>
        <h1 className="mt-3 font-serif text-[40px] md:text-[56px] text-green-900 leading-[1.05] tracking-tight">
          Conditions générales de vente
        </h1>
        <p className="mt-6 text-[17px] text-dark/70 leading-relaxed">
          Nos conditions générales de vente sont en cours de rédaction et
          seront publiées avant le lancement officiel de la plateforme.
        </p>
      </section>

      <section className="max-w-3xl mx-auto px-6 pb-20">
        <div className="rounded-2xl border border-dark/[0.06] bg-white p-7 md:p-10 shadow-soft text-center">
          <p className="font-serif text-[24px] md:text-[28px] text-green-900 leading-tight">
            Une question d&apos;ici là&nbsp;?
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
