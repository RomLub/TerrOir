import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getAuditLogStats } from "@/lib/audit-logs/stats";

// GET /api/admin/audit-logs/stats — JSON endpoint pour pilotage dashboard
// (4 metric cards de la page /admin/audit-logs + futurs cas d'usage type
// healthcheck admin scripté).
//
// Auth : session.isAdmin (cohérent /api/admin/audit-logs/export et
// /api/admin/legal-compliance/stats). Pas de rate-limit dédié — endpoint
// read-only sans coût significatif (4 count agrégés + 1 fetch borné à
// 50k lignes pour le top type), et l'admin est de confiance.
//
// Pas de cache HTTP (Cache-Control no-store) : l'admin doit voir l'état
// temps réel (cohérent dynamic = "force-dynamic" de la page).

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSessionUser();
  if (!session || !session.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const stats = await getAuditLogStats();
    return NextResponse.json(stats, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.warn(
      `[AUDIT_LOGS_STATS_ERROR] error=${(err as Error).message}`,
    );
    return NextResponse.json(
      { error: "stats_unavailable" },
      { status: 500 },
    );
  }
}
