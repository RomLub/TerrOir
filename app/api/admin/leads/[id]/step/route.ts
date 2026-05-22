import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getProducerInterest } from "@/lib/admin/producer-interests/fetch";
import { setLeadStep } from "@/lib/admin/producer-interests/mutations";
import { logProducerInterestsEvent } from "@/lib/audit-logs/log-producer-interests-event";

// PATCH /api/admin/leads/[id]/step — avancée manuelle de l'étape funnel d'un
// lead (1..6). Audit producer_interest_step_advanced (previous + new).

const bodySchema = z.object({
  step: z.number().int().min(1).max(6),
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

  const result = await setLeadStep(admin, id, parsed.data.step);
  if (!result.ok) {
    return NextResponse.json({ error: "Internal database error" }, { status: 500 });
  }

  await logProducerInterestsEvent({
    eventType: "producer_interest_step_advanced",
    userId: session.id,
    metadata: {
      interest_id: id,
      email: before.email,
      previous_step: before.current_step,
      new_step: parsed.data.step,
    },
  });

  return NextResponse.json({ id, current_step: parsed.data.step });
}
