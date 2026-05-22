import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchAdminLeadsList } from "@/lib/admin/producer-interests/fetch";
import type { LeadSource } from "@/lib/admin/producer-interests/types";

// GET /api/admin/leads?source=&step=&referent= — listing leads filtré.
// Lecture admin service_role. Filtres optionnels source / step / référent.
export const dynamic = "force-dynamic";

const VALID_SOURCES: readonly LeadSource[] = ["formulaire_public", "invitation_directe"];

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const sourceRaw = url.searchParams.get("source");
  const stepRaw = url.searchParams.get("step");
  const referentRaw = url.searchParams.get("referent");

  const source =
    sourceRaw && VALID_SOURCES.includes(sourceRaw as LeadSource)
      ? (sourceRaw as LeadSource)
      : undefined;

  let step: number | undefined;
  if (stepRaw !== null) {
    const n = Number(stepRaw);
    if (Number.isInteger(n) && n >= 1 && n <= 6) step = n;
  }

  const assignedTo =
    referentRaw && /^[0-9a-f-]{36}$/i.test(referentRaw) ? referentRaw : undefined;

  const admin = createSupabaseAdminClient();
  try {
    const leads = await fetchAdminLeadsList(admin, { source, step, assignedTo });
    return NextResponse.json({ count: leads.length, leads });
  } catch {
    return NextResponse.json({ error: "Internal database error" }, { status: 500 });
  }
}
