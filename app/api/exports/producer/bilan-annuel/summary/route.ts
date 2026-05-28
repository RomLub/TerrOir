import { NextResponse } from "next/server";
import { dbErrorResponse } from "@/lib/api/db-error-response";
import { getSessionUser } from "@/lib/auth/session";
import {
  buildProducerAnnualReportData,
  parseAnnualReportYear,
} from "@/lib/accounting/producer-annual-report";
import { ProducerAccountingExportError } from "@/lib/accounting/producer-export-data";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const url = new URL(request.url);
  try {
    const year = parseAnnualReportYear(url.searchParams.get("year"));
    const report = await buildProducerAnnualReportData({
      admin: createSupabaseAdminClient(),
      userId: session.id,
      year,
    });

    return NextResponse.json(
      {
        report: {
          year: report.year,
          summary: report.summary,
          monthly: report.monthly,
          topProducts: report.topProducts,
        },
      },
      {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    return producerAnnualReportErrorResponse(error);
  }
}

function producerAnnualReportErrorResponse(error: unknown): NextResponse {
  if (error instanceof ProducerAccountingExportError) {
    if (error.dbError && error.code) {
      return dbErrorResponse(error.dbError, error.code, error.context);
    }
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  throw error;
}
