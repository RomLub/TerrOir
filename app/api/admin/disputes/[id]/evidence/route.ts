import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { submitDisputeEvidence } from "@/lib/admin/disputes/submit-evidence";
import { EMPTY_EVIDENCE, type DisputeEvidenceFields } from "@/lib/admin/disputes/types";

// POST /api/admin/disputes/[id]/evidence — chantier 8. Enregistre (submit=false)
// ou soumet définitivement (submit=true) les preuves d'un litige Stripe.
// Réservé aux admins (opérationnel — pas super_admin). Body : { evidence, submit }.
export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  const { id } = await props.params;
  const session = await getSessionUser();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { evidence?: Partial<DisputeEvidenceFields>; submit?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  // Normalise : on ne garde que les clés connues, coercées en string.
  const raw = body.evidence ?? {};
  const evidence: DisputeEvidenceFields = { ...EMPTY_EVIDENCE };
  for (const k of Object.keys(EMPTY_EVIDENCE) as (keyof DisputeEvidenceFields)[]) {
    const v = raw[k];
    evidence[k] = typeof v === "string" ? v : "";
  }
  const submit = body.submit === true;

  const admin = createSupabaseAdminClient();
  const result = await submitDisputeEvidence(admin, session.id, id, evidence, submit);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  revalidatePath(`/litiges/${id}`);
  revalidatePath("/litiges");
  return NextResponse.json({ ok: true });
}
