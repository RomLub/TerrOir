import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui";
import { NEXT_PUBLIC_APP_URL } from "@/lib/env/urls";

// Page /faq V2 (P0 légales 2026-05-06).
//
// Stratégie placeholder : contenu Q/R rédigé complètement (utile au
// visiteur dès maintenant), mais bandeau visible en haut signalant que
// le contenu est en cours de validation. Romain retire le bandeau lors
// de sa passe de relecture pré-launch.
//
// Robots: index, follow — décision tactique : le contenu est utile même
// en draft, l'engagement "vérifier avant launch" est interne. Le noindex
// temporaire bloquerait le référencement initial pour un bénéfice
// limité (les Q/R sont substantielles, pas du lorem ipsum).
//
// Liens entrants attendus :
//   - Footer global (colonne Aide)
//   - app/(public)/contact/page.tsx (HELP_LINKS bloc "Avant de nous contacter")
//   - app/(public)/livraison/page.tsx (sous-lien sous FAQ rapide)
//   - app/(public)/comment-ca-marche/page.tsx (sub-link discret bloc final)
//
// Liens sortants implémentés :
//   - /contact (CTA fin + Q3.5 + Q5.2)
//   - /livraison (Q2.3)
//   - /devenir-producteur (Q4.3)
//   - /politique-confidentialite (Q5.3)
//   - /charte-qualite (Q4.1 + Q5.1) — page placeholder existante
//     (commit 2026-05-06), robots:noindex jusqu'à publication finale.

export const metadata: Metadata = {
  title: "FAQ — TerrOir | Marketplace producteurs Sarthe",
  description:
    "Toutes les réponses à vos questions sur TerrOir : commandes, paiement, livraison, producteurs. Une question spécifique ? Contactez-nous.",
  alternates: {
    canonical: `${NEXT_PUBLIC_APP_URL}/faq`,
  },
  robots: { index: true, follow: true },
};

interface QA {
  q: string;
  a: React.ReactNode;
}

interface Category {
  id: string;
  title: string;
  eyebrow: string;
  items: QA[];
}

// Wrapper pour les liens internes — uniformise la classe sur toutes les
// occurrences de la FAQ.
function InternalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="text-green-900 underline decoration-dotted underline-offset-4 hover:text-terra-700"
    >
      {children}
    </Link>
  );
}

const CATEGORIES: Category[] = [
  {
    id: "comment-ca-marche",
    eyebrow: "01 — Découverte",
    title: "Comment ça marche",
    items: [
      {
        q: "Qu'est-ce que TerrOir ?",
        a: (
          <>
            TerrOir est une marketplace en ligne qui met en relation des
            producteurs alimentaires locaux de Sarthe et des départements
            limitrophes avec des consommateurs souhaitant acheter
            directement auprès d&apos;eux. Notre mission : valoriser les
            savoir-faire du terroir en garantissant un revenu juste aux
            producteurs.
          </>
        ),
      },
      {
        q: "Qui peut acheter sur TerrOir ?",
        a: (
          <>
            Toute personne majeure résidant en France métropolitaine peut
            créer un compte et passer commande.
          </>
        ),
      },
      {
        q: "Comment je crée mon compte ?",
        a: (
          <>
            Cliquez sur « Inscription » depuis la page d&apos;accueil. La
            création de compte est obligatoire pour passer commande, ce qui
            nous permet de vous offrir un meilleur service après-vente et
            de garantir la traçabilité de votre commande.
          </>
        ),
      },
      {
        q: "Est-ce gratuit pour les acheteurs ?",
        a: (
          <>
            Oui. Aucun frais d&apos;inscription, aucun abonnement. Vous
            payez uniquement le prix des produits et, le cas échéant, les
            frais d&apos;envoi postal pour les denrées non-périssables.
          </>
        ),
      },
      {
        q: "Comment fonctionne la marketplace ?",
        a: (
          <>
            Chaque producteur dispose de sa fiche personnelle avec son
            catalogue. Vous parcourez les producteurs ou directement les
            produits, ajoutez vos articles au panier, choisissez votre mode
            de récupération (retrait à la ferme ou envoi postal selon le
            producteur), et payez en une fois.
          </>
        ),
      },
    ],
  },
  {
    id: "commandes",
    eyebrow: "02 — Pratique",
    title: "Commandes",
    items: [
      {
        q: "Comment passer une commande ?",
        a: (
          <>
            Parcourez les producteurs ou les produits, ajoutez au panier,
            validez votre panier, choisissez votre mode de récupération
            (retrait à la ferme ou envoi postal), payez par carte bancaire.
            Vous recevez ensuite un email de confirmation.
          </>
        ),
      },
      {
        q: "Puis-je commander chez plusieurs producteurs en une seule fois ?",
        a: (
          <>
            Vous pouvez ajouter au panier des produits de plusieurs
            producteurs, mais chaque commande chez un producteur sera
            traitée séparément. Vous aurez donc un retrait (ou un envoi)
            distinct par producteur.
          </>
        ),
      },
      {
        q: "Comment se passe le retrait à la ferme ?",
        a: (
          <>
            Lors de la commande, vous choisissez un créneau parmi ceux
            proposés par le producteur. Le jour J, vous vous rendez à
            l&apos;adresse indiquée sur la fiche producteur pour récupérer
            votre commande. C&apos;est gratuit, et vous rencontrez
            directement le producteur. Plus de détails sur la page{" "}
            <InternalLink href="/livraison">Livraison et retrait</InternalLink>.
          </>
        ),
      },
      {
        q: "Que faire si je ne peux pas venir au créneau choisi ?",
        a: (
          <>
            Contactez directement le producteur (ses coordonnées figurent
            sur sa fiche) pour convenir d&apos;un nouveau créneau.
          </>
        ),
      },
      {
        q: "Comment fonctionne l'envoi postal ?",
        a: (
          <>
            L&apos;envoi postal est disponible uniquement pour les produits
            non-périssables (miel, farine, conserves, savons, etc.). Le
            producteur fixe ses frais d&apos;envoi forfaitaires, affichés
            au moment de la commande. Délai indicatif : 2 à 5 jours ouvrés
            selon le transporteur choisi par le producteur.
          </>
        ),
      },
      {
        q: "Puis-je modifier ou annuler une commande ?",
        a: (
          <span className="text-violet-500">
            [PLACEHOLDER : politique exacte d&apos;annulation /
            modification à confirmer dans le code TerrOir actuel — délai
            possible avant préparation, conditions, frais éventuels.]
          </span>
        ),
      },
      {
        q: "Combien de temps avant la date de retrait dois-je commander ?",
        a: (
          <span className="text-violet-500">
            [PLACEHOLDER : à confirmer selon les règles slots producer —
            généralement 24 à 48h, à vérifier dans le système créneaux.]
          </span>
        ),
      },
    ],
  },
  {
    id: "paiement",
    eyebrow: "03 — Sécurité",
    title: "Paiement",
    items: [
      {
        q: "Quels moyens de paiement acceptez-vous ?",
        a: (
          <>
            Carte bancaire (Visa, Mastercard, Carte Bleue), Apple Pay et
            Google Pay. Tous les paiements sont sécurisés par notre
            prestataire Stripe.
          </>
        ),
      },
      {
        q: "Mon paiement est-il sécurisé ?",
        a: (
          <>
            Oui. Tous les paiements sont traités par Stripe, leader mondial
            des paiements en ligne, certifié PCI DSS niveau 1. Vos données
            de carte ne transitent jamais par nos serveurs et ne sont pas
            stockées chez nous.
          </>
        ),
      },
      {
        q: "Vais-je recevoir une facture ?",
        a: (
          <>
            Oui, vous recevez automatiquement par email un récapitulatif
            de votre commande après confirmation du paiement, faisant
            office de facture.
          </>
        ),
      },
      {
        q: "Quand suis-je débité ?",
        a: (
          <>
            Au moment de la validation finale de votre commande. Le débit
            est immédiat.
          </>
        ),
      },
      {
        q: "Que faire si mon paiement est refusé ?",
        a: (
          <>
            Vérifiez les informations saisies, votre plafond bancaire, ou
            réessayez avec une autre carte. Si le problème persiste,
            contactez votre banque ou{" "}
            <InternalLink href="/contact">notre équipe</InternalLink>.
          </>
        ),
      },
    ],
  },
  {
    id: "producteurs",
    eyebrow: "04 — Réseau",
    title: "Producteurs",
    items: [
      {
        q: "Qui sont les producteurs sur TerrOir ?",
        a: (
          <>
            Des producteurs alimentaires locaux de Sarthe et des
            départements limitrophes (Anjou, Orne, Mayenne…), tous
            sélectionnés selon notre charte qualité. Voir notre{" "}
            <InternalLink href="/charte-qualite">
              Charte qualité
            </InternalLink>{" "}
            pour les critères de sélection détaillés.
          </>
        ),
      },
      {
        q: "Puis-je visiter une ferme avant de commander ?",
        a: (
          <>
            Oui, et c&apos;est même encouragé. Contactez directement le
            producteur via sa fiche producteur pour convenir d&apos;une
            visite à la ferme.
          </>
        ),
      },
      {
        q: "Comment devenir producteur sur TerrOir ?",
        a: (
          <>
            Si vous êtes producteur et souhaitez nous rejoindre, candidatez
            via notre formulaire dédié sur{" "}
            <InternalLink href="/devenir-producteur">
              Devenir producteur
            </InternalLink>
            . Nous vous recontactons sous quelques jours pour échanger sur
            votre projet.
          </>
        ),
      },
      {
        q: "Quelle commission TerrOir prend-il sur les ventes ?",
        a: (
          <>
            TerrOir prend une commission de 6% TTC sur le montant total des
            ventes au démarrage de la plateforme. Cette transparence est un
            engagement fort vis-à-vis des consommateurs et des producteurs.{" "}
            <span className="text-violet-500">
              [PLACEHOLDER : ce tarif est susceptible d&apos;évoluer selon
              les paliers de croissance — formulation finale à arrêter en
              accord avec la stratégie commerciale.]
            </span>
          </>
        ),
      },
    ],
  },
  {
    id: "confiance",
    eyebrow: "05 — Engagements",
    title: "Confiance et qualité",
    items: [
      {
        q: "Comment sont sélectionnés les producteurs ?",
        a: (
          <>
            Selon notre{" "}
            <InternalLink href="/charte-qualite">
              Charte qualité
            </InternalLink>{" "}
            : critères de production (mode d&apos;agriculture, bien-être
            animal, traçabilité), proximité géographique, transparence sur
            les pratiques, engagements environnementaux.
          </>
        ),
      },
      {
        q: "Que faire si un produit n'est pas conforme à ma commande ?",
        a: (
          <>
            Signalez-nous le problème via{" "}
            <InternalLink href="/contact">Contact</InternalLink> dans les
            meilleurs délais. Nous trouvons une solution avec le producteur
            (remboursement ou remplacement).{" "}
            <span className="text-violet-500">
              [PLACEHOLDER : modalités exactes — délai signalement,
              justificatifs photos requis, étapes de la médiation, à
              finaliser.]
            </span>
          </>
        ),
      },
      {
        q: "Mes données personnelles sont-elles protégées ?",
        a: (
          <>
            Oui. Nous respectons strictement le RGPD. Voir notre{" "}
            <InternalLink href="/politique-confidentialite">
              Politique de confidentialité
            </InternalLink>{" "}
            pour les détails.
          </>
        ),
      },
      {
        q: "Puis-je supprimer mon compte ?",
        a: (
          <>
            Oui, à tout moment depuis votre espace personnel ou en nous
            contactant. La suppression est définitive et entraîne la perte
            de votre historique.
          </>
        ),
      },
      {
        q: "Comment garantissez-vous la fraîcheur des produits ?",
        a: (
          <>
            Le retrait à la ferme garantit une fraîcheur maximale puisque
            le producteur prépare votre commande juste avant le retrait.
            Pour l&apos;envoi postal, seules les denrées non-périssables
            sont autorisées.
          </>
        ),
      },
      {
        q: "Que devient mon argent si TerrOir ferme ?",
        a: (
          <span className="text-violet-500">
            [PLACEHOLDER : à formuler — fonds versés via Stripe distribués
            au producteur après commande honorée, donc pas de risque de
            perte. Modalités Stripe Connect en cas de fermeture plateforme
            à vérifier.]
          </span>
        ),
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <div className="bg-bg">
      {/* Bandeau placeholder global — TRÈS visible en haut, à retirer
          par Romain lors de la passe de relecture pré-launch. */}
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
              [PLACEHOLDER] FAQ en cours de validation
            </p>
            <p className="mt-1 text-[14px] leading-relaxed">
              Cette FAQ est en cours de validation. Toutes les questions et
              réponses doivent être vérifiées et complétées avant le
              lancement officiel de la plateforme.
            </p>
          </div>
        </div>
      </div>

      {/* HERO */}
      <section className="max-w-3xl mx-auto px-6 pt-16 md:pt-20 pb-12 text-center">
        <span className="text-[11px] uppercase tracking-[0.2em] text-terra-700 font-semibold">
          Aide
        </span>
        <h1 className="mt-3 font-serif text-[44px] md:text-[64px] text-green-900 leading-[1.04] tracking-tight">
          Foire aux questions
        </h1>
        <p className="mt-6 text-[17px] text-dark/70 max-w-xl mx-auto leading-relaxed">
          Toutes les réponses pour acheter et vendre sur TerrOir en toute
          sérénité.
        </p>
      </section>

      {/* Sommaire */}
      <section className="max-w-3xl mx-auto px-6 pb-10">
        <nav
          aria-label="Sommaire de la FAQ"
          className="rounded-2xl border border-dark/[0.06] bg-white p-5 md:p-6 shadow-soft"
        >
          <h2 className="text-[11px] uppercase tracking-[0.16em] text-dark/55 font-semibold">
            Sommaire
          </h2>
          <ul className="mt-3 grid sm:grid-cols-2 gap-2">
            {CATEGORIES.map((cat) => (
              <li key={cat.id}>
                <a
                  href={`#${cat.id}`}
                  className="block rounded-md px-2 py-1 text-[14px] text-green-900 hover:bg-terra-100/40 hover:text-terra-700 transition-colors"
                >
                  <span className="text-dark/45 mr-2 tabular-nums text-[12px]">
                    {cat.eyebrow.split(" — ")[0]}
                  </span>
                  {cat.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </section>

      {/* Catégories */}
      {CATEGORIES.map((cat) => (
        <section
          key={cat.id}
          id={cat.id}
          aria-labelledby={`${cat.id}-title`}
          className="max-w-3xl mx-auto px-6 pb-12 md:pb-16 scroll-mt-20"
        >
          <div className="mb-6">
            <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">
              {cat.eyebrow}
            </span>
            <h2
              id={`${cat.id}-title`}
              className="mt-2 font-serif text-[28px] md:text-[36px] text-green-900 leading-tight"
            >
              {cat.title}
            </h2>
          </div>

          <div className="divide-y divide-dark/[0.06] rounded-2xl bg-white border border-dark/[0.06] shadow-soft">
            {cat.items.map((item, i) => (
              <details key={i} className="group px-6 py-5">
                <summary className="flex cursor-pointer items-start justify-between gap-4 list-none [&::-webkit-details-marker]:hidden">
                  <span className="font-serif text-[18px] md:text-[20px] text-green-900 leading-snug">
                    {item.q}
                  </span>
                  <span
                    aria-hidden
                    className="mt-1 text-2xl text-terra-700 transition-transform group-open:rotate-45 shrink-0"
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
        </section>
      ))}

      {/* CTA fin de page */}
      <section className="max-w-3xl mx-auto px-6 pb-20">
        <div className="rounded-2xl border border-dark/[0.06] bg-white p-7 md:p-10 shadow-soft text-center">
          <p className="font-serif text-[24px] md:text-[28px] text-green-900 leading-tight">
            Vous n&apos;avez pas trouvé votre réponse&nbsp;?
          </p>
          <p className="mt-2 text-[14px] text-dark/65 max-w-md mx-auto leading-relaxed">
            L&apos;équipe TerrOir vous répond sous 24 heures ouvrées.
          </p>
          <div className="mt-6">
            <Link href="/contact">
              <Button size="lg">Contactez-nous →</Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
