"use client";

import { Logo, RoleToggle } from "@/components/ui";
import { CartNavButton } from "@/components/ui/cart-nav-button";
import { useLogoutFlow } from "@/lib/auth/use-logout-flow";

// Barre du haut de l'espace acheteur (/compte) — parite avec ProducerHeader.
// Minimale : pas de menus publics (on revient a la boutique via le logo).
// Conserve le panier (l'acheteur peut etre en cours de commande) et le switch
// de profil consommateur/producteur. La navigation du compte vit dans la
// Sidebar, donc la barre du haut reste epuree.
export function ConsumerHeader() {
  const { logout, isLoggingOut } = useLogoutFlow();

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Logo size="sm" href="/" />
          <div
            className="hidden h-6 w-px bg-gray-300 sm:block"
            aria-hidden="true"
          />
          <span className="hidden text-sm font-bold uppercase tracking-wide text-gray-800 sm:inline">
            Mon compte
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <RoleToggle current="consumer" />
          {/* Panier : icône seule sur mobile, icône + libellé sur desktop. */}
          <span className="sm:hidden">
            <CartNavButton variant="mobile" />
          </span>
          <span className="hidden sm:inline-flex">
            <CartNavButton variant="desktop" />
          </span>
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
