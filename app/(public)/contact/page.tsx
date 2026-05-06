import type { Metadata } from "next";
import Link from "next/link";
import { NEXT_PUBLIC_APP_URL } from "@/lib/env/urls";
import { ContactClient } from "./ContactClient";

// Page publique /contact — hub conversion + service client.
//
// Pattern Server Component coquille + sub-client (audit Vercel React perf
// 2026-05-05) : le formulaire interactif est isolé dans ContactClient.tsx,
// le reste (hero, blocs FAQ, coordonnées, réseaux) reste server-rendered
// pour minimiser le JS bundle public.

export const metadata: Metadata = {
  title: "Contact — TerrOir",
  description:
    "Une question, un retour, un projet ? Contactez l'équipe TerrOir. Réponse sous 24 heures ouvrées.",
  alternates: {
    canonical: `${NEXT_PUBLIC_APP_URL}/contact`,
  },
  robots: { index: true, follow: true },
};

const HELP_LINKS: Array<{
  href: string;
  label: string;
  text: string;
}> = [
  {
    href: "/faq",
    label: "FAQ",
    text: "Réponses aux questions fréquentes (paiement, retrait, qualité).",
  },
  {
    href: "/comment-ca-marche",
    label: "Comment ça marche",
    text: "Le parcours client en trois étapes : commander, retirer, déguster.",
  },
  {
    href: "/livraison",
    label: "Livraison & retrait",
    text: "Modalités de retrait à la ferme et créneaux disponibles.",
  },
  {
    href: "/devenir-producteur",
    label: "Devenir producteur",
    text: "Vous êtes éleveur ? Rejoignez la marketplace sarthoise.",
  },
];

export default function ContactPage() {
  return (
    <div className="bg-bg">
      <section className="max-w-5xl mx-auto px-6 pt-20 pb-10 text-center">
        <span className="text-[11px] uppercase tracking-[0.2em] text-terra-700 font-semibold">
          Service client
        </span>
        <h1 className="mt-3 font-serif text-[44px] md:text-[64px] text-green-900 leading-[1.04] tracking-tight">
          Contact
        </h1>
        <p className="mt-5 text-[17px] text-dark/70 max-w-2xl mx-auto leading-relaxed">
          Une question, un retour, un projet ? Écris-nous et nous te
          répondrons sous 24 heures ouvrées.
        </p>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-16">
        <div className="rounded-2xl border border-dark/[0.08] bg-white p-7 md:p-10 shadow-soft">
          <h2 className="font-serif text-[24px] md:text-[28px] text-green-900 leading-tight">
            Avant de nous contacter
          </h2>
          <p className="mt-2 text-[14px] text-dark/65">
            La réponse à ta question s&apos;y trouve peut-être déjà :
          </p>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {HELP_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="block rounded-xl border border-dark/[0.06] p-4 transition-colors hover:border-terra-700 hover:bg-terra-100/30"
                >
                  <div className="text-[15px] font-medium text-green-900">
                    {link.label}{" "}
                    <span className="text-terra-700" aria-hidden>
                      →
                    </span>
                  </div>
                  <div className="mt-1 text-[13px] text-dark/65 leading-relaxed">
                    {link.text}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="grid md:grid-cols-[5fr_7fr] gap-8 md:gap-12">
          <aside className="space-y-6">
            <div>
              <h2 className="font-serif text-[24px] text-green-900 leading-tight">
                Nous joindre
              </h2>
              <p className="mt-2 text-[14px] text-dark/65 leading-relaxed">
                Réponse garantie sous 24 heures ouvrées par l&apos;équipe TerrOir.
              </p>
            </div>

            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-[0.16em] text-dark/55 font-semibold">
                Email
              </div>
              <a
                href="mailto:contact@terroir-local.fr"
                className="text-[15px] text-green-900 underline decoration-dotted underline-offset-4 hover:text-terra-700"
              >
                contact@terroir-local.fr
              </a>
            </div>

            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-[0.16em] text-dark/55 font-semibold">
                Adresse postale
              </div>
              <p className="text-[14px] text-violet-500 leading-relaxed">
                [PLACEHOLDER : adresse postale TerrOir — raison sociale, rue,
                CP, ville Sarthe]
              </p>
            </div>

            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-[0.16em] text-dark/55 font-semibold">
                Réseaux sociaux
              </div>
              <ul className="mt-2 flex flex-wrap gap-3">
                <li>
                  <a
                    href="https://www.facebook.com/"
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    aria-label="Facebook TerrOir"
                    className="inline-flex items-center justify-center rounded-full bg-violet-500/20 text-violet-500 px-4 py-2 text-[13px] font-medium hover:bg-violet-500/30"
                  >
                    Facebook [PLACEHOLDER]
                  </a>
                </li>
                <li>
                  <a
                    href="https://www.instagram.com/"
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    aria-label="Instagram TerrOir"
                    className="inline-flex items-center justify-center rounded-full bg-violet-500/20 text-violet-500 px-4 py-2 text-[13px] font-medium hover:bg-violet-500/30"
                  >
                    Instagram [PLACEHOLDER]
                  </a>
                </li>
                <li>
                  <a
                    href="https://www.linkedin.com/"
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    aria-label="LinkedIn TerrOir"
                    className="inline-flex items-center justify-center rounded-full bg-violet-500/20 text-violet-500 px-4 py-2 text-[13px] font-medium hover:bg-violet-500/30"
                  >
                    LinkedIn [PLACEHOLDER]
                  </a>
                </li>
              </ul>
            </div>

            <p className="text-[12px] text-dark/55 leading-relaxed">
              Tes données ne sont utilisées que pour te répondre. Voir notre{" "}
              <Link
                href="/politique-confidentialite"
                className="text-green-900 underline decoration-dotted underline-offset-4 hover:text-terra-700"
              >
                politique de confidentialité
              </Link>
              .
            </p>
          </aside>

          <div>
            <ContactClient />
          </div>
        </div>
      </section>
    </div>
  );
}
