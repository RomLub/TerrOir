"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// signOut() supprime les cookies sb-* avec les options configurées dans
// lib/supabase/cookie-options.ts (actuellement domain=.terroir-local.fr en
// prod). Conséquence : un logout depuis www déconnecte aussi pro tant que
// les cookies sont partagés. Quand le Chantier 4 isolera admin, le logout
// admin ne touchera plus aux cookies www/pro automatiquement.
export async function logoutAction() {
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
