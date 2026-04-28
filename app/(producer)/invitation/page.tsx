import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { pickInitialInfos } from "@/lib/producers/pick-initial-infos";
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

function ErrorCard({
  title,
  message,
  ctaLabel,
  ctaHref,
}: {
  title: string;
  message: string;
  ctaLabel?: string;
  ctaHref?: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md rounded-lg bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-terroir-terracotta">{title}</h1>
        <p className="mt-3 text-sm text-gray-700">{message}</p>
        {ctaLabel && ctaHref ? (
          <Link
            href={ctaHref}
            className="mt-6 inline-flex items-center rounded-md bg-terroir-green-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-terroir-green-700/90"
          >
            {ctaLabel}
          </Link>
        ) : null}
      </div>
    </main>
  );
}

export default async function InvitationPage({ searchParams }: PageProps) {
  const token = searchParams.token;
  if (!token) {
    return (
      <ErrorCard
        title="Invitation invalide"
        message="Lien incomplet — token manquant."
        ctaLabel="Demander une nouvelle invitation"
        ctaHref="/devenir-producteur"
      />
    );
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
        ctaLabel="Demander une nouvelle invitation"
        ctaHref="/devenir-producteur"
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
        ctaLabel="Se connecter"
        ctaHref="/connexion"
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
            "id, nom_exploitation, forme_juridique, siret, adresse, code_postal, commune, type_production, type_production_precision, statut",
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
        ctaLabel="Se connecter à mon espace"
        ctaHref="/connexion"
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

  // Lead matching pour pré-remplissage (Phase 2 du chantier "Vision funnel
  // producteur"). On cherche le lead le plus récent en statut 'contacted' ou
  // 'onboarded' (lifecycle post-invitation), match email case-insensitive.
  // Si aucun lead matché : pas grave, le wizard démarre champs vides.
  const { data: lead } = await admin
    .from("producer_interests")
    .select("prenom, nom, telephone, nom_exploitation, commune")
    .ilike("email", email)
    .in("statut", ["contacted", "onboarded"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Détermination du cas + préparation des valeurs initiales
  let caseKind: WizardCase;
  let startStep: 1 | 2 = 1;
  let producerForPick = existingProducer;

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

    if (!existingProducer) {
      // TODO Phase 3 finale : retirer prenom_affichage de cet INSERT après le
      // DROP COLUMN producers.prenom_affichage.
      await admin.from("producers").insert({
        user_id: existingUser.id,
        slug: slugFromEmail(email),
        prenom_affichage: "À compléter",
        nom_exploitation: "À compléter",
        statut: "draft",
      });
      producerForPick = null;
    }
    startStep = 2;
  } else {
    caseKind = "consumer-login";
  }

  const initialInfos = pickInitialInfos(
    producerForPick,
    existingUser
      ? {
          prenom: (existingUser.prenom as string | null) ?? null,
          nom: (existingUser.nom as string | null) ?? null,
          telephone: (existingUser.telephone as string | null) ?? null,
        }
      : null,
    lead ?? null,
  );

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <OnboardingWizard
        token={token}
        email={email}
        caseKind={caseKind}
        startStep={startStep}
        initialInfos={initialInfos}
      />
    </main>
  );
}
