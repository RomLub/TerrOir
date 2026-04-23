import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { OnboardingWizard } from "../invitation/_components/OnboardingWizard";

// Reprise d'onboarding pour un producteur en statut 'draft' (Phase 4).
// Accessible depuis le middleware qui redirige ici tout producer draft qui
// tente d'atteindre une autre route producer. Le wizard est réutilisé avec
// token="" + caseKind="consumer-loggedin" : la légitimité vient de la
// session, plus du producer draft existant — côté actions, voir la branche
// `if (token) ... else ...` dans update-personal-info / complete-onboarding.
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

  const [{ data: userRow }, { data: producer }] = await Promise.all([
    admin
      .from("users")
      .select("prenom, nom, telephone")
      .eq("id", session.id)
      .maybeSingle(),
    admin
      .from("producers")
      .select(
        "prenom_affichage, nom_exploitation, forme_juridique, siret, adresse, code_postal, commune, type_production, type_production_precision, statut",
      )
      .eq("user_id", session.id)
      .maybeSingle(),
  ]);

  // Pas de draft à reprendre : soit déjà finalisé, soit incohérence DB.
  if (!producer || producer.statut !== "draft") {
    redirect("/ma-page");
  }

  const prenom = (userRow?.prenom as string | null) ?? "";
  const nom = (userRow?.nom as string | null) ?? "";
  const telephone = (userRow?.telephone as string | null) ?? "";

  const hasPersonal = !!prenom && !!nom && !!telephone;
  const startStep: 2 | 3 = hasPersonal ? 3 : 2;

  const initialPersonnel = { prenom, nom, telephone };

  const initialEntreprise = {
    prenom_affichage: (producer.prenom_affichage as string) ?? "",
    nom_exploitation:
      producer.nom_exploitation === "À compléter"
        ? ""
        : ((producer.nom_exploitation as string) ?? ""),
    forme_juridique: (producer.forme_juridique as string) ?? "",
    siret: (producer.siret as string) ?? "",
    adresse: (producer.adresse as string) ?? "",
    code_postal: (producer.code_postal as string) ?? "",
    commune: (producer.commune as string) ?? "",
    type_production: (producer.type_production as string) ?? "",
    type_production_precision:
      (producer.type_production_precision as string) ?? "",
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <OnboardingWizard
        token=""
        email={session.email ?? ""}
        caseKind="consumer-loggedin"
        startStep={startStep}
        initialPersonnel={initialPersonnel}
        initialEntreprise={initialEntreprise}
      />
    </main>
  );
}
