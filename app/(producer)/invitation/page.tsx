import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import InvitationForm from "./invitation-form";

interface PageProps {
  searchParams: { token?: string };
}

async function loadInvitation(token: string | undefined) {
  if (!token) return { status: "missing" as const };

  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("producer_invitations")
    .select("email, expires_at, used_at")
    .eq("token", token)
    .maybeSingle();

  if (!data) return { status: "not-found" as const };
  if (data.used_at) return { status: "used" as const };
  if (new Date(data.expires_at) < new Date())
    return { status: "expired" as const };

  return { status: "ok" as const, email: data.email };
}

export default async function InvitationPage({ searchParams }: PageProps) {
  const invitation = await loadInvitation(searchParams.token);

  if (invitation.status !== "ok") {
    const messages: Record<typeof invitation.status, string> = {
      missing: "Lien incomplet — token manquant.",
      "not-found": "Invitation introuvable.",
      used: "Cette invitation a déjà été utilisée.",
      expired: "Cette invitation est expirée.",
    };
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md rounded-lg bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-terroir-terracotta">
            Invitation invalide
          </h1>
          <p className="mt-3 text-sm text-gray-700">
            {messages[invitation.status]}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-terroir-green">
          Bienvenue sur TerrOir
        </h1>
        <p className="mt-2 text-sm text-gray-700">
          Créez votre mot de passe pour activer votre compte producteur.
        </p>
        <p className="mt-1 text-sm font-medium">{invitation.email}</p>

        <InvitationForm token={searchParams.token!} />
      </div>
    </main>
  );
}
