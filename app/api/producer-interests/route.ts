import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { upsertProducerInterest } from "@/lib/producer-interests/upsert-interest";
import { maskEmail } from "@/lib/rgpd/mask-email";

// POST /api/producer-interests — soumission du formulaire public
// /devenir-producteur (création de lead producteur).
//
// Pattern aligné app/api/stock-alerts/route.tsx (POST anonyme acceptant
// anon + authenticated). RLS bypass via service-role applicatif car la
// sémantique UPSERT (INSERT + catch 23505 + UPDATE) requiert UPDATE qui
// est restreint à l'admin par RLS sur producer_interests. Le formulaire
// avant cette refonte utilisait un INSERT direct côté browser via la
// policy "producer_interests public insert" (anon) — laissée en place
// par cohérence (cf. arbitrage A3 PUSH 1).
//
// Sécurité :
//   - validation Zod stricte (tous les champs business required sauf
//     message, normalisation email trim+toLowerCase)
//   - pas de rate limit dédié (volume formulaire candidature très bas,
//     à reconsidérer si abus détecté)
//   - aucune session requise (POST anonyme)

const bodySchema = z.object({
  prenom: z.string().trim().min(1, "Prénom requis"),
  nom: z.string().trim().min(1, "Nom requis"),
  email: z.string().trim().toLowerCase().email("Email invalide"),
  telephone: z.string().trim().min(1, "Téléphone requis"),
  nom_exploitation: z
    .string()
    .trim()
    .min(1, "Nom de l'exploitation requis"),
  commune: z.string().trim().min(1, "Commune requise"),
  message: z.string().trim().optional(),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const admin = createSupabaseAdminClient();

  const result = await upsertProducerInterest(admin, {
    prenom: input.prenom,
    nom: input.nom,
    email: input.email,
    telephone: input.telephone,
    nom_exploitation: input.nom_exploitation,
    commune: input.commune,
    message: input.message && input.message.length > 0 ? input.message : null,
  });

  if (!result.ok) {
    console.error(
      `[PRODUCER_INTEREST_API_UPSERT_ERROR] email=${maskEmail(input.email)} error=${result.error}`,
    );
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }

  return NextResponse.json({ status: result.data.status });
}
