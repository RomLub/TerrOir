import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { archiveGmsPrice } from "@/lib/gms-prices/admin-write";
import { dbErrorResponse } from "@/lib/api/db-error-response";

// POST /api/admin/gms-prices/[id]/archive — Soft delete bidirectionnel.
// Body : { action: 'archive' | 'restore' } (toggle active).
//
// Pattern aligné /api/admin/reviews/[id]/moderate qui utilise un body
// discriminé { action: 'publish' | 'reject' } pour 2 actions inverses sur
// un même endpoint. Plus économique que 2 endpoints séparés et lisible côté
// client (1 seul fetch URL à connaître).
//
// Pas de hard DELETE exposé (cf. arbitrage A5) : préserver gms_prices_history
// (FK ON DELETE CASCADE) — purge physique réservée à Supabase Studio si besoin.

const bodySchema = z.object({
  action: z.enum(["archive", "restore"]),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, props: RouteContext) {
  const params = await props.params;
  const session = await getSessionUser();
  if (!session || !session.isAdmin) {
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

  const { data: existing, error: selectError } = await admin
    .from("gms_prices")
    .select("id")
    .eq("id", params.id)
    .maybeSingle();
  if (selectError) {
    return dbErrorResponse(selectError, "ADMIN_GMS_PRICE_ARCHIVE_SELECT", {
      gms_price_id: params.id,
    });
  }
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const active = parsed.data.action === "restore";
  const result = await archiveGmsPrice(admin, params.id, active, session.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ id: params.id, active });
}
