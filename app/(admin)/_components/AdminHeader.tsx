"use client";

import { Logo } from "@/components/ui";
import { useUserContext } from "@/components/providers/user-provider";
import { useLogoutFlow } from "@/lib/auth/use-logout-flow";

export function AdminHeader() {
  const { user } = useUserContext();
  const { logout, isLoggingOut } = useLogoutFlow();

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white">
      <div className="flex h-16 items-center justify-between px-6 py-4">
        <div className="flex items-center gap-4">
          <Logo size="sm" href="/tableau-de-bord" />
          <div className="h-6 w-px bg-gray-300" aria-hidden="true" />
          <span className="text-sm font-bold uppercase tracking-wide text-gray-800">
            Back-office
          </span>
        </div>
        <div className="flex items-center gap-4">
          {user?.email ? (
            <span className="text-sm text-gray-600">{user.email}</span>
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
