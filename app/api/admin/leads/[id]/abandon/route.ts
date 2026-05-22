import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getProducerInterest } from "@/lib/admin/producer-interests/fetch";
import { abandonLead } from "@/lib/admin/producer-interests/mutations";
import { logProducerInterestsEvent } from "@/lib/audit-logs/log-producer-interests-event";

// POST /api/admin/leads/[id]/abandon — abandon manuel d'un lead + raison.
// Audit producer_interest_abandoned_manual. Idempotent : ré-abandonner un
// lead déjà abandonné est accepté (met à jour la raison + la date).

const bodySchema = z.object({
  reason: z.string().trim().min(1, "Raison requise").max(2000),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, props: RouteContext) {
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

  const result = await abandonLead(admin, id, parsed.data.reason);
  if (!result.ok) {
    return NextResponse.json({ error: "Internal database error" }, { status: 500 });
  }

  await logProducerInterestsEvent({
    eventType: "producer_interest_abandoned_manual",
    userId: session.id,
    metadata: {
      interest_id: id,
      email: before.email,
      reason: parsed.data.reason,
    },
  });

  return NextResponse.json({ id, abandoned: true });
}
