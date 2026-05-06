import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { escapeIlikeEmail } from "@/lib/supabase/escape-ilike";
import { getSessionUser } from "@/lib/auth/session";
import { pickInitialInfos } from "@/lib/producers/pick-initial-infos";
import { OnboardingWizard } from "../invitation/_components/OnboardingWizard";

// Reprise d'onboarding pour un producteur en statut 'draft' (Phase 4).
// Accessible depuis le middleware qui redirige ici tout producer draft qui
// tente d'atteindre une autre route producer. Le wizard est réutilisé avec
// token="" + caseKind="consumer-loggedin" : la légitimité vient de la
// session, plus du producer draft existant — côté action complete-onboarding,
// voir la branche `if (token) ... else ...`.
export default async function OnboardingPage() {
  const session = await getSessionUser();
  if (!session) {
    redirect("/connexion?redirectTo=/onboarding");
  }

  // Admins : jamais concernés par un flux de reprise producteur.
  if (session.isAdmin) {
    redirect("/");
  }

  // Consumer pur sans casquette producer : rien à reprendre.
  if (!session.roles.includes("producer")) {
    redirect("/");
  }

  const admin = createSupabaseAdminClient();

  const [{ data: userRow }, { data: producer }, { data: lead }] =
    await Promise.all([
      admin
        .from("users")
        .select("prenom, nom, telephone")
        .eq("id", session.id)
        .maybeSingle(),
      admin
        .from("producers")
        .select(
          "nom_exploitation, forme_juridique, siret, adresse, code_postal, commune, type_production, type_production_precision, statut",
        )
        .eq("user_id", session.id)
        .maybeSingle(),
      // Lead matching pour pré-remplissage (Phase 2 du chantier "Vision
      // funnel producteur") — même requête que /invitation/page.tsx.
      session.email
        ? admin
            .from("producer_interests")
            .select("prenom, nom, telephone, nom_exploitation, commune")
            .ilike("email", escapeIlikeEmail(session.email))
            .in("statut", ["contacted", "onboarded"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  // Pas de draft à reprendre : soit déjà finalisé, soit incohérence DB.
  if (!producer || producer.statut !== "draft") {
    redirect("/ma-page");
  }

  const initialInfos = pickInitialInfos(
    producer,
    userRow
      ? {
          prenom: (userRow.prenom as string | null) ?? null,
          nom: (userRow.nom as string | null) ?? null,
          telephone: (userRow.telephone as string | null) ?? null,
        }
      : null,
    lead ?? null,
  );

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <OnboardingWizard
        token=""
        email={session.email ?? ""}
        caseKind="consumer-loggedin"
        startStep={2}
        initialInfos={initialInfos}
      />
    </main>
  );
}
