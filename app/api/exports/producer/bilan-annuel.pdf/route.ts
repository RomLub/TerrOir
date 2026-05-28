import { NextResponse } from "next/server";
import { dbErrorResponse } from "@/lib/api/db-error-response";
import { getSessionUser } from "@/lib/auth/session";
import {
  buildProducerAnnualReportData,
  parseAnnualReportYear,
  producerAnnualReportFilename,
} from "@/lib/accounting/producer-annual-report";
import { ProducerAccountingExportError } from "@/lib/accounting/producer-export-data";
import { generateProducerAnnualReportPdf } from "@/lib/accounting/producer-annual-report-pdf";
import {
  consumeRateLimit,
  getExportComptaRateLimit,
} from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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
  try {
    const year = parseAnnualReportYear(url.searchParams.get("year"));
    const report = await buildProducerAnnualReportData({
      admin: createSupabaseAdminClient(),
      userId: session.id,
      year,
    });
    const pdf = await generateProducerAnnualReportPdf(report);
    const body = pdf.buffer.slice(
      pdf.byteOffset,
      pdf.byteOffset + pdf.byteLength,
    ) as ArrayBuffer;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${producerAnnualReportFilename(year)}"`,
        "Cache-Control": "private, no-store",
      },
    });
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
