import type { Metadata } from "next";
import Link from "next/link";
import { NEXT_PUBLIC_APP_URL } from "@/lib/env/urls";

// Page /mentions-legales V1 (P0 légales 2026-05-06).
//
// Conforme LCEN (Loi pour la Confiance dans l'Économie Numérique
// art. 6.III.1) + Code de la consommation (rétractation L221-18 et
// exceptions L221-28, médiation L612-1, tribunaux compétents R631-3).
//
// Stratégie placeholder : structure complète et fonctionnelle dès
// maintenant, placeholders violets ciblés sur les éléments à
// compléter post-création SAS et adhésion service de médiation.
// Bandeau global signale "à valider par juriste avant launch".
//
// Liens entrants attendus :
//   - Footer global (ligne juridique pied de page)
//   - app/(public)/politique-confidentialite/page.tsx (voir aussi
//     section finale)
//
// Liens sortants implémentés :
//   - /politique-confidentialite (section 4 RGPD)
//   - /cgu (lien utile fin)
//   - /cgv (lien utile fin)
//   - /contact (sections 4, 6, 8)

const LAST_UPDATED = "6 mai 2026";

export const metadata: Metadata = {
  title: "Mentions légales — TerrOir",
  description:
    "Mentions légales de TerrOir, marketplace en ligne des producteurs locaux. Informations sur l'éditeur, l'hébergeur, vos droits.",
  alternates: {
    canonical: `${NEXT_PUBLIC_APP_URL}/mentions-legales`,
  },
  robots: { index: true, follow: true },
};

// Définition structurée des informations éditeur — placeholders ciblés.
// Permet d'isoler grep "PLACEHOLDER" en tableau au lieu de noyer dans le JSX.
const EDITOR_INFOS: Array<{ label: string; value: React.ReactNode }> = [
  {
    label: "Raison sociale",
    value: (
      <span className="text-violet-500">
        [PLACEHOLDER : TerrOir SAS — à confirmer après création de la
        société]
      </span>
    ),
  },
  {
    label: "Forme juridique",
    value: (
      <span className="text-violet-500">[PLACEHOLDER : SAS — à confirmer]</span>
    ),
  },
  {
    label: "Capital social",
    value: (
      <span className="text-violet-500">
        [PLACEHOLDER : montant à confirmer]
      </span>
    ),
  },
  {
    label: "Siège social",
    value: (
      <span className="text-violet-500">
        [PLACEHOLDER : adresse complète à confirmer]
      </span>
    ),
  },
  {
    label: "Numéro SIREN",
    value: (
      <span className="text-violet-500">
        [PLACEHOLDER : à attribuer après immatriculation]
      </span>
    ),
  },
  {
    label: "Numéro SIRET",
    value: (
      <span className="text-violet-500">
        [PLACEHOLDER : à attribuer après immatriculation]
      </span>
    ),
  },
  {
    label: "Numéro TVA intracommunautaire",
    value: (
      <span className="text-violet-500">[PLACEHOLDER : à attribuer]</span>
    ),
  },
  {
    label: "Code APE",
    value: (
      <span className="text-violet-500">
        [PLACEHOLDER : code activité à confirmer]
      </span>
    ),
  },
  {
    label: "Email",
    value: (
      <a
        href="mailto:contact@terroir-local.fr"
        className="text-green-900 underline decoration-dotted underline-offset-4 hover:text-terra-700"
      >
        contact@terroir-local.fr
      </a>
    ),
  },
  {
    label: "Téléphone",
    value: (
      <span className="text-violet-500">
        [PLACEHOLDER : numéro à fournir si applicable, sinon « uniquement par
        email »]
      </span>
    ),
  },
  {
    label: "Directeur de la publication",
    value: (
      <span className="text-violet-500">
        [PLACEHOLDER : Romain Lubin, Président de TerrOir SAS — à confirmer]
      </span>
    ),
  },
];

// Wrapper homogène pour les liens internes — limite les tags inline.
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

export default function MentionsLegalesPage() {
  return (
    <div className="bg-bg" id="haut-de-page">
      {/* Bandeau placeholder global — pattern aligné /faq + /charte-qualite. */}
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
              [PLACEHOLDER] Mentions légales en cours de finalisation
            </p>
            <p className="mt-1 text-[14px] leading-relaxed">
              Ces mentions légales sont en cours de finalisation. Le contenu
              définitif sera validé par un juriste avant le lancement
              officiel de la plateforme.
            </p>
          </div>
        </div>
      </div>

      {/* HERO */}
      <section className="max-w-3xl mx-auto px-6 pt-16 md:pt-20 pb-10">
        <span className="text-[11px] uppercase tracking-[0.2em] text-terra-700 font-semibold">
          Informations légales
        </span>
        <h1 className="mt-3 font-serif text-[40px] md:text-[56px] text-green-900 leading-[1.05] tracking-tight">
          Mentions légales
        </h1>
        <p className="mt-4 text-[14px] text-dark/55">
          Date de dernière mise à jour : {LAST_UPDATED}
        </p>
      </section>

      {/* SECTIONS */}
      <article className="max-w-3xl mx-auto px-6 pb-16 space-y-12">
        {/* SECTION 1 — ÉDITEUR */}
        <section aria-labelledby="editeur">
          <h2
            id="editeur"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            1. Éditeur du site
          </h2>
          <p className="mt-4 text-[15px] text-dark/75 leading-relaxed">
            Le site TerrOir, accessible à l&apos;adresse{" "}
            <a
              href={NEXT_PUBLIC_APP_URL}
              className="text-green-900 underline decoration-dotted underline-offset-4 hover:text-terra-700"
            >
              {NEXT_PUBLIC_APP_URL.replace(/^https?:\/\//, "")}
            </a>
            , est édité par :
          </p>
          <dl className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr] text-[14px] leading-relaxed">
            {EDITOR_INFOS.map(({ label, value }) => (
              <div key={label} className="contents">
                <dt className="text-dark/55 font-medium">{label}</dt>
                <dd className="text-dark/85 wrap-break-word">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* SECTION 2 — HÉBERGEUR */}
        <section aria-labelledby="hebergeur">
          <h2
            id="hebergeur"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            2. Hébergeur du site
          </h2>
          <p className="mt-4 text-[15px] text-dark/75 leading-relaxed">
            Le site est hébergé par :
          </p>
          <address className="mt-3 not-italic text-[14px] text-dark/85 leading-relaxed">
            Vercel B.V.
            <br />
            Schiphol Boulevard 359
            <br />
            WTC Schiphol Airport, D Tower 11th floor
            <br />
            1118BJ Schiphol
            <br />
            Pays-Bas
            <br />
            Site web :{" "}
            <a
              href="https://vercel.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-900 underline decoration-dotted underline-offset-4 hover:text-terra-700"
            >
              vercel.com
            </a>
          </address>
        </section>

        {/* SECTION 3 — PROPRIÉTÉ INTELLECTUELLE */}
        <section aria-labelledby="propriete-intellectuelle">
          <h2
            id="propriete-intellectuelle"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            3. Propriété intellectuelle
          </h2>
          <p className="mt-4 text-[15px] text-dark/75 leading-relaxed">
            L&apos;ensemble des contenus présents sur le site TerrOir
            (textes, images, logos, vidéos, charte graphique, structure)
            est protégé par le droit d&apos;auteur et le droit des marques.
          </p>
          <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
            Toute reproduction, représentation, modification, publication,
            adaptation totale ou partielle des éléments du site, quel que
            soit le moyen ou le procédé utilisé, est interdite sans
            l&apos;autorisation écrite préalable de TerrOir, sauf exception
            prévue à l&apos;article L.122-5 du Code de la propriété
            intellectuelle.
          </p>
          <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
            Les photographies de produits et de fermes mises en ligne par
            les producteurs partenaires restent leur propriété. Elles sont
            utilisées par TerrOir avec leur autorisation pour la durée de
            leur partenariat avec la plateforme.
          </p>
        </section>

        {/* SECTION 4 — DONNÉES PERSONNELLES & COOKIES */}
        <section aria-labelledby="donnees-personnelles">
          <h2
            id="donnees-personnelles"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            4. Données personnelles et cookies
          </h2>
          <p className="mt-4 text-[15px] text-dark/75 leading-relaxed">
            Le traitement de vos données personnelles est régi par notre{" "}
            <InternalLink href="/politique-confidentialite">
              politique de confidentialité
            </InternalLink>
            .
          </p>
          <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
            Pour toute question relative à vos données ou pour exercer vos
            droits RGPD (accès, rectification, suppression, portabilité,
            opposition), vous pouvez nous contacter via notre{" "}
            <InternalLink href="/contact">formulaire de contact</InternalLink>{" "}
            ou par email à{" "}
            <a
              href="mailto:contact@terroir-local.fr"
              className="text-green-900 underline decoration-dotted underline-offset-4 hover:text-terra-700"
            >
              contact@terroir-local.fr
            </a>
            .
          </p>
        </section>

        {/* SECTION 5 — DROIT DE RÉTRACTATION */}
        <section aria-labelledby="retractation">
          <h2
            id="retractation"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            5. Droit de rétractation
          </h2>
          <p className="mt-4 text-[15px] text-dark/75 leading-relaxed">
            Conformément à l&apos;article{" "}
            <strong>L221-18 du Code de la consommation</strong>, vous
            disposez d&apos;un délai de <strong>14 jours calendaires</strong>{" "}
            à compter de la réception de votre commande pour exercer votre
            droit de rétractation, sans avoir à motiver votre décision.
          </p>

          <p className="mt-5 text-[15px] text-dark/75 leading-relaxed">
            Toutefois, conformément à l&apos;article{" "}
            <strong>L221-28 du Code de la consommation</strong>, ce droit
            ne s&apos;applique <strong>PAS</strong> dans les cas suivants :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>
              Pour les denrées <strong>périssables</strong> ou susceptibles
              de se détériorer rapidement (viande fraîche, fromages frais,
              fruits et légumes, pain frais, œufs, lait, etc.).
            </li>
            <li>
              Pour les biens <strong>descellés</strong> par vous après
              livraison et ne pouvant être renvoyés pour des raisons
              d&apos;hygiène ou de protection de la santé (miel ouvert,
              conserves entamées, etc.).
            </li>
            <li>
              Pour les biens confectionnés ou personnalisés selon vos
              spécifications.
            </li>
          </ul>

          <p className="mt-5 text-[15px] text-dark/75 leading-relaxed">
            Pour les <strong>produits non-périssables et non-descellés</strong>{" "}
            (miel non ouvert, conserves non ouvertes, farine, savons, etc.),
            si vous souhaitez exercer votre droit de rétractation :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>
              Contactez-nous via notre{" "}
              <InternalLink href="/contact">formulaire de contact</InternalLink>{" "}
              dans les 14 jours suivant la réception.
            </li>
            <li>
              Renvoyez le produit dans son emballage d&apos;origine, en bon
              état (frais de retour à votre charge).
            </li>
            <li>
              Vous serez intégralement remboursé sous 14 jours après
              réception du retour conforme.
            </li>
          </ul>
        </section>

        {/* SECTION 6 — MÉDIATION */}
        <section aria-labelledby="mediation">
          <h2
            id="mediation"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            6. Médiation de la consommation
          </h2>
          <p className="mt-4 text-[15px] text-dark/75 leading-relaxed">
            Conformément à l&apos;article{" "}
            <strong>L612-1 du Code de la consommation</strong>, en cas de
            litige avec TerrOir et après avoir tenté de le résoudre
            amiablement avec notre service client (
            <a
              href="mailto:contact@terroir-local.fr"
              className="text-green-900 underline decoration-dotted underline-offset-4 hover:text-terra-700"
            >
              contact@terroir-local.fr
            </a>
            ), vous pouvez recourir gratuitement à un médiateur de la
            consommation.
          </p>
          <p className="mt-3 text-[14px] text-violet-500 leading-relaxed">
            [PLACEHOLDER : Nom et coordonnées du médiateur de la
            consommation à compléter — TerrOir doit adhérer à un service
            de médiation agréé avant le lancement officiel. Options
            possibles : Médicys, AME Conso, MEDIATION-NET, etc. — coût
            annuel ~30-100€.]
          </p>
          <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
            Vous pouvez également utiliser la plateforme européenne de
            règlement en ligne des litiges accessible à l&apos;adresse :{" "}
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

        {/* SECTION 7 — DROIT APPLICABLE */}
        <section aria-labelledby="droit-applicable">
          <h2
            id="droit-applicable"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            7. Droit applicable et tribunaux compétents
          </h2>
          <p className="mt-4 text-[15px] text-dark/75 leading-relaxed">
            Le présent site et ses conditions d&apos;utilisation sont régis
            par le droit français.
          </p>
          <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
            En cas de litige et après échec de toute tentative de
            recherche d&apos;une solution amiable et de la procédure de
            médiation, le consommateur peut saisir, à son choix,
            conformément à l&apos;article{" "}
            <strong>R631-3 du Code de la consommation</strong> :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>
              Le tribunal du lieu où il demeurait au moment de la
              conclusion du contrat.
            </li>
            <li>
              Le tribunal du lieu de la livraison effective du produit.
            </li>
            <li>
              Ou le tribunal du siège social du défendeur (TerrOir).
            </li>
          </ul>
        </section>

        {/* SECTION 8 — CONTACT */}
        <section aria-labelledby="contact">
          <h2
            id="contact"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            8. Contact
          </h2>
          <p className="mt-4 text-[15px] text-dark/75 leading-relaxed">
            Pour toute question relative aux présentes mentions légales,
            vous pouvez nous contacter :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>
              Par email :{" "}
              <a
                href="mailto:contact@terroir-local.fr"
                className="text-green-900 underline decoration-dotted underline-offset-4 hover:text-terra-700"
              >
                contact@terroir-local.fr
              </a>
            </li>
            <li>
              Via notre{" "}
              <InternalLink href="/contact">formulaire de contact</InternalLink>
            </li>
          </ul>
        </section>

        {/* LIENS UTILES */}
        <section aria-labelledby="liens-utiles" className="pt-4 border-t border-dark/[0.06]">
          <h2
            id="liens-utiles"
            className="text-[11px] uppercase tracking-[0.16em] text-dark/55 font-semibold"
          >
            Liens utiles
          </h2>
          <ul className="mt-3 grid sm:grid-cols-2 gap-2 text-[14px]">
            <li>
              <InternalLink href="/politique-confidentialite">
                Politique de confidentialité
              </InternalLink>
            </li>
            <li>
              <InternalLink href="/cgu">
                Conditions générales d&apos;utilisation
              </InternalLink>
            </li>
            <li>
              <InternalLink href="/cgv">
                Conditions générales de vente
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
