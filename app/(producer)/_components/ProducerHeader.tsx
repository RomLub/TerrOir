"use client";

import { Logo, RoleToggle } from "@/components/ui";
import { useUserContext } from "@/components/providers/user-provider";
import { useLogoutFlow } from "@/lib/auth/use-logout-flow";

// Barre du haut de l'espace producteur (parite avec AdminHeader). Porte le
// switch de profil consommateur/producteur (RoleToggle, rendu null si l'user
// n'a pas les deux roles) et la deconnexion (useLogoutFlow : signOut client +
// purge panier + logoutAction serveur). Auparavant la deconnexion etait
// absente de l'espace producteur et le switch vivait en bas de la sidebar.
export function ProducerHeader() {
  const { user } = useUserContext();
  const { logout, isLoggingOut } = useLogoutFlow();

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white">
      <div className="flex h-16 items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-4">
          <Logo size="sm" href="/" />
          <div className="h-6 w-px bg-gray-300" aria-hidden="true" />
          <span className="text-sm font-bold uppercase tracking-wide text-gray-800">
            Espace Producteur
          </span>
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
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
