import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extractHeureRetrait } from "@/lib/slots/format-slot-time";

const bodySchema = z.object({
  producer_id: z.string().uuid(),
  slot_id: z.string().uuid(),
  date_retrait: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes_client: z.string().trim().max(1000).optional(),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantite: z.number().positive(),
      }),
    )
    .min(1),
});

// Mappe les SQLSTATE levés par create_order_with_items vers HTTP.
function sqlstateToStatus(code: string | undefined): number {
  switch (code) {
    case "22023":
      return 400;
    case "P0002":
      return 404;
    case "23514":
      return 409;
    case "42501":
      return 403;
    default:
      return 500;
  }
}

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }
  const { producer_id, slot_id, date_retrait, notes_client, items } =
    parsed.data;

  // User client : auth.uid() est posé, indispensable pour la RPC
  // SECURITY DEFINER qui vérifie p_consumer_id = auth.uid().
  const supabase = createSupabaseServerClient();

  // heure_retrait = heure locale (Europe/Paris) extraite du slot.starts_at,
  // autoritatif côté serveur. La RPC attend un `time` ; on passe "HH:MM:00".
  const { data: slot } = await supabase
    .from("slots")
    .select("starts_at")
    .eq("id", slot_id)
    .maybeSingle();
  if (!slot) {
    return NextResponse.json(
      { error: "Créneau introuvable ou producteur inactif" },
      { status: 400 },
    );
  }

  const { data: orderId, error: rpcError } = await supabase.rpc(
    "create_order_with_items",
    {
      p_consumer_id: session.id,
      p_producer_id: producer_id,
      p_slot_id: slot_id,
      p_date_retrait: date_retrait,
      p_heure_retrait: extractHeureRetrait(slot.starts_at as string),
      p_notes_client: notes_client ?? null,
      // prix_unitaire est présent pour cohérence d'interface mais la RPC
      // l'ignore et refacture au prix DB courant.
      p_items: items.map((i) => ({
        product_id: i.product_id,
        quantite: i.quantite,
        prix_unitaire: 0,
      })),
    },
  );

  if (rpcError) {
    return NextResponse.json(
      { error: rpcError.message, code: rpcError.code },
      { status: sqlstateToStatus(rpcError.code) },
    );
  }
  if (!orderId) {
    return NextResponse.json(
      { error: "RPC returned no order_id" },
      { status: 500 },
    );
  }

  const { data: order } = await supabase
    .from("orders")
    .select(
      "code_commande, montant_total, commission_terroir, montant_net_producteur",
    )
    .eq("id", orderId as string)
    .single();

  return NextResponse.json({
    order_id: orderId,
    code_commande: order?.code_commande,
    montant_total: order?.montant_total,
    commission: order?.commission_terroir,
    montant_net: order?.montant_net_producteur,
  });
}
