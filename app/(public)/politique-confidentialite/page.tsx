import type { Metadata } from "next";
import Link from "next/link";
import { NEXT_PUBLIC_APP_URL } from "@/lib/env/urls";

// Page /politique-confidentialite — placeholder minimaliste mais légalement
// décent. Première version publishable : structure RGPD complète, contenus
// substantifs sur ce qui est déjà en prod (formulaire contact, données
// commande, données producer), placeholders violets visibles pour les
// éléments à compléter avant launch (raison sociale, durée conservation,
// cookies tracking, DPO).
//
// Cible grep : `text-violet-500` ou `[PLACEHOLDER` pour lister tous les
// blocs à finaliser avant production.

const LAST_UPDATED = "6 mai 2026";

export const metadata: Metadata = {
  title: "Politique de confidentialité — TerrOir",
  description:
    "Politique de confidentialité de TerrOir : données personnelles collectées, finalités, durées de conservation, droits RGPD.",
  alternates: {
    canonical: `${NEXT_PUBLIC_APP_URL}/politique-confidentialite`,
  },
  robots: { index: true, follow: true },
};

export default function PolitiqueConfidentialitePage() {
  return (
    <div className="bg-bg">
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-10">
        <span className="text-[11px] uppercase tracking-[0.2em] text-terra-700 font-semibold">
          Mentions RGPD
        </span>
        <h1 className="mt-3 font-serif text-[40px] md:text-[56px] text-green-900 leading-[1.05] tracking-tight">
          Politique de confidentialité
        </h1>
        <p className="mt-4 text-[14px] text-dark/55">
          Dernière mise à jour : {LAST_UPDATED}
        </p>
        <p className="mt-6 text-[15px] text-dark/75 leading-relaxed">
          La présente politique précise les conditions dans lesquelles TerrOir
          collecte et traite les données personnelles des utilisateurs de la
          marketplace, conformément au Règlement Général sur la Protection des
          Données (RGPD) et à la loi Informatique et Libertés.
        </p>
      </section>

      <section className="max-w-3xl mx-auto px-6 pb-20 space-y-10">
        <section aria-labelledby="responsable">
          <h2
            id="responsable"
            className="font-serif text-[26px] text-green-900 leading-tight"
          >
            1. Responsable du traitement
          </h2>
          <p className="mt-3 text-[15px] text-violet-500 leading-relaxed">
            [PLACEHOLDER : raison sociale TerrOir + forme juridique + numéro
            SIRET + adresse postale du siège + email contact RGPD]
          </p>
          <p className="mt-3 text-[14px] text-dark/65 leading-relaxed">
            Pour toute question relative à vos données personnelles, vous
            pouvez écrire à{" "}
            <a
              href="mailto:contact@terroir-local.fr"
              className="text-green-900 underline decoration-dotted underline-offset-4 hover:text-terra-700"
            >
              contact@terroir-local.fr
            </a>
            .
          </p>
        </section>

        <section aria-labelledby="donnees">
          <h2
            id="donnees"
            className="font-serif text-[26px] text-green-900 leading-tight"
          >
            2. Données collectées
          </h2>
          <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
            TerrOir collecte uniquement les données strictement nécessaires aux
            finalités décrites ci-dessous :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>
              <strong>Formulaire de contact</strong> : nom, adresse email,
              numéro de téléphone (optionnel), contenu du message.
            </li>
            <li>
              <strong>Compte acheteur</strong> : adresse email, mot de passe
              (haché), prénom, nom, historique des commandes, adresse de
              retrait choisie.
            </li>
            <li>
              <strong>Compte producteur</strong> : informations relatives à
              l&apos;exploitation (raison sociale, adresse, SIRET), coordonnées
              bancaires (via Stripe Connect — TerrOir ne stocke pas vos IBAN
              en clair), produits et créneaux publiés.
            </li>
            <li>
              <strong>Logs techniques</strong> : adresse IP, type de
              navigateur, événements d&apos;authentification, à des fins de
              sécurité et de prévention de la fraude.
            </li>
          </ul>
        </section>

        <section aria-labelledby="finalites">
          <h2
            id="finalites"
            className="font-serif text-[26px] text-green-900 leading-tight"
          >
            3. Finalités
          </h2>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>Répondre aux demandes envoyées via le formulaire de contact.</li>
            <li>
              Permettre la création et la gestion d&apos;un compte acheteur ou
              producteur.
            </li>
            <li>
              Traiter les commandes, paiements et retraits à la ferme.
            </li>
            <li>
              Sécuriser la plateforme (détection d&apos;intrusions, prévention
              de la fraude au paiement).
            </li>
            <li>
              Respecter nos obligations légales (comptabilité, fiscalité,
              dispute Stripe).
            </li>
          </ul>
        </section>

        <section aria-labelledby="conservation">
          <h2
            id="conservation"
            className="font-serif text-[26px] text-green-900 leading-tight"
          >
            4. Durée de conservation
          </h2>
          <p className="mt-3 text-[15px] text-violet-500 leading-relaxed">
            [PLACEHOLDER : durées de conservation par catégorie — comptes
            actifs, comptes inactifs, données de commande, logs techniques,
            historique paiement Stripe — à valider avec le DPO.]
          </p>
          <p className="mt-3 text-[14px] text-dark/65 leading-relaxed">
            À titre indicatif, les données sont conservées le temps nécessaire
            aux finalités décrites, augmenté des durées de conservation
            légales (notamment 10 ans pour la comptabilité, 1 an minimum pour
            les logs sécurité conformément aux recommandations CNIL).
          </p>
        </section>

        <section aria-labelledby="droits">
          <h2
            id="droits"
            className="font-serif text-[26px] text-green-900 leading-tight"
          >
            5. Vos droits
          </h2>
          <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
            Conformément au RGPD, vous disposez à tout moment des droits
            suivants :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>
              <strong>Accès</strong> : obtenir une copie des données vous
              concernant.
            </li>
            <li>
              <strong>Rectification</strong> : corriger des données inexactes
              ou incomplètes.
            </li>
            <li>
              <strong>Suppression</strong> : faire effacer vos données — sous
              réserve des obligations légales de conservation (comptabilité,
              fraude).
            </li>
            <li>
              <strong>Portabilité</strong> : recevoir vos données dans un
              format structuré, lisible par machine.
            </li>
            <li>
              <strong>Opposition</strong> : vous opposer au traitement pour
              motifs légitimes.
            </li>
          </ul>
          <p className="mt-4 text-[15px] text-dark/75 leading-relaxed">
            Pour exercer ces droits, écrivez à{" "}
            <a
              href="mailto:contact@terroir-local.fr"
              className="text-green-900 underline decoration-dotted underline-offset-4 hover:text-terra-700"
            >
              contact@terroir-local.fr
            </a>{" "}
            depuis l&apos;email associé à votre compte. En cas de désaccord,
            vous pouvez introduire une réclamation auprès de la CNIL{" "}
            (
            <a
              href="https://www.cnil.fr"
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-900 underline decoration-dotted underline-offset-4 hover:text-terra-700"
            >
              cnil.fr
            </a>
            ).
          </p>
        </section>

        <section aria-labelledby="cookies">
          <h2
            id="cookies"
            className="font-serif text-[26px] text-green-900 leading-tight"
          >
            6. Cookies
          </h2>
          <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
            TerrOir utilise uniquement les cookies strictement nécessaires au
            fonctionnement du site (session d&apos;authentification, panier).
            Aucun cookie publicitaire, aucun traceur tiers à des fins
            marketing.
          </p>
          <p className="mt-3 text-[15px] text-violet-500 leading-relaxed">
            [PLACEHOLDER : tableau détaillé des cookies par finalité, durée
            de vie, et finalité — à compléter si ajout de cookies analytiques
            ultérieur.]
          </p>
        </section>

        <section aria-labelledby="sous-traitants">
          <h2
            id="sous-traitants"
            className="font-serif text-[26px] text-green-900 leading-tight"
          >
            7. Sous-traitants
          </h2>
          <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
            TerrOir s&apos;appuie sur des prestataires conformes RGPD pour
            faire fonctionner la plateforme : Supabase (hébergement base de
            données, UE), Vercel (hébergement applicatif), Stripe (paiement),
            Resend (emails transactionnels), Twilio (SMS notifications). Les
            transferts hors UE sont encadrés par les clauses contractuelles
            types de la Commission européenne.
          </p>
        </section>

        <section aria-labelledby="dpo">
          <h2
            id="dpo"
            className="font-serif text-[26px] text-green-900 leading-tight"
          >
            8. Délégué à la protection des données
          </h2>
          <p className="mt-3 text-[15px] text-violet-500 leading-relaxed">
            [PLACEHOLDER : coordonnées DPO si désigné, ou mention « non
            désigné » avec point de contact RGPD substitut. À valider selon
            seuils CNIL applicables au volume traité.]
          </p>
        </section>

        <div className="pt-6 border-t border-dark/[0.06] flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 text-[14px] text-green-900 hover:text-terra-700"
          >
            <span aria-hidden>←</span> Retour au formulaire de contact
          </Link>
          <Link
            href="/mentions-legales"
            className="text-[13px] text-dark/60 underline decoration-dotted underline-offset-4 hover:text-terra-700"
          >
            Voir aussi nos mentions légales
          </Link>
        </div>
      </section>
    </div>
  );
}
