"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { signupSchema } from "@/lib/auth/validators";

export type SignupState = { error?: string };

export async function signupAction(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const parsed = signupSchema.safeParse({
    prenom: formData.get("prenom"),
    nom: formData.get("nom"),
    email: formData.get("email"),
    password: formData.get("password"),
    telephone: formData.get("telephone") ?? "",
    sms_optin: formData.get("sms_optin") ?? false,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }

  const { prenom, nom, email, password, telephone, sms_optin } = parsed.data;

  const supabase = createSupabaseServerClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { prenom, nom },
      emailRedirectTo: `${appUrl}/auth/callback?next=/compte/commandes`,
    },
  });

  if (error || !data.user) {
    return { error: error?.message ?? "Inscription impossible" };
  }

  // Profil public.users — créé via service_role pour contourner
  // la contrainte RLS (auth.uid() peut ne pas être disponible
  // immédiatement après signUp selon la config e-mail confirmation).
  const admin = createSupabaseAdminClient();
  const { error: profileError } = await admin.from("users").insert({
    id: data.user.id,
    email,
    role: "consumer",
    prenom,
    nom,
    telephone: telephone ?? null,
    sms_optin: Boolean(sms_optin),
  });

  if (profileError) {
    return { error: `Profil non créé : ${profileError.message}` };
  }

  redirect("/compte/commandes");
}
