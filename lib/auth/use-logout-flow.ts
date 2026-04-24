"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { logoutAction } from "@/app/(public)/connexion/logout-action";

// Double signOut logout pattern, factorisé depuis navbar-public.tsx et
// AdminHeader.tsx (cf. docs/LESSONS.md).
//
// 1. signOut côté client d'abord : déclenche onAuthStateChange du
//    UserProvider (SIGNED_OUT → setUser(null)) → UI rafraîchie
//    immédiatement sans attendre un reload.
// 2. Puis logoutAction (server action) : nettoie les cookies sb-* via les
//    options de cookie-domain.ts et redirige vers "/". Sur admin.*, "/"
//    reste sur le sous-domaine admin ; sur www/pro, "/" va à la home
//    consumer.
export function useLogoutFlow() {
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const logout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    await logoutAction();
  };

  return { logout, isLoggingOut };
}
