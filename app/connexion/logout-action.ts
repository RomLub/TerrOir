"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// signOut() supprime les cookies sb-* via les options calculées par
// lib/supabase/cookie-domain.ts en fonction du host (Chantier 4).
// Logout depuis www/pro → efface le cookie partagé '.terroir-local.fr'
// (déconnecte les deux sous-domaines). Logout depuis admin → efface
// uniquement le cookie 'sb-admin-auth-token' scopé sur admin.*.
export async function logoutAction() {
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
