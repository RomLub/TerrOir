import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getProducerInterest } from "@/lib/admin/producer-interests/fetch";
import { logLeadFollowup } from "@/lib/admin/producer-interests/mutations";
import { logProducerInterestsEvent } from "@/lib/audit-logs/log-producer-interests-event";
import {
  FOLLOWUP_CHANNELS,
  FOLLOWUP_DIRECTIONS,
} from "@/lib/admin/producer-interests/types";

// POST /api/admin/leads/[id]/followup — journalise une interaction manuelle
// (email / téléphone / RDV, entrant ou sortant). Met à jour last_contact_at
// (+ first_contact_at si premier contact). Audit producer_interest_followup_logged.

const bodySchema = z.object({
  channel: z.enum(FOLLOWUP_CHANNELS as unknown as [string, ...string[]]),
  direction: z.enum(FOLLOWUP_DIRECTIONS as unknown as [string, ...string[]]),
  note: z.string().trim().max(5000).optional().or(z.literal("")),
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

  const note = (parsed.data.note ?? "").trim();
  const result = await logLeadFollowup(admin, {
    leadId: id,
    channel: parsed.data.channel as (typeof FOLLOWUP_CHANNELS)[number],
    direction: parsed.data.direction as (typeof FOLLOWUP_DIRECTIONS)[number],
    note: note.length > 0 ? note : null,
    createdBy: session.id,
    isAutomatic: false,
  });
  if (!result.ok) {
    return NextResponse.json({ error: "Internal database error" }, { status: 500 });
  }

  await logProducerInterestsEvent({
    eventType: "producer_interest_followup_logged",
    userId: session.id,
    metadata: {
      interest_id: id,
      followup_id: result.data.id,
      channel: parsed.data.channel,
      direction: parsed.data.direction,
    },
  });

  return NextResponse.json({ id: result.data.id }, { status: 201 });
}
