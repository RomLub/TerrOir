import type { Metadata } from "next";
import Link from "next/link";
import { NEXT_PUBLIC_APP_URL } from "@/lib/env/urls";

// Page /cgu V1 (P0 légales 2026-05-06).
//
// Conditions générales d'utilisation de la plateforme TerrOir : règles
// d'usage du Site (compte, comportement, contenus utilisateurs, modération,
// propriété intellectuelle, responsabilités). À distinguer des CGV qui
// régissent la transaction commerciale Consumer ↔ Producer (page /cgv,
// session dédiée à venir).
//
// Stratégie placeholder : structure complète et fonctionnelle dès
// maintenant — bandeau global violet pour signaler validation juriste
// requise avant lancement officiel. Pattern aligné /mentions-legales.
//
// Liens entrants attendus :
//   - Footer global (ligne juridique pied de page → existe depuis
//     commit /mentions-legales)
//   - app/(public)/mentions-legales/page.tsx (section liens utiles)
//   - Flows d'inscription (checkbox CGU à ajouter — voir doc fix)
//
// Liens sortants implémentés :
//   - /mentions-legales (sections 7, 13 + liens utiles)
//   - /politique-confidentialite (section 10 RGPD + liens utiles)
//   - /cgv (sections 9, liens utiles)
//   - /contact (sections 4, 11, 12, 14 + liens utiles)

const LAST_UPDATED = "6 mai 2026";

export const metadata: Metadata = {
  title: "Conditions générales d'utilisation — TerrOir",
  description:
    "Conditions générales d'utilisation de la plateforme TerrOir : règles d'usage du site, gestion des comptes, contenus utilisateurs, propriété intellectuelle, responsabilités.",
  alternates: {
    canonical: `${NEXT_PUBLIC_APP_URL}/cgu`,
  },
  robots: { index: true, follow: true },
};

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

export default function CguPage() {
  return (
    <div className="bg-bg" id="haut-de-page">
      {/* Bandeau placeholder global — pattern aligné /mentions-legales. */}
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
              [PLACEHOLDER] CGU en cours de finalisation
            </p>
            <p className="mt-1 text-[14px] leading-relaxed">
              Ces conditions générales d&apos;utilisation sont en cours de
              finalisation. Le contenu définitif sera validé par un juriste
              avant le lancement officiel de la plateforme.
            </p>
          </div>
        </div>
      </div>

      {/* HERO */}
      <section className="max-w-3xl mx-auto px-6 pt-16 md:pt-20 pb-10">
        <span className="text-[11px] uppercase tracking-[0.2em] text-terra-700 font-semibold">
          Cadre d&apos;utilisation
        </span>
        <h1 className="mt-3 font-serif text-[40px] md:text-[56px] text-green-900 leading-[1.05] tracking-tight">
          Conditions générales d&apos;utilisation
        </h1>
        <p className="mt-4 text-[14px] text-dark/55">
          Date de dernière mise à jour : {LAST_UPDATED}
        </p>
      </section>

      {/* PRÉAMBULE */}
      <section className="max-w-3xl mx-auto px-6 pb-10">
        <p className="text-[15px] text-dark/75 leading-relaxed">
          Les présentes Conditions Générales d&apos;Utilisation (CGU)
          régissent l&apos;accès et l&apos;utilisation du site TerrOir,
          accessible à l&apos;adresse{" "}
          <a
            href={NEXT_PUBLIC_APP_URL}
            className="text-green-900 underline decoration-dotted underline-offset-4 hover:text-terra-700"
          >
            {NEXT_PUBLIC_APP_URL.replace(/^https?:\/\//, "")}
          </a>
          , ainsi que l&apos;ensemble des services qui y sont proposés.
        </p>
        <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
          Toute utilisation du site implique l&apos;acceptation pleine et
          entière des présentes CGU. Si vous n&apos;acceptez pas ces
          conditions, veuillez ne pas utiliser le site.
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
          <p className="mt-4 text-[15px] text-dark/75 leading-relaxed">
            Pour faciliter la compréhension des présentes CGU, les termes
            suivants ont la signification ci-dessous :
          </p>
          <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr] text-[14px] leading-relaxed">
            <dt className="text-dark/55 font-medium">Site</dt>
            <dd className="text-dark/85">
              désigne la plateforme TerrOir accessible à l&apos;adresse{" "}
              {NEXT_PUBLIC_APP_URL.replace(/^https?:\/\//, "")} et ses
              sous-domaines (pro., admin.).
            </dd>
            <dt className="text-dark/55 font-medium">Éditeur ou TerrOir</dt>
            <dd className="text-dark/85">
              désigne la société TerrOir, éditrice du Site (voir{" "}
              <InternalLink href="/mentions-legales">
                mentions légales
              </InternalLink>
              ).
            </dd>
            <dt className="text-dark/55 font-medium">Utilisateur</dt>
            <dd className="text-dark/85">
              toute personne accédant au Site, qu&apos;elle soit enregistrée
              ou non.
            </dd>
            <dt className="text-dark/55 font-medium">Visiteur</dt>
            <dd className="text-dark/85">
              Utilisateur non enregistré naviguant sur le Site.
            </dd>
            <dt className="text-dark/55 font-medium">Compte</dt>
            <dd className="text-dark/85">
              espace personnel d&apos;un Utilisateur enregistré.
            </dd>
            <dt className="text-dark/55 font-medium">Consumer ou Acheteur</dt>
            <dd className="text-dark/85">
              Utilisateur enregistré effectuant des achats sur le Site.
            </dd>
            <dt className="text-dark/55 font-medium">
              Producer ou Producteur
            </dt>
            <dd className="text-dark/85">
              professionnel de l&apos;agriculture ou de la transformation
              alimentaire enregistré sur le Site pour y vendre ses produits.
            </dd>
            <dt className="text-dark/55 font-medium">Marketplace</dt>
            <dd className="text-dark/85">
              espace de mise en relation entre Producers et Consumers
              proposé par TerrOir.
            </dd>
            <dt className="text-dark/55 font-medium">Service</dt>
            <dd className="text-dark/85">
              ensemble des fonctionnalités proposées par le Site.
            </dd>
          </dl>
        </section>

        {/* ARTICLE 2 — ACCEPTATION ET MODIFICATION DES CGU */}
        <section aria-labelledby="acceptation">
          <h2
            id="acceptation"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 2 — Acceptation et modification des CGU
          </h2>
          <p className="mt-4 text-[15px] text-dark/75 leading-relaxed">
            L&apos;Utilisateur reconnaît avoir pris connaissance des
            présentes CGU et les accepter sans réserve.
          </p>
          <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
            TerrOir se réserve le droit de modifier les CGU à tout moment.
            Les modifications substantielles seront notifiées aux
            Utilisateurs disposant d&apos;un Compte par email avec un
            préavis minimum de <strong>30 jours</strong> avant entrée en
            vigueur. La poursuite de l&apos;utilisation du Site après cette
            date vaut acceptation des nouvelles CGU.
          </p>
        </section>

        {/* ARTICLE 3 — ACCÈS AU SITE */}
        <section aria-labelledby="acces">
          <h2
            id="acces"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 3 — Accès au site
          </h2>
          <h3 className="mt-4 text-[16px] font-semibold text-green-900">
            3.1 — Conditions techniques
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            L&apos;accès au Site nécessite une connexion Internet et un
            navigateur récent (Chrome, Firefox, Safari, Edge dans leurs
            versions à jour). TerrOir met en œuvre tous les moyens
            raisonnables pour rendre le Site accessible 24h/24 et 7j/7.
          </p>
          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            3.2 — Disponibilité
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            TerrOir s&apos;efforce de maintenir le Site accessible mais ne
            garantit pas une disponibilité ininterrompue. Des opérations
            de maintenance, de mise à jour ou des défaillances techniques
            peuvent entraîner des interruptions temporaires.
          </p>
          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            3.3 — Maintenance
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            TerrOir s&apos;engage à informer les Utilisateurs des
            opérations de maintenance planifiées via une bannière sur le
            Site, dans la mesure du possible. En cas d&apos;urgence (faille
            de sécurité, attaque, etc.), TerrOir peut suspendre l&apos;accès
            sans préavis.
          </p>
        </section>

        {/* ARTICLE 4 — INSCRIPTION ET COMPTE */}
        <section aria-labelledby="inscription">
          <h2
            id="inscription"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 4 — Inscription et compte
          </h2>
          <h3 className="mt-4 text-[16px] font-semibold text-green-900">
            4.1 — Conditions d&apos;inscription
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            L&apos;inscription au Site est ouverte à toute personne :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>Majeure (18 ans révolus)</li>
            <li>Disposant de la capacité juridique de contracter</li>
            <li>Résidant en France métropolitaine pour les Consumers</li>
            <li>
              Exerçant une activité agricole ou de transformation
              alimentaire professionnelle pour les Producers
            </li>
          </ul>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            4.2 — Informations exactes
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            L&apos;Utilisateur s&apos;engage à fournir des informations
            exactes, complètes et à jour lors de son inscription, et à les
            maintenir à jour pendant toute la durée d&apos;utilisation du
            Site.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            4.3 — Compte unique
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Un Utilisateur ne peut détenir qu&apos;un seul Compte. La
            création de plusieurs Comptes par une même personne physique
            est interdite et peut entraîner la suspension de tous les
            Comptes concernés.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            4.4 — Confidentialité du mot de passe
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            L&apos;Utilisateur est responsable de la confidentialité de son
            mot de passe. Toute connexion ou action effectuée depuis le
            Compte est réputée effectuée par son titulaire. En cas de perte
            ou de suspicion d&apos;usage frauduleux, l&apos;Utilisateur
            s&apos;engage à modifier immédiatement son mot de passe et à
            en informer TerrOir.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            4.5 — Suppression du compte
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            L&apos;Utilisateur peut supprimer son Compte à tout moment
            depuis son espace personnel ou en contactant TerrOir via{" "}
            <InternalLink href="/contact">/contact</InternalLink>. La
            suppression est définitive et entraîne la perte de
            l&apos;historique des commandes et des données associées (sous
            réserve des durées de conservation légales).
          </p>
        </section>

        {/* ARTICLE 5 — COMPORTEMENT ATTENDU */}
        <section aria-labelledby="comportement">
          <h2
            id="comportement"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 5 — Comportement attendu des utilisateurs
          </h2>
          <h3 className="mt-4 text-[16px] font-semibold text-green-900">
            5.1 — Respect d&apos;autrui
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            L&apos;Utilisateur s&apos;engage à utiliser le Site dans le
            respect d&apos;autrui. Sont notamment interdits :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>
              Les propos injurieux, diffamatoires, racistes, sexistes,
              homophobes, ou portant atteinte à la dignité humaine
            </li>
            <li>Le harcèlement de toute nature</li>
            <li>
              Les contenus à caractère violent, pornographique ou
              pédopornographique
            </li>
            <li>
              L&apos;incitation à la haine, à la violence ou à la
              discrimination
            </li>
          </ul>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            5.2 — Interdictions techniques
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            L&apos;Utilisateur s&apos;interdit :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>
              Toute tentative de fraude (utilisation de cartes volées,
              fausses identités, usurpation)
            </li>
            <li>
              Toute tentative d&apos;accès non autorisé aux systèmes de
              TerrOir (intrusion, contournement de sécurité, exploitation
              de failles)
            </li>
            <li>
              Tout scraping ou utilisation automatisée non autorisée du
              Site (bots, scripts, robots d&apos;indexation autres que ceux
              des moteurs de recherche standard)
            </li>
            <li>
              Toute action visant à perturber le bon fonctionnement du
              Site (DDoS, surcharge volontaire)
            </li>
          </ul>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            5.3 — Usage commercial parasite
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            L&apos;Utilisateur s&apos;interdit toute utilisation
            commerciale du Site non prévue par les présentes CGU,
            notamment :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>La revente non autorisée de produits achetés sur TerrOir</li>
            <li>
              L&apos;utilisation des données producers ou consumers à des
              fins commerciales personnelles
            </li>
            <li>La création de bases de données concurrentes par scraping</li>
          </ul>
        </section>

        {/* ARTICLE 6 — CONTENUS UTILISATEURS */}
        <section aria-labelledby="contenus">
          <h2
            id="contenus"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 6 — Contenus utilisateurs
          </h2>
          <h3 className="mt-4 text-[16px] font-semibold text-green-900">
            6.1 — Contenus déposés
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            L&apos;Utilisateur peut être amené à déposer des contenus sur
            le Site (avis sur les produits ou producers, photos de profil,
            descriptions, commentaires, etc.).
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            6.2 — Garantie de l&apos;Utilisateur
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            L&apos;Utilisateur garantit qu&apos;il dispose de tous les
            droits nécessaires sur les contenus qu&apos;il publie (droits
            d&apos;auteur, droits à l&apos;image, droits sur les marques
            mentionnées, etc.) et que ces contenus ne violent aucun droit
            de tiers ni aucune disposition légale.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            6.3 — Cession de droits
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            En publiant un contenu sur le Site, l&apos;Utilisateur cède à
            TerrOir, à titre gratuit et non exclusif, le droit
            d&apos;utiliser, reproduire, représenter et adapter ce contenu
            sur le Site et ses supports de communication, pour la durée
            légale des droits d&apos;auteur et pour le monde entier.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            6.4 — Avis sur les produits et producers
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            TerrOir met à disposition un système d&apos;avis permettant
            aux Consumers de partager leur expérience avec les Producers
            et leurs produits, après réception de leur commande.
          </p>
          <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
            Les avis publiés doivent :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>Refléter une expérience réelle et personnelle</li>
            <li>Être rédigés de manière respectueuse</li>
            <li>Ne contenir aucune information personnelle de tiers</li>
            <li>
              Ne pas contenir de propos injurieux, diffamatoires ou hors
              sujet
            </li>
          </ul>
          <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
            TerrOir se réserve le droit de modérer a posteriori les avis
            et de supprimer ceux contrevenant aux présentes CGU. Le
            Producer concerné dispose d&apos;un droit de réponse public à
            chaque avis.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            6.5 — Modération
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            TerrOir se réserve le droit, sans préavis, de :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>
              Supprimer tout contenu contrevenant aux présentes CGU ou à
              la législation applicable
            </li>
            <li>
              Suspendre temporairement le Compte d&apos;un Utilisateur
              ayant publié des contenus inappropriés
            </li>
            <li>
              Suspendre définitivement le Compte en cas de manquements
              graves ou répétés
            </li>
          </ul>
        </section>

        {/* ARTICLE 7 — PROPRIÉTÉ INTELLECTUELLE */}
        <section aria-labelledby="propriete-intellectuelle">
          <h2
            id="propriete-intellectuelle"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 7 — Propriété intellectuelle
          </h2>
          <h3 className="mt-4 text-[16px] font-semibold text-green-900">
            7.1 — Marque et identité TerrOir
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            La marque TerrOir, le logo, la charte graphique, les éléments
            visuels et le code source du Site sont la propriété exclusive
            de l&apos;éditeur et sont protégés par les lois applicables en
            matière de propriété intellectuelle.
          </p>
          <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
            Toute reproduction, représentation, modification ou
            utilisation non autorisée de ces éléments est strictement
            interdite.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            7.2 — Contenus des Producers
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Les fiches Producers, les descriptions de produits et les
            photographies fournies par les Producers restent la propriété
            de ces derniers. Ils en cèdent l&apos;usage à TerrOir pour la
            durée de leur partenariat avec la plateforme.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            7.3 — Voir aussi
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Pour plus de détails, consultez nos{" "}
            <InternalLink href="/mentions-legales">
              mentions légales
            </InternalLink>{" "}
            section 3.
          </p>
        </section>

        {/* ARTICLE 8 — LIENS EXTERNES */}
        <section aria-labelledby="liens-externes">
          <h2
            id="liens-externes"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 8 — Liens externes
          </h2>
          <h3 className="mt-4 text-[16px] font-semibold text-green-900">
            8.1 — Liens depuis TerrOir
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Le Site peut contenir des liens vers des sites tiers. TerrOir
            n&apos;exerce aucun contrôle sur le contenu de ces sites et ne
            peut être tenu responsable de leur contenu, de leur
            disponibilité ou des pratiques en matière de protection des
            données qu&apos;ils appliquent.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            8.2 — Liens vers TerrOir
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            Les liens hypertextes vers la page d&apos;accueil du Site (
            <a
              href={NEXT_PUBLIC_APP_URL}
              className="text-green-900 underline decoration-dotted underline-offset-4 hover:text-terra-700"
            >
              {NEXT_PUBLIC_APP_URL.replace(/^https?:\/\//, "")}
            </a>
            ) sont libres. Les liens profonds (vers des pages internes
            spécifiques) sont autorisés sous réserve de :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>Ne pas dénaturer le contexte de TerrOir</li>
            <li>
              Ne pas associer TerrOir à des contenus illicites ou
              contraires aux bonnes mœurs
            </li>
            <li>Pouvoir être retirés sur simple demande de TerrOir</li>
          </ul>
        </section>

        {/* ARTICLE 9 — RESPONSABILITÉS */}
        <section aria-labelledby="responsabilites">
          <h2
            id="responsabilites"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 9 — Responsabilités
          </h2>
          <h3 className="mt-4 text-[16px] font-semibold text-green-900">
            9.1 — Rôle d&apos;intermédiaire de TerrOir
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            TerrOir agit en qualité d&apos;intermédiaire technique entre
            Consumers et Producers. À ce titre, TerrOir{" "}
            <strong>n&apos;est pas</strong> partie aux contrats de vente
            conclus entre Consumers et Producers. Ces contrats sont régis
            par les Conditions Générales de Vente (CGV) accessibles à
            l&apos;adresse <InternalLink href="/cgv">/cgv</InternalLink>.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            9.2 — Limitations de responsabilité
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            TerrOir s&apos;efforce de garantir la qualité du Service mais
            ne peut être tenu responsable :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>
              Des défaillances techniques de tiers (FAI, hébergeur Vercel,
              prestataire de paiement Stripe, transporteurs)
            </li>
            <li>
              Du contenu des fiches Producers, qui relève de la
              responsabilité exclusive des Producers
            </li>
            <li>
              De la qualité, de la conformité, de la sécurité ou de la
              livraison des produits, qui relèvent de la responsabilité
              exclusive des Producers vendeurs
            </li>
            <li>
              Des dommages indirects résultant de l&apos;utilisation du
              Site (perte de données, perte d&apos;opportunité commerciale,
              etc.)
            </li>
          </ul>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            9.3 — Force majeure
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            TerrOir ne pourra être tenu responsable d&apos;un manquement à
            ses obligations résultant d&apos;un cas de force majeure tel
            que défini par la jurisprudence française (cyclone, pandémie,
            attaque informatique majeure, défaillance massive
            d&apos;infrastructure internet, etc.).
          </p>
        </section>

        {/* ARTICLE 10 — DONNÉES PERSONNELLES & COOKIES */}
        <section aria-labelledby="donnees-personnelles">
          <h2
            id="donnees-personnelles"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 10 — Données personnelles et cookies
          </h2>
          <p className="mt-4 text-[15px] text-dark/75 leading-relaxed">
            Le traitement des données personnelles des Utilisateurs est
            régi par notre{" "}
            <InternalLink href="/politique-confidentialite">
              politique de confidentialité
            </InternalLink>
            .
          </p>
          <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
            L&apos;Utilisateur dispose des droits prévus par le RGPD :
            accès, rectification, suppression, portabilité, opposition,
            limitation du traitement.
          </p>
        </section>

        {/* ARTICLE 11 — SIGNALEMENT DE CONTENU ILLICITE */}
        <section aria-labelledby="signalement">
          <h2
            id="signalement"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 11 — Signalement de contenu illicite
          </h2>
          <p className="mt-4 text-[15px] text-dark/75 leading-relaxed">
            Conformément à l&apos;article{" "}
            <strong>6 de la Loi pour la Confiance dans l&apos;Économie
            Numérique (LCEN)</strong> et au{" "}
            <strong>
              Règlement européen sur les services numériques (DSA)
            </strong>
            , tout Utilisateur peut signaler à TerrOir un contenu
            qu&apos;il estime illicite ou contrevenant aux présentes CGU.
          </p>
          <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
            Pour signaler un contenu illicite :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>
              Contactez-nous via{" "}
              <InternalLink href="/contact">/contact</InternalLink>
            </li>
            <li>Précisez l&apos;URL exacte du contenu concerné</li>
            <li>
              Décrivez la nature du problème (illicite, diffamatoire,
              contrevenant aux CGU, etc.)
            </li>
            <li>Indiquez vos coordonnées pour suivi</li>
          </ul>
          <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
            TerrOir s&apos;engage à examiner chaque signalement dans les
            plus brefs délais et à prendre les mesures appropriées.
          </p>
        </section>

        {/* ARTICLE 12 — SUSPENSION ET RÉSILIATION */}
        <section aria-labelledby="resiliation">
          <h2
            id="resiliation"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 12 — Suspension et résiliation
          </h2>
          <h3 className="mt-4 text-[16px] font-semibold text-green-900">
            12.1 — Par l&apos;Utilisateur
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            L&apos;Utilisateur peut résilier son Compte à tout moment
            depuis son espace personnel ou en contactant TerrOir via{" "}
            <InternalLink href="/contact">/contact</InternalLink>.
          </p>

          <h3 className="mt-5 text-[16px] font-semibold text-green-900">
            12.2 — Par TerrOir
          </h3>
          <p className="mt-2 text-[15px] text-dark/75 leading-relaxed">
            TerrOir se réserve le droit de suspendre ou résilier le Compte
            d&apos;un Utilisateur en cas de :
          </p>
          <ul className="mt-3 space-y-2 text-[15px] text-dark/75 leading-relaxed list-disc pl-5">
            <li>Manquement aux présentes CGU</li>
            <li>Comportement frauduleux ou illicite</li>
            <li>Atteinte à la sécurité du Site</li>
            <li>
              Non-respect des engagements financiers (uniquement pour
              Producers, voir contrat dédié)
            </li>
          </ul>
          <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
            En cas de manquement grave, la suspension peut être immédiate
            sans préavis. Pour les manquements moins graves, TerrOir
            notifie préalablement l&apos;Utilisateur et lui laisse un délai
            raisonnable pour se mettre en conformité.
          </p>
        </section>

        {/* ARTICLE 13 — DROIT APPLICABLE */}
        <section aria-labelledby="droit-applicable">
          <h2
            id="droit-applicable"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 13 — Droit applicable et juridiction
          </h2>
          <p className="mt-4 text-[15px] text-dark/75 leading-relaxed">
            Les présentes CGU sont régies par le droit français. En cas
            de litige, les modalités de règlement amiable et les
            juridictions compétentes sont précisées dans nos{" "}
            <InternalLink href="/mentions-legales">
              mentions légales
            </InternalLink>{" "}
            section 7.
          </p>
        </section>

        {/* ARTICLE 14 — CONTACT */}
        <section aria-labelledby="contact">
          <h2
            id="contact"
            className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight"
          >
            Article 14 — Contact
          </h2>
          <p className="mt-4 text-[15px] text-dark/75 leading-relaxed">
            Pour toute question relative aux présentes CGU :
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
              <InternalLink href="/politique-confidentialite">
                Politique de confidentialité
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
