import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { dbErrorResponse } from "@/lib/api/db-error-response";
import {
  buildProducerAccountingExportData,
  ProducerAccountingExportError,
} from "@/lib/accounting/producer-export-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const url = new URL(request.url);
  try {
    const data = await buildProducerAccountingExportData({
      admin: createSupabaseAdminClient(),
      userId: session.id,
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    });

    return NextResponse.json(
      {
        generatedAt: data.generatedAt,
        period: data.period,
        producer: data.producer,
        summary: data.summary,
      },
      {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
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
