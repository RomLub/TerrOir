import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui";
import { FranceMapCoverage } from "@/components/ui/france-map-coverage";
import { getCoverageDepartments } from "@/lib/products/fetch-coverage-departments";
import { NEXT_PUBLIC_APP_URL } from "@/lib/env/urls";

// Page /livraison (P0 légales 2026-05-06, V2 du 2026-05-06).
//
// Modèle de livraison TerrOir actuel :
//   1. Retrait à la ferme (mode principal, gratuit)
//   2. Envoi postal pour denrées non-périssables uniquement (frais
//      forfaitaires fixés par le producer, à la charge du consumer)
//
// Hors scope cette page :
//   - Livraison à domicile dédiée (pas implémentée)
//   - Cabane / point de collecte producteurs (V2)
//
// Liens entrants attendus :
//   - Footer global (colonne Aide)
//   - app/(public)/comment-ca-marche/page.tsx (CTA fin de page)
//   - app/(public)/contact/page.tsx (bloc "Avant de nous contacter")
//
// Liens sortants implémentés :
//   - /contact (CTA répétés bloc 4, 5, 6 + lien dans Q3 FAQ)
//   - /producteurs (CTA bloc 6 final)
//   - /comment-ca-marche (CTA bloc 6 final)
//   - /faq (CTA "FAQ complète" bloc 5)
//
// Data fetching : getCoverageDepartments() Server Component, cache
// unstable_cache 600s + tag 'coverage-departments'. Pas d'appel
// Supabase si le cache est chaud — pas de RLS issue (admin client +
// counts agrégés zéro PII).

export const metadata: Metadata = {
  title: "Livraison et retrait — TerrOir | Marketplace producteurs Sarthe",
  description:
    "Récupérez vos produits directement chez le producteur (retrait à la ferme gratuit) ou par envoi postal pour les produits secs. France métropolitaine.",
  alternates: {
    canonical: `${NEXT_PUBLIC_APP_URL}/livraison`,
  },
  robots: { index: true, follow: true },
};

const RETRAIT_BENEFITS = [
  { icon: "🤝", title: "Vous rencontrez le producteur" },
  { icon: "🌾", title: "Vous voyez la ferme" },
  { icon: "0 €", title: "Pas de frais de livraison" },
  { icon: "❄️", title: "Produits ultra-frais, préparés juste avant le retrait" },
];

const POSTAL_OK = ["miel", "farine", "confitures", "conserves", "savons"];
const POSTAL_KO = [
  "viande fraîche",
  "fromages frais",
  "fruits et légumes frais",
  "pain frais",
  "œufs",
];

const FAQ_ITEMS = [
  {
    q: "Que faire si je rate mon créneau de retrait ?",
    a: (
      <>
        Contactez directement le producteur (ses coordonnées sont sur sa
        fiche), un nouveau créneau pourra être convenu ensemble.
      </>
    ),
  },
  {
    q: "Puis-je grouper plusieurs producteurs en une seule livraison ?",
    a: (
      <>
        Pas pour l&apos;instant. Chaque commande chez un producteur fait
        l&apos;objet d&apos;un retrait ou d&apos;un envoi distinct. Nous
        travaillons sur des solutions de regroupement pour plus tard.
      </>
    ),
  },
  {
    q: "Mon colis postal est arrivé en retard ou abîmé. Que faire ?",
    a: (
      <>
        Signalez-le-nous via{" "}
        <Link
          href="/contact"
          className="text-green-900 underline decoration-dotted underline-offset-4 hover:text-terra-700"
        >
          le formulaire de contact
        </Link>{" "}
        ou directement au producteur. Nous trouvons une solution ensemble.
      </>
    ),
  },
];

export default async function LivraisonPage() {
  const coverage = await getCoverageDepartments();

  return (
    <div className="bg-bg">
      {/* HERO */}
      <section className="max-w-4xl mx-auto px-6 pt-20 pb-12 text-center">
        <span className="text-[11px] uppercase tracking-[0.2em] text-terra-700 font-semibold">
          Pratique
        </span>
        <h1 className="mt-3 font-serif text-[44px] md:text-[64px] text-green-900 leading-[1.04] tracking-tight">
          Livraison et retrait
        </h1>
        <p className="mt-6 text-[17px] text-dark/70 max-w-2xl mx-auto leading-relaxed">
          Récupérez vos produits directement chez le producteur ou recevez-les
          par envoi postal pour les denrées non périssables.
        </p>
      </section>

      {/* BLOC 1 — RETRAIT À LA FERME */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="rounded-2xl border border-dark/[0.06] bg-white p-7 md:p-12 shadow-soft">
          <div className="grid md:grid-cols-[5fr_7fr] gap-8 md:gap-12 items-start">
            <div>
              <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">
                Mode principal
              </span>
              <h2 className="mt-2 font-serif text-[32px] md:text-[40px] text-green-900 leading-tight">
                Retrait à la ferme
              </h2>
              <p className="mt-4 text-[15px] text-dark/75 leading-relaxed">
                Le cœur du modèle TerrOir : vous rencontrez votre producteur,
                vous voyez l&apos;exploitation, vous repartez avec vos produits.
                <strong className="text-green-900"> Gratuit.</strong>
              </p>
            </div>

            <div className="space-y-4">
              <ol className="space-y-3 text-[15px] text-dark/75 leading-relaxed list-none">
                <li className="flex gap-3">
                  <span className="font-serif text-[20px] text-terra-700 tabular-nums leading-none">
                    01
                  </span>
                  <span>
                    Vous choisissez un créneau lors de la commande.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="font-serif text-[20px] text-terra-700 tabular-nums leading-none">
                    02
                  </span>
                  <span>
                    Vous récupérez votre commande directement à la ferme du
                    producteur.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="font-serif text-[20px] text-terra-700 tabular-nums leading-none">
                    03
                  </span>
                  <span>
                    Adresse et créneaux disponibles indiqués sur chaque fiche
                    producteur.
                  </span>
                </li>
              </ol>
            </div>
          </div>

          <ul className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {RETRAIT_BENEFITS.map((b) => (
              <li
                key={b.title}
                className="flex items-start gap-3 rounded-xl bg-green-100/40 px-4 py-3"
              >
                <span
                  aria-hidden
                  className="text-[18px] leading-none mt-0.5 font-serif text-green-900"
                >
                  {b.icon}
                </span>
                <span className="text-[13px] text-dark/80 leading-snug">
                  {b.title}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* BLOC 2 — ENVOI POSTAL */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="rounded-2xl border border-dark/[0.06] bg-white p-7 md:p-12 shadow-soft">
          <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">
            Mode secondaire
          </span>
          <h2 className="mt-2 font-serif text-[32px] md:text-[40px] text-green-900 leading-tight">
            Envoi postal
          </h2>
          <p className="mt-4 text-[15px] text-dark/75 leading-relaxed max-w-2xl">
            Pour les denrées non périssables, certains producteurs proposent un
            envoi postal en France métropolitaine.
          </p>

          <div className="mt-8 grid md:grid-cols-2 gap-6">
            <div className="rounded-xl border border-green-700/40 bg-green-100/30 p-5">
              <div className="text-[12px] uppercase tracking-[0.16em] text-green-700 font-semibold">
                Possible par envoi postal
              </div>
              <ul className="mt-3 flex flex-wrap gap-2">
                {POSTAL_OK.map((item) => (
                  <li
                    key={item}
                    className="inline-flex items-center rounded-full bg-white px-3 py-1 text-[13px] text-green-900 border border-green-700/30"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-dark/[0.06] bg-stone-50 p-5">
              <div className="text-[12px] uppercase tracking-[0.16em] text-stone-600 font-semibold">
                Réservé au retrait à la ferme
              </div>
              <ul className="mt-3 flex flex-wrap gap-2">
                {POSTAL_KO.map((item) => (
                  <li
                    key={item}
                    className="inline-flex items-center rounded-full bg-white px-3 py-1 text-[13px] text-stone-600 border border-stone-200 line-through decoration-stone-400/60"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-8 grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-serif text-[22px] text-green-900 leading-tight">
                Comment ça marche
              </h3>
              <ul className="mt-3 space-y-2 text-[14px] text-dark/75 leading-relaxed list-disc pl-5">
                <li>
                  Le producteur vous expédie sous quelques jours ouvrés selon
                  ses modalités.
                </li>
                <li>
                  Frais de port forfaitaires fixés par chaque producteur,
                  affichés lors de la commande.
                </li>
                <li>Livraison France métropolitaine.</li>
                <li>
                  Délai indicatif : 2 à 5 jours ouvrés selon le transporteur
                  choisi par le producteur.
                </li>
              </ul>
            </div>
            <div>
              <h3 className="font-serif text-[22px] text-green-900 leading-tight">
                À noter
              </h3>
              <ul className="mt-3 space-y-2 text-[14px] text-dark/75 leading-relaxed list-disc pl-5">
                <li>
                  Le producteur reste responsable de l&apos;expédition et de
                  l&apos;emballage.
                </li>
                <li>
                  En cas de problème (colis perdu, casse), TerrOir intervient
                  en médiation —{" "}
                  <Link
                    href="/contact"
                    className="text-green-900 underline decoration-dotted underline-offset-4 hover:text-terra-700"
                  >
                    contactez-nous
                  </Link>
                  .
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* BLOC 3 — ZONE GÉOGRAPHIQUE */}
      <section className="bg-green-100/30 border-y border-dark/[0.04]">
        <div className="max-w-5xl mx-auto px-6 py-16 md:py-20">
          <div className="text-center mb-10">
            <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">
              Zone géographique
            </span>
            <h2 className="mt-2 font-serif text-[32px] md:text-[40px] text-green-900 leading-tight">
              Où trouver des producteurs
            </h2>
            <p className="mt-3 text-[15px] text-dark/70 max-w-2xl mx-auto leading-relaxed">
              Notre réseau s&apos;étend progressivement. Pour le retrait : les
              départements colorés sur la carte. Pour l&apos;envoi postal :
              France métropolitaine entière.
            </p>
          </div>

          <div className="mx-auto max-w-3xl rounded-2xl bg-white p-5 md:p-8 border border-dark/[0.06] shadow-soft">
            <FranceMapCoverage
              coveredDepartments={coverage.coveredDepartments}
              departmentProducerCounts={coverage.departmentProducerCounts}
            />
          </div>

          <p className="mt-8 text-center text-[14px] text-dark/70">
            {coverage.totalProducers > 0 ? (
              <>
                Actuellement,{" "}
                <strong className="text-green-900">
                  {coverage.totalProducers} producteur
                  {coverage.totalProducers > 1 ? "s" : ""}
                </strong>{" "}
                disponible{coverage.totalProducers > 1 ? "s" : ""} dans{" "}
                <strong className="text-green-900">
                  {coverage.totalDepartments} département
                  {coverage.totalDepartments > 1 ? "s" : ""}
                </strong>
                .
              </>
            ) : (
              <>Notre réseau de producteurs publics se constitue.</>
            )}
          </p>

          <p className="mt-3 text-center text-[14px] text-dark/65">
            Vous ne trouvez pas de producteur près de chez vous ?{" "}
            <Link
              href="/contact"
              className="text-green-900 underline decoration-dotted underline-offset-4 hover:text-terra-700"
            >
              Signalez-le-nous
            </Link>
            .
          </p>
        </div>
      </section>

      {/* BLOC 4 — PRODUITS NON CONFORMES */}
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-16">
        <h2 className="font-serif text-[32px] md:text-[40px] text-green-900 leading-tight">
          En cas de problème
        </h2>
        <p className="mt-5 text-[15px] text-dark/75 leading-relaxed">
          Si un produit n&apos;est pas conforme à votre commande à la
          réception (produit gâté, manquant, défaut), contactez-nous
          rapidement pour trouver une solution avec le producteur.
        </p>
        <p className="mt-4 text-[14px] text-violet-500 leading-relaxed">
          [PLACEHOLDER : Modalités exactes — délai signalement, photos
          preuves, médiation, remboursement / remplacement à définir
          ultérieurement]
        </p>
        <div className="mt-7">
          <Link href="/contact">
            <Button size="md" variant="secondary">
              Nous contacter →
            </Button>
          </Link>
        </div>
      </section>

      {/* BLOC 5 — FAQ RAPIDE */}
      <section className="max-w-3xl mx-auto px-6 pb-20">
        <h2 className="font-serif text-[32px] md:text-[40px] text-green-900 leading-tight">
          Questions fréquentes
        </h2>
        <div className="mt-6 divide-y divide-dark/[0.06] rounded-2xl bg-white border border-dark/[0.06] shadow-soft">
          {FAQ_ITEMS.map((item, i) => (
            <details
              key={i}
              className="group px-6 py-5"
              open={i === 0}
            >
              <summary className="flex cursor-pointer items-start justify-between gap-4 list-none [&::-webkit-details-marker]:hidden">
                <span className="font-serif text-[20px] text-green-900 leading-snug">
                  {item.q}
                </span>
                <span
                  aria-hidden
                  className="mt-1 text-2xl text-terra-700 transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <div className="mt-3 text-[15px] text-dark/75 leading-relaxed">
                {item.a}
              </div>
            </details>
          ))}
        </div>
        <p className="mt-6 text-[14px] text-dark/65">
          Vous ne trouvez pas votre réponse ?{" "}
          <Link
            href="/faq"
            className="text-green-900 underline decoration-dotted underline-offset-4 hover:text-terra-700"
          >
            Voir la FAQ complète
          </Link>
          .
        </p>
      </section>

      {/* BLOC 6 — CTA FIN */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="rounded-2xl border border-dark/[0.06] bg-white p-7 md:p-10 shadow-soft text-center">
          <p className="font-serif text-[24px] md:text-[28px] text-green-900 leading-tight">
            Une question sur la livraison ?
          </p>
          <p className="mt-2 text-[14px] text-dark/65 max-w-md mx-auto leading-relaxed">
            L&apos;équipe TerrOir vous répond sous 24 heures ouvrées.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link href="/contact">
              <Button size="md">Nous contacter →</Button>
            </Link>
            <Link href="/producteurs">
              <Button size="md" variant="secondary">
                Voir tous les producteurs
              </Button>
            </Link>
            <Link href="/comment-ca-marche">
              <Button size="md" variant="ghost">
                Comment ça marche
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
