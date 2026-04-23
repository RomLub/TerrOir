"use client";

import { Logo } from "@/components/ui";
import { useUserContext } from "@/components/providers/user-provider";
import { logoutAction } from "@/app/(public)/connexion/logout-action";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function AdminHeader() {
  const { user } = useUserContext();

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
              const supabase = createSupabaseBrowserClient();
              await supabase.auth.signOut();
              await logoutAction();
            }}
          >
            <button
              type="submit"
              className="text-sm font-medium text-gray-600 transition-colors hover:text-red-600"
            >
              Déconnexion
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
