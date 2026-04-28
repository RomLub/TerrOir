import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordMonthlyUpdate } from "@/lib/gms-prices/admin-write";

// POST /api/admin/gms-prices/[id]/update-prices — Workflow mise à jour
// mensuelle. Atomicité applicative (cf. arbitrage A1) : helper enchaîne
// UPDATE live → INSERT history.
//
// Réponse :
//   - 200 + history_recorded=true  : tout OK (live + history posés)
//   - 200 + history_recorded=false : live OK mais INSERT history fail
//     (ex: UNIQUE constraint si même mois posé deux fois). Warning loggé
//     côté serveur, à remonter côté admin pour visibilité (le live public
//     est correct, history retentable manuellement).
//   - 500 : UPDATE live a échoué, rien n'a été modifié.

const bodySchema = z.object({
  prix_gms_kg: z.number().positive(),
  prix_terroir_kg_min: z.number().positive().nullable(),
  prix_terroir_kg_max: z.number().positive().nullable(),
  prix_terroir_kg_moyen: z.number().positive().nullable(),
  mois_reference: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "mois_reference attendu au format YYYY-MM"),
  source: z.string().trim().min(1),
  source_url: z.string().url().nullable(),
});

interface RouteContext {
  params: { id: string };
}

export async function POST(request: Request, { params }: RouteContext) {
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
    return NextResponse.json({ error: selectError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await recordMonthlyUpdate(
    admin,
    params.id,
    parsed.data,
    session.id,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    id: params.id,
    history_recorded: result.data.history_recorded,
  });
}
