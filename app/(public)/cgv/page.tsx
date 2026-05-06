import type { Metadata } from "next";
import Link from "next/link";
import { NEXT_PUBLIC_APP_URL } from "@/lib/env/urls";

// Page /cgv V1 (P0 légales 2026-05-06).
//
// Conditions générales de vente régissant la transaction commerciale
// Consumer ↔ Producer via TerrOir. À distinguer des CGU (règles
// d'usage du Site, page /cgu rédigée la veille).
//
// Modèle juridique respecté : TerrOir = intermédiaire technique pur.
// Le VENDEUR est le Producer ; TerrOir n'est PAS partie au contrat
// de vente. Stripe Connect distribue les fonds (commission TerrOir
// 6% prélevée à la source — invisible côté Consumer, option α).
// Aligné /mentions-legales section 5 + /cgu article 9.1.
//
// Frais d'envoi : forfaitaires par Producer (cohérent /livraison).
//   - Retrait à la ferme : gratuit
//   - Envoi postal : forfait Producer, denrées non-périssables
//
// Stratégie placeholder : structure complète et fonctionnelle dès
// maintenant, bandeau global violet pour signaler validation juriste
// requise avant launch officiel. Pattern aligné /mentions-legales
// + /cgu.
//
// Liens entrants attendus :
//   - Footer global (ligne juridique pied de page)
//   - app/(public)/mentions-legales/page.tsx (section liens utiles)
//   - app/(public)/cgu/page.tsx (section liens utiles + article 9.1)
//   - Flow checkout (checkbox CGV à ajouter — voir doc fix)
//
// Liens sortants implémentés :
//   - /mentions-legales (préambule + section 13 + liens utiles)
//   - /cgu (liens utiles)
//   - /politique-confidentialite (section 12 + liens utiles)
//   - /livraison (section 6.1 + liens utiles)
//   - /contact (sections 7, 8, 9, 11, 15 + liens utiles)

const LAST_UPDATED = "6 mai 2026";

export const metadata: Metadata = {
  title: "Conditions générales de vente — TerrOir",
  description:
    "Conditions générales de vente sur TerrOir : modalités de commande, livraison, paiement, droit de rétractation, garanties légales, médiation.",
  alternates: {
    canonical: `${NEXT_PUBLIC_APP_URL}/cgv`,
  },
  robots: { index: true, follow: true },
};

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

export default function CgvPage() {
  return (
    <div className="bg-bg" id="haut-de-page">
      {/* Bandeau placeholder global — pattern aligné /mentions-legales + /cgu. */}
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
              [PLACEHOLDER] CGV en cours de finalisation
            </p>
            <p className="mt-1 text-[14px] leading-relaxed">
              Ces conditions générales de vente sont en cours de
              finalisation. Le contenu définitif sera validé par un juriste
              avant le lancement officiel de la plateforme.
            </p>
          </div>
        </div>
      </div>

      {/* HERO */}
      <section className="max-w-3xl mx-auto px-6 pt-16 md:pt-20 pb-10">
        <span className="text-[11px] uppercase tracking-[0.2em] text-terra-700 font-semibold">
          Cadre de vente
        </span>
        <h1 className="mt-3 font-serif text-[40px] md:text-[56px] text-green-900 leading-[1.05] tracking-tight">
          Conditions générales de vente
        </h1>
        <p className="mt-4 text-[14px] text-dark/55">
          Date de dernière mise à jour : {LAST_UPDATED}
        </p>
      </section>

      {/* PRÉAMBULE */}
      <section className="max-w-3xl mx-auto px-6 pb-10">
        <p className="text-[15px] text-dark/75 leading-relaxed">
          Les présentes Conditions Générales de Vente (CGV) régissent les
          relations contractuelles entre :
        </p>
        <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
          <li>
            D&apos;une part, les Consommateurs (« Acheteurs ») effectuant
            un achat sur la plateforme TerrOir
          </li>
          <li>
            D&apos;autre part, les Producteurs (« Vendeurs ») proposant
            leurs produits sur la plateforme
          </li>
        </ul>
        <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
          TerrOir agit en qualité d&apos;intermédiaire technique de mise
          en relation. <strong>TerrOir n&apos;est pas partie aux contrats
          de vente</strong> conclus entre Acheteurs et Producteurs (voir{" "}
          <InternalLink href="/mentions-legales">
            mentions légales
          </InternalLink>{" "}
          et <InternalLink href="/cgu">CGU article 9.1</InternalLink>).
        </p>
        <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
          Toute commande passée sur TerrOir implique l&apos;acceptation
          pleine et entière des présentes CGV. Si vous n&apos;acceptez pas
          ces conditions, veuillez ne pas effectuer de commande.
        </p>
      </section>

      {/* SECTIONS */}
      <article className="max-w-3xl mx-auto px-6 pb-16 space-y-12">
        {/* ARTICLE 1 — DÉFINITIONS */}
        <section aria-labelledby="definitions">
          <h2
            id="definitions"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 1 — Définitions
          </h2>
          <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr] text-[14px] leading-relaxed">
            <dt className="text-dark/55 font-medium">Site</dt>
            <dd className="text-dark/85">
              la plateforme TerrOir, accessible à l&apos;adresse{" "}
              {NEXT_PUBLIC_APP_URL.replace(/^https?:\/\//, "")}.
            </dd>
            <dt className="text-dark/55 font-medium">TerrOir</dt>
            <dd className="text-dark/85">
              société éditrice du Site, intermédiaire technique de mise
              en relation (voir{" "}
              <InternalLink href="/mentions-legales">
                mentions légales
              </InternalLink>
              ).
            </dd>
            <dt className="text-dark/55 font-medium">
              Acheteur ou Consumer
            </dt>
            <dd className="text-dark/85">
              toute personne physique majeure effectuant un achat sur le
              Site à des fins personnelles non professionnelles.
            </dd>
            <dt className="text-dark/55 font-medium">
              Vendeur ou Producer
            </dt>
            <dd className="text-dark/85">
              professionnel de l&apos;agriculture ou de la transformation
              alimentaire enregistré sur le Site pour y vendre ses
              produits.
            </dd>
            <dt className="text-dark/55 font-medium">Produit</dt>
            <dd className="text-dark/85">
              tout bien proposé à la vente par un Producer sur le Site.
            </dd>
            <dt className="text-dark/55 font-medium">Commande</dt>
            <dd className="text-dark/85">
              ordre d&apos;achat passé par un Acheteur auprès d&apos;un
              Producer via le Site.
            </dd>
            <dt className="text-dark/55 font-medium">Stripe Connect</dt>
            <dd className="text-dark/85">
              prestataire de services de paiement utilisé par TerrOir
              pour traiter les paiements et distribuer les fonds.
            </dd>
            <dt className="text-dark/55 font-medium">
              Retrait à la ferme
            </dt>
            <dd className="text-dark/85">
              récupération de la Commande par l&apos;Acheteur directement
              à l&apos;adresse indiquée par le Producer.
            </dd>
            <dt className="text-dark/55 font-medium">Envoi postal</dt>
            <dd className="text-dark/85">
              expédition de la Commande par le Producer via voie postale
              (réservé aux denrées non-périssables).
            </dd>
          </dl>
        </section>

        {/* ARTICLE 2 — CHAMP D'APPLICATION */}
        <section aria-labelledby="champ">
          <h2
            id="champ"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 2 — Champ d&apos;application
          </h2>
          <h3 className="mt-4 text-[16px] font-semibold text-green-900">
            2.1 — Acceptation des CGV
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Les présentes CGV s&apos;appliquent à toute Commande passée
            sur le Site. Le fait de cocher la case d&apos;acceptation au
            moment du paiement vaut acceptation pleine et entière des
            CGV par l&apos;Acheteur.
          </p>
          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            2.2 — Modification des CGV
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            TerrOir se réserve le droit de modifier les CGV. Les CGV
            applicables à une Commande sont celles en vigueur à la date
            de passation de la Commande.
          </p>
          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            2.3 — Public concerné
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Les CGV ne s&apos;appliquent qu&apos;aux ventes B2C (Business
            to Consumer) auprès de personnes physiques majeures résidant
            en France métropolitaine, agissant à des fins non
            professionnelles.
          </p>
        </section>

        {/* ARTICLE 3 — PRODUITS ET PRIX */}
        <section aria-labelledby="produits-prix">
          <h2
            id="produits-prix"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 3 — Produits et prix
          </h2>
          <h3 className="mt-4 text-[16px] font-semibold text-green-900">
            3.1 — Description des Produits
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Les caractéristiques essentielles des Produits sont décrites
            sur chaque fiche produit. Les Producers sont responsables de
            l&apos;exactitude des informations fournies (composition,
            origine, mode de production, DLC/DDM, allergènes).
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            3.2 — Disponibilité
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Les offres de vente sont valables tant que les Produits sont
            visibles sur le Site, dans la limite des stocks disponibles,
            mis à jour par les Producers.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            3.3 — Prix
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Les prix sont indiqués en euros, toutes taxes comprises (TTC),
            fixés librement par chaque Producer. Ils n&apos;incluent pas
            les frais d&apos;envoi postal éventuels, qui sont précisés au
            moment de la Commande.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            3.4 — Évolution des prix
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            TerrOir se réserve le droit de mettre à jour les prix à tout
            moment, mais le prix appliqué à une Commande est celui en
            vigueur à la date de validation de la Commande.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            3.5 — Frais de service
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            TerrOir prélève une commission sur le montant TTC des ventes
            réalisées via la plateforme. Cette commission est intégrée au
            prix affiché et n&apos;est pas facturée séparément à
            l&apos;Acheteur. Le Producer perçoit le montant de la vente,
            déduction faite de la commission TerrOir.
          </p>
        </section>

        {/* ARTICLE 4 — COMMANDE */}
        <section aria-labelledby="commande">
          <h2
            id="commande"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 4 — Commande
          </h2>
          <h3 className="mt-4 text-[16px] font-semibold text-green-900">
            4.1 — Processus de Commande
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Pour passer une Commande, l&apos;Acheteur :
          </p>
          <ol className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-decimal pl-5">
            <li>Sélectionne les Produits souhaités et les ajoute au panier</li>
            <li>Valide son panier</li>
            <li>
              Choisit son mode de récupération (retrait à la ferme ou
              envoi postal selon les modalités du Producer)
            </li>
            <li>Saisit ses coordonnées et adresse</li>
            <li>Accepte les présentes CGV</li>
            <li>Procède au paiement</li>
          </ol>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            4.2 — Confirmation de Commande
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Après validation du paiement, l&apos;Acheteur reçoit un
            email de confirmation récapitulant les éléments de la
            Commande. Cet email fait office de récépissé de commande.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            4.3 — Plusieurs Producers
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            L&apos;Acheteur peut passer une Commande contenant des
            Produits de plusieurs Producers. Chaque Commande chez un
            Producer donne lieu à un retrait ou un envoi distinct.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            4.4 — Refus de Commande
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            TerrOir et les Producers se réservent le droit de refuser
            une Commande dans les cas suivants :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>Stock insuffisant</li>
            <li>Adresse de livraison hors zone couverte</li>
            <li>Suspicion de fraude</li>
            <li>
              Manquement antérieur de l&apos;Acheteur aux présentes CGV
              ou aux CGU
            </li>
          </ul>
        </section>

        {/* ARTICLE 5 — PAIEMENT */}
        <section aria-labelledby="paiement">
          <h2
            id="paiement"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 5 — Paiement
          </h2>
          <h3 className="mt-4 text-[16px] font-semibold text-green-900">
            5.1 — Moyens de paiement
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Les paiements s&apos;effectuent par carte bancaire (Visa,
            Mastercard, Carte Bleue), Apple Pay ou Google Pay, via le
            prestataire Stripe.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            5.2 — Sécurité des paiements
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Les paiements sont sécurisés par Stripe, certifié{" "}
            <strong>PCI DSS niveau 1</strong>. Les données bancaires de
            l&apos;Acheteur ne transitent pas par les serveurs de TerrOir
            et ne sont pas stockées par TerrOir.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            5.3 — Débit
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Le débit du compte de l&apos;Acheteur intervient au moment
            de la validation de la Commande.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            5.4 — Distribution des fonds
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Conformément au modèle d&apos;intermédiation Stripe Connect :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>L&apos;Acheteur paie le montant total de la Commande</li>
            <li>
              Stripe distribue les fonds : la commission TerrOir est
              prélevée, le solde est versé au Producer
            </li>
            <li>
              Le Producer perçoit son paiement selon le calendrier prévu
              par Stripe Connect
            </li>
          </ul>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            5.5 — Facture
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Une facture (ou document tenant lieu de facture) est mise à
            disposition de l&apos;Acheteur via son espace personnel et
            envoyée par email.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            5.6 — Défaut de paiement
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            En cas d&apos;incident de paiement (carte refusée, fonds
            insuffisants, contestation), la Commande est annulée
            automatiquement.
          </p>
        </section>

        {/* ARTICLE 6 — LIVRAISON ET RETRAIT */}
        <section aria-labelledby="livraison-retrait">
          <h2
            id="livraison-retrait"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 6 — Livraison et retrait
          </h2>
          <h3 className="mt-4 text-[16px] font-semibold text-green-900">
            6.1 — Modes disponibles
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Selon le Producer, deux modes de récupération peuvent être
            proposés :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>
              <strong>Retrait à la ferme</strong> : gratuit, à
              l&apos;adresse et sur les créneaux indiqués par le Producer
            </li>
            <li>
              <strong>Envoi postal</strong> : disponible uniquement pour
              les denrées non-périssables (miel, farine, conserves,
              savons, etc.). Frais d&apos;envoi forfaitaires fixés par
              le Producer, affichés au moment de la Commande
            </li>
          </ul>
          <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
            Pour plus de détails, voir notre page{" "}
            <InternalLink href="/livraison">Livraison et retrait</InternalLink>
            .
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            6.2 — Délais
          </h3>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>
              Retrait à la ferme : selon le créneau choisi par
              l&apos;Acheteur
            </li>
            <li>
              Envoi postal : 2 à 5 jours ouvrés à compter de
              l&apos;expédition par le Producer
            </li>
          </ul>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            6.3 — Responsabilité du Producer
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            La préparation, la conformité et l&apos;expédition de la
            Commande relèvent de la responsabilité exclusive du Producer.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            6.4 — Retrait non effectué
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Si l&apos;Acheteur ne se présente pas au créneau de retrait
            choisi :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>
              L&apos;Acheteur doit contacter directement le Producer pour
              convenir d&apos;un nouveau créneau
            </li>
            <li>
              Faute de manifestation dans un délai raisonnable, le
              Producer peut considérer la Commande comme non réclamée.
              Les modalités de remboursement éventuel sont alors
              discutées au cas par cas via TerrOir.
            </li>
          </ul>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            6.5 — Risques liés au transport
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Pour l&apos;envoi postal, les risques de perte ou
            détérioration sont transférés à l&apos;Acheteur à compter
            de la prise de possession matérielle du colis. En cas de
            litige avec le transporteur, l&apos;Acheteur peut solliciter
            l&apos;intervention de TerrOir en médiation.
          </p>
        </section>

        {/* ARTICLE 7 — DROIT DE RÉTRACTATION */}
        <section aria-labelledby="retractation">
          <h2
            id="retractation"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 7 — Droit de rétractation
          </h2>
          <p className="mt-4 text-[15px] text-dark/75 leading-relaxed">
            Conformément à l&apos;article{" "}
            <strong>L221-18 du Code de la consommation</strong>,
            l&apos;Acheteur dispose d&apos;un délai de{" "}
            <strong>14 jours calendaires</strong> à compter de la
            réception de sa Commande pour exercer son droit de
            rétractation, sans avoir à motiver sa décision.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            7.1 — Exclusions
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Conformément à l&apos;article{" "}
            <strong>L221-28 du Code de la consommation</strong>, ce droit
            ne s&apos;applique <strong>PAS</strong> dans les cas suivants :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>
              Pour les denrées <strong>périssables</strong> ou
              susceptibles de se détériorer rapidement (viande fraîche,
              fromages frais, fruits et légumes, pain frais, œufs,
              lait, etc.)
            </li>
            <li>
              Pour les biens <strong>descellés</strong> par
              l&apos;Acheteur après livraison et ne pouvant être renvoyés
              pour des raisons d&apos;hygiène (miel ouvert, conserves
              entamées, etc.)
            </li>
            <li>
              Pour les biens confectionnés ou personnalisés selon les
              spécifications de l&apos;Acheteur
            </li>
          </ul>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            7.2 — Modalités d&apos;exercice
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Pour les Produits éligibles à la rétractation :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>
              L&apos;Acheteur contacte TerrOir via{" "}
              <InternalLink href="/contact">/contact</InternalLink> en
              précisant la Commande concernée
            </li>
            <li>
              L&apos;Acheteur renvoie le Produit dans son emballage
              d&apos;origine, en bon état (frais de retour à sa charge)
            </li>
            <li>
              Le remboursement intervient sous 14 jours à compter de la
              réception du retour conforme
            </li>
          </ul>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            7.3 — Remboursement
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Le remboursement s&apos;effectue sur le moyen de paiement
            initial utilisé pour la Commande.
          </p>
        </section>

        {/* ARTICLE 8 — GARANTIES LÉGALES */}
        <section aria-labelledby="garanties">
          <h2
            id="garanties"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 8 — Garanties légales
          </h2>
          <p className="mt-4 text-[15px] text-dark/75 leading-relaxed">
            L&apos;Acheteur bénéficie des garanties légales suivantes,
            lesquelles pèsent sur le Vendeur (Producer) :
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            8.1 — Garantie légale de conformité
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            (articles <strong>L217-3 et suivants du Code de la
            consommation</strong>)
          </p>
          <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
            Le Producer est tenu de livrer un Produit conforme à la
            commande. En cas de défaut de conformité constaté dans les{" "}
            <strong>2 ans</strong> suivant la réception, l&apos;Acheteur
            peut demander :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>La réparation ou le remplacement du Produit</li>
            <li>
              À défaut, la réduction du prix ou la résolution de la vente
            </li>
          </ul>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            8.2 — Garantie des vices cachés
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            (articles <strong>1641 et suivants du Code civil</strong>)
          </p>
          <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
            Le Producer est tenu de la garantie à raison des vices
            cachés rendant le Produit impropre à l&apos;usage auquel il
            est destiné. L&apos;Acheteur peut, dans un délai de{" "}
            <strong>2 ans</strong> à compter de la découverte du vice :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>Rendre le Produit et se faire rembourser</li>
            <li>
              Conserver le Produit et obtenir une réduction du prix
            </li>
          </ul>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            8.3 — Mise en œuvre
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Pour exercer ces garanties, l&apos;Acheteur contacte TerrOir
            via <InternalLink href="/contact">/contact</InternalLink>.
            TerrOir met en relation l&apos;Acheteur et le Producer
            concerné et facilite la résolution du litige.
          </p>
        </section>

        {/* ARTICLE 9 — PRODUITS NON CONFORMES */}
        <section aria-labelledby="non-conformite">
          <h2
            id="non-conformite"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 9 — Produits non conformes à la réception
          </h2>
          <h3 className="mt-4 text-[16px] font-semibold text-green-900">
            9.1 — Signalement
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Si l&apos;Acheteur constate à la réception qu&apos;un Produit
            est :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>Manquant</li>
            <li>Endommagé</li>
            <li>Non conforme à la description</li>
          </ul>
          <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
            Il doit le signaler à TerrOir via{" "}
            <InternalLink href="/contact">/contact</InternalLink> dans
            les plus brefs délais après la réception, en fournissant si
            possible des photos justificatives.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            9.2 — Médiation
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            TerrOir intervient en médiation entre l&apos;Acheteur et le
            Producer pour trouver une solution amiable (remboursement
            intégral, remplacement, avoir).
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            9.3 — Limites
          </h3>
          <p className="mt-2 text-[14px] text-violet-500 leading-relaxed">
            [PLACEHOLDER : Modalités exactes — délai de signalement
            précis (48h ?), photos requises, étapes de médiation,
            garanties de résolution. À finaliser avec retours
            d&apos;expérience post-launch.]
          </p>
        </section>

        {/* ARTICLE 10 — RESPONSABILITÉS */}
        <section aria-labelledby="responsabilites">
          <h2
            id="responsabilites"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 10 — Responsabilités
          </h2>
          <h3 className="mt-4 text-[16px] font-semibold text-green-900">
            10.1 — Responsabilité du Producer (Vendeur)
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Le Producer est seul responsable :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>De la conformité du Produit vendu</li>
            <li>
              De la qualité, de l&apos;origine et des caractéristiques
              annoncées
            </li>
            <li>
              Du respect des règles d&apos;hygiène et sanitaires
              applicables
            </li>
            <li>De l&apos;emballage et de l&apos;expédition (envoi postal)</li>
            <li>
              De la mise à disposition au créneau convenu (retrait à la
              ferme)
            </li>
            <li>
              Des garanties légales de conformité et de vices cachés
            </li>
          </ul>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            10.2 — Responsabilité de TerrOir (Intermédiaire)
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            TerrOir agit en qualité d&apos;intermédiaire technique. À ce
            titre, TerrOir <strong>n&apos;est pas</strong> partie aux
            contrats de vente et n&apos;est pas responsable :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>De la qualité, conformité ou sécurité des Produits</li>
            <li>
              Des défaillances du Producer dans l&apos;exécution de la
              Commande
            </li>
            <li>
              Des défaillances techniques des prestataires tiers (Stripe,
              hébergeur, transporteur)
            </li>
          </ul>
          <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
            TerrOir s&apos;engage néanmoins à :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>
              Vérifier l&apos;identité des Producers à l&apos;inscription
              (KYC via Stripe Connect)
            </li>
            <li>
              Mettre en place une procédure de médiation en cas de litige
            </li>
            <li>
              Suspendre ou exclure les Producers manquant gravement à
              leurs obligations
            </li>
          </ul>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            10.3 — Force majeure
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            En cas de force majeure (cyclone, pandémie, attaque
            informatique majeure, etc.), les obligations des parties
            sont suspendues. Aucune partie ne pourra être tenue
            responsable d&apos;un manquement résultant d&apos;un événement
            de force majeure.
          </p>
        </section>

        {/* ARTICLE 11 — RÉCLAMATIONS ET MÉDIATION */}
        <section aria-labelledby="mediation">
          <h2
            id="mediation"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 11 — Réclamations et médiation
          </h2>
          <h3 className="mt-4 text-[16px] font-semibold text-green-900">
            11.1 — Réclamation amiable
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            En cas de litige, l&apos;Acheteur est invité à tenter de
            résoudre la situation à l&apos;amiable en contactant TerrOir
            via <InternalLink href="/contact">/contact</InternalLink>.
            TerrOir s&apos;engage à examiner toute réclamation dans les
            meilleurs délais.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            11.2 — Médiation de la consommation
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            À défaut de résolution amiable, conformément à
            l&apos;article{" "}
            <strong>L612-1 du Code de la consommation</strong>,
            l&apos;Acheteur peut recourir gratuitement à un médiateur
            de la consommation.
          </p>
          <p className="mt-3 text-[14px] text-violet-500 leading-relaxed">
            [PLACEHOLDER : Nom et coordonnées du médiateur agréé —
            TerrOir doit adhérer à un service de médiation avant le
            lancement officiel. Voir{" "}
            <InternalLink href="/mentions-legales">
              mentions légales
            </InternalLink>{" "}
            pour le détail.]
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            11.3 — Plateforme européenne ODR
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            L&apos;Acheteur peut également utiliser la plateforme
            européenne de règlement en ligne des litiges :{" "}
            <a
              href="https://ec.europa.eu/consumers/odr"
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-900 underline decoration-dotted underline-offset-4 hover:text-terra-700 break-all"
            >
              ec.europa.eu/consumers/odr
            </a>
            .
          </p>
        </section>

        {/* ARTICLE 12 — DONNÉES PERSONNELLES */}
        <section aria-labelledby="donnees-personnelles">
          <h2
            id="donnees-personnelles"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 12 — Données personnelles
          </h2>
          <p className="mt-4 text-[15px] text-dark/75 leading-relaxed">
            Le traitement des données personnelles dans le cadre des
            Commandes est régi par notre{" "}
            <InternalLink href="/politique-confidentialite">
              politique de confidentialité
            </InternalLink>
            .
          </p>
        </section>

        {/* ARTICLE 13 — DROIT APPLICABLE */}
        <section aria-labelledby="droit-applicable">
          <h2
            id="droit-applicable"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 13 — Droit applicable et juridictions compétentes
          </h2>
          <p className="mt-4 text-[15px] text-dark/75 leading-relaxed">
            Les présentes CGV sont régies par le droit français. En cas
            de litige et après échec de toute tentative de résolution
            amiable et de médiation, l&apos;Acheteur peut saisir les
            juridictions compétentes selon les modalités précisées dans
            nos{" "}
            <InternalLink href="/mentions-legales">
              mentions légales
            </InternalLink>{" "}
            section 7.
          </p>
        </section>

        {/* ARTICLE 14 — DISPOSITIONS DIVERSES */}
        <section aria-labelledby="diverses">
          <h2
            id="diverses"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 14 — Dispositions diverses
          </h2>
          <h3 className="mt-4 text-[16px] font-semibold text-green-900">
            14.1 — Nullité partielle
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Si une ou plusieurs stipulations des présentes CGV sont
            déclarées nulles, illégales ou inapplicables, les autres
            stipulations conservent leur force obligatoire.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            14.2 — Non-renonciation
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Le fait pour TerrOir ou un Producer de ne pas se prévaloir
            d&apos;un manquement à l&apos;une des dispositions des CGV
            ne peut être interprété comme une renonciation à s&apos;en
            prévaloir ultérieurement.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            14.3 — Intégralité
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Les présentes CGV, ainsi que les{" "}
            <InternalLink href="/cgu">CGU</InternalLink> et la{" "}
            <InternalLink href="/politique-confidentialite">
              Politique de confidentialité
            </InternalLink>
            , expriment l&apos;intégralité des obligations entre les
            parties.
          </p>
        </section>

        {/* ARTICLE 15 — CONTACT */}
        <section aria-labelledby="contact">
          <h2
            id="contact"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 15 — Contact
          </h2>
          <p className="mt-4 text-[15px] text-dark/75 leading-relaxed">
            Pour toute question relative aux présentes CGV :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>
              Email :{" "}
              <a
                href="mailto:contact@terroir-local.fr"
                className="text-green-900 underline decoration-dotted underline-offset-4 hover:text-terra-700"
              >
                contact@terroir-local.fr
              </a>
            </li>
            <li>
              Formulaire :{" "}
              <InternalLink href="/contact">/contact</InternalLink>
            </li>
          </ul>
        </section>

        {/* LIENS UTILES */}
        <section
          aria-labelledby="liens-utiles"
          className="pt-4 border-t border-dark/[0.06]"
        >
          <h2
            id="liens-utiles"
            className="text-[11px] uppercase tracking-[0.16em] text-dark/55 font-semibold"
          >
            Liens utiles
          </h2>
          <ul className="mt-3 grid sm:grid-cols-2 gap-2 text-[14px]">
            <li>
              <InternalLink href="/mentions-legales">
                Mentions légales
              </InternalLink>
            </li>
            <li>
              <InternalLink href="/cgu">
                Conditions générales d&apos;utilisation
              </InternalLink>
            </li>
            <li>
              <InternalLink href="/politique-confidentialite">
                Politique de confidentialité
              </InternalLink>
            </li>
            <li>
              <InternalLink href="/livraison">
                Livraison et retrait
              </InternalLink>
            </li>
            <li>
              <InternalLink href="/contact">Nous contacter</InternalLink>
            </li>
          </ul>
        </section>

        {/* Retour haut de page */}
        <div className="pt-2">
          <a
            href="#haut-de-page"
            className="inline-flex items-center gap-2 text-[13px] text-dark/60 hover:text-terra-700"
          >
            <span aria-hidden>↑</span> Retour en haut de page
          </a>
        </div>
      </article>
    </div>
  );
}
