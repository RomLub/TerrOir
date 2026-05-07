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
// sec-P2-5 (T9 2026-05-07) : cache HTTP `private, max-age=60` côté browser
// admin pour réduire la charge DB (4 count() agrégés + 1 fetch 50k lignes).
// 60s suffit largement pour un dashboard (l'admin clique rarement plus
// souvent). `private` interdit le cache CDN/proxy (réponse contient des
// stats opérationnelles, ne doit pas fuiter à un CDN partagé). `dynamic =
// "force-dynamic"` reste pour Next (pas de SSG/ISR), Cache-Control est la
// décision propre côté HTTP.

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
      headers: { "Cache-Control": "private, max-age=60" },
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
