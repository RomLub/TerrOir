import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { dbErrorResponse } from "@/lib/api/db-error-response";
import {
  consumeRateLimit,
  getExportComptaRateLimit,
} from "@/lib/rate-limit";
import {
  buildProducerAccountingExportData,
  ProducerAccountingExportError,
} from "@/lib/accounting/producer-export-data";
import { producerAccountingFilename } from "@/lib/accounting/producer-export-csv";
import { generateProducerAccountingPdf } from "@/lib/accounting/producer-export-pdf";

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
    const data = await buildProducerAccountingExportData({
      admin: createSupabaseAdminClient(),
      userId: session.id,
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    });
    const pdf = await generateProducerAccountingPdf(data);
    const body = pdf.buffer.slice(
      pdf.byteOffset,
      pdf.byteOffset + pdf.byteLength,
    ) as ArrayBuffer;
    const filename = producerAccountingFilename({
      from: data.period.from,
      to: data.period.to,
      extension: "pdf",
    });

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return producerAccountingErrorResponse(error);
  }
}

function producerAccountingErrorResponse(error: unknown): NextResponse {
  if (error instanceof ProducerAccountingExportError) {
    if (error.dbError && error.code) {
      return dbErrorResponse(error.dbError, error.code, error.context);
    }
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  throw error;
}
