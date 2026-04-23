import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { OnboardingWizard, type WizardCase } from "./_components/OnboardingWizard";

interface PageProps {
  searchParams: { token?: string };
}

type InvitationStatus = "ok" | "missing" | "not-found" | "used" | "expired";

function slugFromEmail(email: string) {
  const base = email.split("@")[0]!.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md rounded-lg bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-terroir-terracotta">{title}</h1>
        <p className="mt-3 text-sm text-gray-700">{message}</p>
      </div>
    </main>
  );
}

export default async function InvitationPage({ searchParams }: PageProps) {
  const token = searchParams.token;
  if (!token) {
    return <ErrorCard title="Invitation invalide" message="Lien incomplet — token manquant." />;
  }

  const admin = createSupabaseAdminClient();

  const { data: invitation } = await admin
    .from("producer_invitations")
    .select("email, expires_at, used_at")
    .eq("token", token)
    .maybeSingle();

  const status: InvitationStatus = !invitation
    ? "not-found"
    : invitation.used_at
      ? "used"
      : new Date(invitation.expires_at) < new Date()
        ? "expired"
        : "ok";

  if (status !== "ok" || !invitation) {
    const messages: Record<Exclude<InvitationStatus, "ok">, string> = {
      missing: "Lien incomplet — token manquant.",
      "not-found": "Invitation introuvable.",
      used: "Cette invitation a déjà été utilisée.",
      expired: "Cette invitation est expirée.",
    };
    return (
      <ErrorCard
        title="Invitation invalide"
        message={messages[status as Exclude<InvitationStatus, "ok">]}
      />
    );
  }

  const email = invitation.email as string;

  // Défense en profondeur : Phase 2 bloque déjà ces cas côté envoi d'invitation,
  // mais une invitation antérieure à Phase 2 pourrait encore exister.
  const { data: adminRow } = await admin
    .from("admin_users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (adminRow) {
    return (
      <ErrorCard
        title="Invitation invalide"
        message="Cet email est associé à un compte administrateur."
      />
    );
  }

  const { data: existingUser } = await admin
    .from("users")
    .select("id, roles, prenom, nom, telephone")
    .eq("email", email)
    .maybeSingle();

  const existingRoles = Array.isArray(existingUser?.roles)
    ? (existingUser!.roles as string[])
    : [];

  // On charge la ligne producer si un user existe, pour distinguer :
  //   - producer avec statut='draft' : onboarding en cours, on doit laisser
  //     passer (cas typique : re-render SSR après step 1 quand signIn a
  //     déposé des cookies, Next.js refresh, on revient ici avec le user
  //     qu'on vient de créer).
  //   - producer avec statut in (pending|active|public|suspended) :
  //     onboarding complété, l'invitation est invalide.
  const existingProducer = existingUser
    ? (
        await admin
          .from("producers")
          .select(
            "id, prenom_affichage, nom_exploitation, forme_juridique, siret, adresse, code_postal, commune, type_production, type_production_precision, statut",
          )
          .eq("user_id", existingUser.id)
          .maybeSingle()
      ).data
    : null;

  if (
    existingRoles.includes("producer") &&
    existingProducer &&
    existingProducer.statut !== "draft"
  ) {
    return (
      <ErrorCard
        title="Invitation invalide"
        message="Ce producteur est déjà inscrit."
      />
    );
  }

  const session = await getSessionUser();
  const isLoggedInAsInvitee = session?.email === email;

  // Phase 4 : si l'invitee est déjà loggé, a le rôle producer en DB et
  // un producer en draft, on centralise la reprise dans /onboarding —
  // pas besoin du token, la session suffit. La double vérification
  // (rôle + draft) garantit qu'aucun auto-upgrade n'est nécessaire à
  // ce stade. Les autres cas (pas loggé, loggé autre compte, producer
  // inexistant, rôle pas encore ajouté) gardent le flux classique
  // ci-dessous qui fait l'auto-upgrade puis affiche le wizard.
  if (
    isLoggedInAsInvitee &&
    existingRoles.includes("producer") &&
    existingProducer &&
    existingProducer.statut === "draft"
  ) {
    redirect("/onboarding");
  }

  // Détermination du cas + préparation des valeurs initiales
  let caseKind: WizardCase;
  let startStep: 1 | 2 | 3 = 1;
  const initialPersonnel = {
    prenom: existingUser?.prenom ?? "",
    nom: existingUser?.nom ?? "",
    telephone: existingUser?.telephone ?? "",
  };
  let initialEntreprise = {
    prenom_affichage: "",
    nom_exploitation: "",
    forme_juridique: "",
    siret: "",
    adresse: "",
    code_postal: "",
    commune: "",
    type_production: "",
    type_production_precision: "",
  };

  if (!existingUser) {
    caseKind = "new";
  } else if (isLoggedInAsInvitee) {
    caseKind = "consumer-loggedin";

    // Auto-upgrade côté serveur (idempotent) : ajoute 'producer' au tableau
    // roles et crée la ligne producers en statut='draft' si absente.
    if (!existingRoles.includes("producer")) {
      const newRoles = Array.from(new Set([...existingRoles, "producer"]));
      await admin
        .from("users")
        .update({ roles: newRoles })
        .eq("id", existingUser.id);
    }

    const producer = existingProducer;

    if (!producer) {
      await admin.from("producers").insert({
        user_id: existingUser.id,
        slug: slugFromEmail(email),
        prenom_affichage: "À compléter",
        nom_exploitation: "À compléter",
        statut: "draft",
      });
      startStep = 2;
    } else {
      initialEntreprise = {
        prenom_affichage:
          producer.prenom_affichage === "À compléter"
            ? ""
            : (producer.prenom_affichage as string) ?? "",
        nom_exploitation:
          producer.nom_exploitation === "À compléter"
            ? ""
            : (producer.nom_exploitation as string) ?? "",
        forme_juridique: (producer.forme_juridique as string) ?? "",
        siret: (producer.siret as string) ?? "",
        adresse: (producer.adresse as string) ?? "",
        code_postal: (producer.code_postal as string) ?? "",
        commune: (producer.commune as string) ?? "",
        type_production: (producer.type_production as string) ?? "",
        type_production_precision:
          (producer.type_production_precision as string) ?? "",
      };

      // Détection reprise : étape 2 si infos perso vides, sinon étape 3.
      const hasPersonal =
        !!initialPersonnel.prenom &&
        !!initialPersonnel.nom &&
        !!initialPersonnel.telephone;
      startStep = hasPersonal ? 3 : 2;
    }
  } else {
    caseKind = "consumer-login";
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <OnboardingWizard
        token={token}
        email={email}
        caseKind={caseKind}
        startStep={startStep}
        initialPersonnel={initialPersonnel}
        initialEntreprise={initialEntreprise}
      />
    </main>
  );
}
