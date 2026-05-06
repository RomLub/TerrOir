import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getCGUComplianceStats } from "@/lib/legal/compliance";

// GET /api/admin/legal-compliance/stats
// Counts globaux pour les cards du dashboard. Auth admin only.

export async function GET() {
  const session = await getSessionUser();
  if (!session || !session.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const stats = await getCGUComplianceStats();
    return NextResponse.json(stats);
  } catch (err) {
    const message = (err as Error).message ?? "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
