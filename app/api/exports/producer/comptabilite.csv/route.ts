import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  consumeRateLimit,
  getExportComptaRateLimit,
} from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveAccountingExportPeriod } from "@/lib/accounting/export-periods";
import { getProducerAccountingExportData } from "@/lib/accounting/producer-export-data";
import {
  buildProducerAccountingCsv,
  buildProducerAccountingCsvFilename,
} from "@/lib/accounting/producer-export-csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const limiter = getExportComptaRateLimit();
  const rateResult = await consumeRateLimit(limiter, `producer:${session.id}`);
  if (!rateResult.success) {
    return NextResponse.json(
      { error: "Trop de requêtes" },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.max(1, Math.ceil((rateResult.reset - Date.now()) / 1000)),
          ),
        },
      },
    );
  }

  const url = new URL(request.url);
  const periodResult = resolveAccountingExportPeriod({
    period: url.searchParams.get("period"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });
  if (!periodResult.ok) {
    return NextResponse.json({ error: periodResult.error }, { status: 400 });
  }

  const exportData = await getProducerAccountingExportData({
    supabase: createSupabaseAdminClient(),
    userId: session.id,
    period: periodResult.period,
  });

  if (!exportData) {
    return NextResponse.json(
      { error: "Profil producteur introuvable" },
      { status: 403 },
    );
  }

  return new NextResponse(buildProducerAccountingCsv(exportData.rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${buildProducerAccountingCsvFilename(
        exportData.period,
      )}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
