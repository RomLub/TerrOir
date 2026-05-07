import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { updateGmsPrice } from "@/lib/gms-prices/admin-write";

// PUT /api/admin/gms-prices/[id] — Édition standard hors workflow mensuel.
// Body : libelle, description_courte, source, source_url, ordre_affichage,
// notes_admin uniquement.
//
// Champs intentionnellement non éditables ici (cf. arbitrage A3 Phase B) :
//   - slug + filiere : figés post-création (sécurité URLs publiques + clé
//     regroupement). Modification = SQL manuel si typo.
//   - prix_* + mois_reference : passent par POST /update-prices (workflow
//     mensuel + INSERT history).
//   - active : passe par POST /archive (soft delete).

const bodySchema = z.object({
  libelle: z.string().trim().min(1),
  description_courte: z.string().trim().nullable(),
  source: z.string().trim().min(1),
  source_url: z.string().url().nullable(),
  ordre_affichage: z.number().int().min(0),
  notes_admin: z.string().trim().nullable(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(request: Request, props: RouteContext) {
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

  // Pré-check 404 : sans select préalable, UPDATE eq id inexistant renvoie
  // 0 rows affected sans erreur Supabase → on confondrait succès et NotFound.
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

  const result = await updateGmsPrice(admin, params.id, parsed.data, session.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ id: params.id });
}
