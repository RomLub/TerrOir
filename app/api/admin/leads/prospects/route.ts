import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createProspectLead } from "@/lib/admin/producer-interests/mutations";
import { logProducerInterestsEvent } from "@/lib/audit-logs/log-producer-interests-event";

// POST /api/admin/leads/prospects — création d'un lead prospecté (repéré
// manuellement par l'admin, étape 1 de la frise prospecté). source =
// 'invitation_directe', statut 'new'. Audit producer_interest_prospect_created.

const bodySchema = z.object({
  prenom: z.string().trim().max(120).optional().or(z.literal("")),
  nom: z.string().trim().min(1, "Nom requis").max(120),
  email: z.string().trim().toLowerCase().email("Email invalide"),
  telephone: z.string().trim().max(40).optional().or(z.literal("")),
  nom_exploitation: z.string().trim().max(200).optional().or(z.literal("")),
  commune: z.string().trim().max(120).optional().or(z.literal("")),
  especes: z.array(z.string().trim().min(1)).max(20).optional(),
  message: z.string().trim().max(5000).optional().or(z.literal("")),
});

function nullable(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
}

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();
  const result = await createProspectLead(admin, {
    prenom: nullable(parsed.data.prenom),
    nom: parsed.data.nom,
    email: parsed.data.email,
    telephone: nullable(parsed.data.telephone),
    nom_exploitation: nullable(parsed.data.nom_exploitation),
    commune: nullable(parsed.data.commune),
    especes: parsed.data.especes && parsed.data.especes.length > 0
      ? parsed.data.especes
      : null,
    message: nullable(parsed.data.message),
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: "Internal database error" },
      { status: 500 },
    );
  }

  await logProducerInterestsEvent({
    eventType: "producer_interest_prospect_created",
    userId: session.id,
    metadata: {
      interest_id: result.data.id,
      email: parsed.data.email,
      source: "invitation_directe",
    },
  });

  return NextResponse.json({ id: result.data.id }, { status: 201 });
}
