"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { signupSchema } from "@/lib/auth/validators";
import { NEXT_PUBLIC_APP_URL } from "@/lib/env/urls";
import { logAuthEvent } from "@/lib/audit-logs/log-auth-event";

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
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { prenom, nom },
      emailRedirectTo: `${NEXT_PUBLIC_APP_URL}/auth/callback?next=/compte/commandes`,
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
    roles: ["consumer"],
    prenom,
    nom,
    telephone: telephone ?? null,
    sms_optin: Boolean(sms_optin),
  });

  if (profileError) {
    return { error: `Profil non créé : ${profileError.message}` };
  }

  await logAuthEvent({
    eventType: "account_signup",
    userId: data.user.id,
    metadata: { source: "consumer_signup_form" },
  });

  // Invalide le cache RSC du root layout AVANT redirect — supabase config
  // enable_confirmations=false (cf. supabase/config.toml) → signUp pose les
  // cookies de session immédiatement. Sans revalidatePath, RSC nav vers
  // /compte/commandes réutilise le RootLayout cached pré-signup avec
  // initial.user=null, navbar affiche "Connexion" alors que l'user est loggé.
  // Pattern strictement identique au fix login PR #13. Le sync useEffect
  // PR #14 dans UserProvider tirera ensuite sur la transition initial.user?.id.
  revalidatePath("/", "layout");
  redirect("/compte/commandes");
}
