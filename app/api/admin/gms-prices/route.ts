import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createGmsPrice } from "@/lib/gms-prices/admin-write";

// POST /api/admin/gms-prices — Création d'une nouvelle référence GMS.
// Body : tous les champs catalogue + mois_reference de départ obligatoire
// (la création n'écrit pas de gms_prices_history — la 1re ligne history
// sera posée au 1er passage par le workflow update-prices, conformément à
// la sémantique "history = trace des changements mensuels").
//
// Auth : admin only (cf. arbitrage Phase B + service_role obligatoire pour
// les writes gms_prices, RLS sans policy INSERT).

const bodySchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "slug doit être en kebab-case (a-z, 0-9, -)"),
  filiere: z.enum(["bovin", "porcin", "ovin"]),
  libelle: z.string().trim().min(1),
  description_courte: z.string().trim().nullable(),
  prix_gms_kg: z.number().positive(),
  prix_terroir_kg_min: z.number().positive().nullable(),
  prix_terroir_kg_max: z.number().positive().nullable(),
  prix_terroir_kg_moyen: z.number().positive().nullable(),
  mois_reference: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "mois_reference attendu au format YYYY-MM"),
  source: z.string().trim().min(1),
  source_url: z.string().url().nullable(),
  ordre_affichage: z.number().int().min(0),
  notes_admin: z.string().trim().nullable(),
});

export async function POST(request: Request) {
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
  const result = await createGmsPrice(admin, parsed.data, session.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ id: result.data.id }, { status: 201 });
}
