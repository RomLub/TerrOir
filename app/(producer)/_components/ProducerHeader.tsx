"use client";

import { Logo, RoleToggle } from "@/components/ui";
import { useUserContext } from "@/components/providers/user-provider";
import { useLogoutFlow } from "@/lib/auth/use-logout-flow";
import { buildPublicProducerUrl } from "@/lib/producers/public-url";

// Barre du haut de l'espace producteur (parite avec AdminHeader). Porte le
// switch de profil consommateur/producteur (RoleToggle, rendu null si l'user
// n'a pas les deux roles) et la deconnexion (useLogoutFlow : signOut client +
// purge panier + logoutAction serveur). Auparavant la deconnexion etait
// absente de l'espace producteur et le switch vivait en bas de la sidebar.
export function ProducerHeader() {
  const { user, producer } = useUserContext();
  const { logout, isLoggingOut } = useLogoutFlow();

  // Pattern marketplace standard (Etsy "View shop", Shopify "View store") :
  // lien cross-subdomain vers la fiche publique du producteur, ouvert en
  // nouvel onglet. Affiche uniquement si la fiche est réellement en ligne
  // (statut === "public") — pour les autres statuts (draft / pending /
  // active / suspended) la fiche n'existe pas côté consumer (filter
  // fetchPublicProducerBySlug), donc masqué. Le bloc identité de la sidebar
  // affiche un fallback explicatif pour ces cas-là.
  const showPublicFicheLink =
    producer?.statut === "public" && Boolean(producer?.slug);

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white">
      <div className="flex h-16 items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Logo size="sm" href="/" />
          <div className="hidden h-6 w-px bg-gray-300 sm:block" aria-hidden="true" />
          <span className="hidden text-sm font-bold uppercase tracking-wide text-gray-800 sm:inline">
            Espace Producteur
          </span>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-3 overflow-x-auto sm:gap-4">
          {showPublicFicheLink ? (
            <a
              href={buildPublicProducerUrl(producer!.slug)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-gray-600 transition-colors hover:text-terra-700"
            >
              <span aria-hidden="true">↗</span>{" "}
              <span className="hidden sm:inline">Voir ma fiche publique</span>
              <span className="sm:hidden">Ma fiche</span>
            </a>
          ) : null}
          <RoleToggle current="producer" />
          {user?.email ? (
            <span className="hidden text-sm text-gray-600 md:inline">
              {user.email}
            </span>
          ) : null}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await logout();
            }}
          >
            <button
              type="submit"
              disabled={isLoggingOut}
              className="text-sm font-medium text-gray-600 transition-colors hover:text-red-600 disabled:opacity-50"
            >
              Déconnexion
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
