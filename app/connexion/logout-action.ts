"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logAuthEvent } from "@/lib/audit-logs/log-auth-event";
import { clearRoleSnapshotOnStore } from "@/lib/auth/role-snapshot-cookie";

// signOut() supprime les cookies sb-* via les options calculées par
// lib/supabase/cookie-domain.ts en fonction du host (Chantier 4).
// Logout depuis www/pro → efface le cookie partagé '.terroir-local.fr'
// (déconnecte les deux sous-domaines). Logout depuis admin → efface
// uniquement le cookie 'sb-admin-auth-token' scopé sur admin.*.
export async function logoutAction() {
  const supabase = createSupabaseServerClient();

  // userId capturé AVANT signOut : sinon la session est détruite et on
  // perdrait l'attribution. getUser() est l'appel canonique vérifié
  // (vs getSession() qui peut retourner stale).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await logAuthEvent({
    eventType: "account_logout",
    userId: user?.id ?? null,
  });

  await supabase.auth.signOut();

  // T-321 — Invalide le cookie role snapshot HMAC. Sans ça, la prochaine
  // request middleware lirait un snapshot tied à l'ancien user.id ; le check
  // user_id mismatch (vs getUser() returning null) le rejetterait déjà
  // côté middleware, mais on nettoie côté serveur pour ne pas garder un
  // cookie signé valide circulant inutilement post-logout.
  clearRoleSnapshotOnStore(cookies(), headers().get("host"));

  redirect("/");
}
