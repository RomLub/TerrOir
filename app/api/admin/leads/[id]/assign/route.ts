import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getProducerInterest } from "@/lib/admin/producer-interests/fetch";
import { assignLead } from "@/lib/admin/producer-interests/mutations";
import { logProducerInterestsEvent } from "@/lib/audit-logs/log-producer-interests-event";

// PATCH /api/admin/leads/[id]/assign — assigne (ou désassigne) un référent
// (admin_users.id) à un lead. Audit producer_interest_assigned.
// assigned_to=null = désassignation. La FK producer_interests.assigned_to →
// admin_users(id) garantit qu'un référent inexistant est rejeté.

const bodySchema = z.object({
  assigned_to: z.string().uuid().nullable(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, props: RouteContext) {
  const { id } = await props.params;
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
  const before = await getProducerInterest(admin, id);
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await assignLead(admin, id, parsed.data.assigned_to);
  if (!result.ok) {
    // Probable violation FK (référent absent d'admin_users) → 400 explicite.
    return NextResponse.json({ error: "Référent invalide" }, { status: 400 });
  }

  await logProducerInterestsEvent({
    eventType: "producer_interest_assigned",
    userId: session.id,
    metadata: {
      interest_id: id,
      email: before.email,
      previous_assigned_to: before.assigned_to,
      new_assigned_to: parsed.data.assigned_to,
    },
  });

  return NextResponse.json({ id, assigned_to: parsed.data.assigned_to });
}
