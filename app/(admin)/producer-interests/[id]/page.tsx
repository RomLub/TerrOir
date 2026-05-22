import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getProducerInterest,
  fetchLeadFollowups,
} from "@/lib/admin/producer-interests/fetch";
import { LeadDetailClient } from "../_components/LeadDetailClient";

// Détail d'un lead producteur (chantier 3 Phase 3). SSR service_role :
// lead + historique des interactions + liste des référents (admin_users → join
// séparé sur public.users car PostgREST ne traverse pas auth.*).

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createSupabaseAdminClient();

  const lead = await getProducerInterest(admin, id);
  if (!lead) notFound();

  const followups = await fetchLeadFollowups(admin, id);

  // Référents = admins. admin_users.id = auth.users.id ; l'identité vit dans
  // public.users (fetch séparé + map, cf. doctrine LESSONS jointures admin).
  const { data: adminRows } = await admin.from("admin_users").select("id");
  const adminIds = (adminRows ?? []).map((a) => (a as { id: string }).id);
  const { data: profiles } = adminIds.length
    ? await admin
        .from("users")
        .select("id, email, prenom, nom")
        .in("id", adminIds)
    : { data: [] as { id: string; email: string; prenom: string | null; nom: string | null }[] };

  const labelOf = (p: { email: string; prenom: string | null; nom: string | null }) =>
    [p.prenom, p.nom].filter(Boolean).join(" ").trim() || p.email;

  const referents = (profiles ?? []).map((p) => ({
    id: (p as { id: string }).id,
    label: labelOf(p as { email: string; prenom: string | null; nom: string | null }),
  }));
  const authorNames: Record<string, string> = {};
  for (const r of referents) authorNames[r.id] = r.label;

  return (
    <LeadDetailClient
      lead={lead}
      followups={followups}
      referents={referents}
      authorNames={authorNames}
    />
  );
}
