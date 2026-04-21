"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loginSchema } from "@/lib/auth/validators";

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

  // Lookup parallèle users + admin_users — mutuellement exclusifs.
  const [{ data: profile }, { data: adminRow }] = await Promise.all([
    supabase
      .from("users")
      .select("roles")
      .eq("id", data.user.id)
      .maybeSingle(),
    supabase
      .from("admin_users")
      .select("id")
      .eq("id", data.user.id)
      .maybeSingle(),
  ]);

  const roles = (profile?.roles as string[] | undefined) ?? [];
  const isAdmin = !!adminRow;

  if (isAdmin) redirect("/tableau-de-bord");
  if (roles.includes("producer")) redirect("/dashboard");
  redirect("/compte");
}
