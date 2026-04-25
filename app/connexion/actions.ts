"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loginSchema } from "@/lib/auth/validators";
import { maskEmail } from "@/lib/rgpd/mask-email";
import {
  loadRoleSnapshot,
  resolvePostLoginPath,
} from "@/lib/auth/post-login-redirect";

export type LoginState = { error?: string };

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    return { error: "Identifiants invalides" };
  }

  const role = await loadRoleSnapshot(supabase, data.user.id);
  const host = headers().get("host") ?? "";
  // redirectTo posé par le middleware quand un user anonyme a tapé une route
  // protégée (cf. middleware.ts §2). Fallback canonique si absent/invalide.
  redirect(resolvePostLoginPath(role, host, formData.get("redirectTo")));
}

// =============================================================================
// Magic link — alternative au login mdp. Le redirectTo est routé en fonction
// du type d'user détecté (admin vs autres) pour que le callback tombe sur le
// bon subdomain et pose les cookies isolés appropriés (Chantier 4) :
//   admin → https://admin.terroir-local.fr/auth/callback
//   autres → https://www.terroir-local.fr/auth/callback (cookies partagés
//           avec pro via .terroir-local.fr, donc producers OK)
//
// Enumeration-resistant : même réponse UI quel que soit le résultat (email
// inexistant ou non — Supabase signInWithOtp avec shouldCreateUser=false
// échoue silencieusement, on ignore l'erreur et on renvoie le même success).
// =============================================================================

const MAGIC_LINK_ADMIN_CALLBACK =
  "https://admin.terroir-local.fr/auth/callback";
const MAGIC_LINK_DEFAULT_CALLBACK =
  "https://www.terroir-local.fr/auth/callback";

const magicLinkSchema = z.object({
  email: z.string().trim().email("Email invalide"),
});

export type MagicLinkState = { error?: string; message?: string };

export async function requestMagicLinkAction(
  _prev: MagicLinkState,
  formData: FormData,
): Promise<MagicLinkState> {
  const parsed = magicLinkSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Email invalide" };
  }

  const email = parsed.data.email;

  // Lookup admin via la colonne email présente directement sur admin_users
  // (créée en 20260421100000). service_role bypass RLS — on ne révèle jamais
  // au client si l'email est admin ou pas, le check sert uniquement à router
  // le redirectTo.
  let isAdmin = false;
  try {
    const admin = createSupabaseAdminClient();
    const { data: adminRow } = await admin
      .from("admin_users")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    isAdmin = !!adminRow;
  } catch (err) {
    // Fail-open : si le lookup échoue (DB down, etc.), on route sur le
    // callback par défaut. Un admin pourra retenter ou passer par le mdp.
    console.warn(
      `MAGIC_LINK_ADMIN_LOOKUP_WARN email=${maskEmail(email)} error=${(err as Error).message}`,
    );
  }

  const emailRedirectTo = isAdmin
    ? MAGIC_LINK_ADMIN_CALLBACK
    : MAGIC_LINK_DEFAULT_CALLBACK;

  // signInWithOtp avec shouldCreateUser=false : si l'email n'existe pas dans
  // auth.users, Supabase renvoie une erreur — on la swallow pour préserver
  // l'enumeration-resistance côté UI.
  try {
    const supabase = createSupabaseServerClient();
    await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo,
      },
    });
  } catch (err) {
    console.warn(
      `MAGIC_LINK_SEND_WARN email=${maskEmail(email)} error=${(err as Error).message}`,
    );
  }

  return {
    message:
      "Si cette adresse est connue, un lien vous a été envoyé. Consultez vos emails.",
  };
}
