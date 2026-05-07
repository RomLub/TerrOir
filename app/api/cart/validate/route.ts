// POST /api/cart/validate
// Valide un panier côté serveur contre l'état DB courant. Utilisé par :
//   - /compte/panier au load (flashe un banner + remove/clamp les items).
//   - /compte/checkout juste avant POST /api/orders/create (défense en
//     profondeur : l'admin peut suspendre un producer entre l'arrivée sur
//     checkout et le clic "Payer").
//
// Stratégie :
//   - Client user-scope (RLS) pour producers/products/slots. Les lignes
//     invisibles = indisponibles, on distingue via les IDs demandés vs
//     retournés. Simpler que des checks explicites sur `statut = 'public'`
//     + `active = true` — même source de vérité que les pages publiques.
//   - Client admin (service_role) pour count(orders) : la policy
//     "orders parties read" limite le consumer à ses propres orders, donc
//     un COUNT via client user renverrait 0. Le compte de réservations
//     actives sur un slot n'est pas une info sensible et reproduit la
//     logique de la RPC create_order_with_items.
//
// Ne mute rien : la RPC reste seule responsable de l'insertion atomique.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  itemKey,
  type ItemStatus,
  type ValidateResponse,
} from "@/lib/cart/validate";

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        producerId: z.string().uuid(),
        creneauId: z.string().uuid(),
        dateRetrait: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        quantite: z.number().positive(),
      }),
    )
    .max(100),
});

type ProductRow = {
  id: string;
  producer_id: string;
  stock_disponible: number | string | null;
  stock_illimite: boolean;
};

type SlotRow = {
  id: string;
  producer_id: string;
  capacity_per_slot: number;
};

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { items } = parsed.data;

  if (items.length === 0) {
    return NextResponse.json<ValidateResponse>({ results: {} });
  }

  const producerIds = Array.from(new Set(items.map((i) => i.producerId)));
  const productIds = Array.from(new Set(items.map((i) => i.productId)));
  const slotIds = Array.from(new Set(items.map((i) => i.creneauId)));

  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  const [producersRes, productsRes, slotsRes, ordersRes] = await Promise.all([
    supabase.from("producers").select("id").in("id", producerIds),
    supabase
      .from("products")
      .select("id, producer_id, stock_disponible, stock_illimite")
      .in("id", productIds),
    supabase
      .from("slots")
      .select("id, producer_id, capacity_per_slot")
      .in("id", slotIds),
    admin
      .from("orders")
      .select("slot_id")
      .in("slot_id", slotIds)
      .in("statut", ["pending", "confirmed", "ready"]),
  ]);

  // T-450 forensique : log greppable [CART_VALIDATE_SELECT_FAIL] sur fail
  // SELECT batch. Si Supabase retourne {data: null, error: <err>} (RLS bug,
  // statement_timeout, etc.), le `?? []` ci-dessous masque silencieusement
  // → tous items flag *_unavailable (faux négatifs UX) sans trace forensique.
  // Pattern aligné T-427 (orders/create:182-201) inline console.warn template
  // literal UPPER_SNAKE_CASE. Fail-soft préservé : `?? []` inchangé, route
  // reste 200, comportement client inchangé. Diagnostic post-incident :
  // grep "CART_VALIDATE_SELECT_FAIL" logs/ filtrable par table=X.
  if (producersRes.error) {
    console.warn(
      `[CART_VALIDATE_SELECT_FAIL] table=producers error=${producersRes.error.message}`,
    );
  }
  if (productsRes.error) {
    console.warn(
      `[CART_VALIDATE_SELECT_FAIL] table=products error=${productsRes.error.message}`,
    );
  }
  if (slotsRes.error) {
    console.warn(
      `[CART_VALIDATE_SELECT_FAIL] table=slots error=${slotsRes.error.message}`,
    );
  }
  if (ordersRes.error) {
    console.warn(
      `[CART_VALIDATE_SELECT_FAIL] table=orders error=${ordersRes.error.message}`,
    );
  }

  const validProducers = new Set(
    (producersRes.data ?? []).map((p) => p.id as string),
  );
  const productsMap = new Map<string, ProductRow>();
  for (const row of (productsRes.data ?? []) as ProductRow[]) {
    productsMap.set(row.id, row);
  }
  const slotsMap = new Map<string, SlotRow>();
  for (const row of (slotsRes.data ?? []) as SlotRow[]) {
    slotsMap.set(row.id, row);
  }
  const slotCounts = new Map<string, number>();
  for (const row of (ordersRes.data ?? []) as { slot_id: string }[]) {
    slotCounts.set(row.slot_id, (slotCounts.get(row.slot_id) ?? 0) + 1);
  }

  const results: Record<string, ItemStatus> = {};
  for (const item of items) {
    const key = itemKey(item);

    if (!validProducers.has(item.producerId)) {
      results[key] = {
        ok: false,
        fatal: true,
        reason: "producer_unavailable",
      };
      continue;
    }

    const product = productsMap.get(item.productId);
    if (!product || product.producer_id !== item.producerId) {
      results[key] = {
        ok: false,
        fatal: true,
        reason: "product_unavailable",
      };
      continue;
    }

    const slot = slotsMap.get(item.creneauId);
    if (!slot || slot.producer_id !== item.producerId) {
      results[key] = { ok: false, fatal: true, reason: "slot_unavailable" };
      continue;
    }

    const taken = slotCounts.get(item.creneauId) ?? 0;
    if (taken >= slot.capacity_per_slot) {
      results[key] = { ok: false, fatal: true, reason: "slot_full" };
      continue;
    }

    if (!product.stock_illimite) {
      const stock = Number(product.stock_disponible ?? 0);
      if (stock < item.quantite) {
        if (stock <= 0) {
          // Stock tombé à 0 : l'item ne peut plus être commandé du tout.
          // Traité comme product_unavailable (fatal) plutôt que
          // stock_insufficient (clamp) — on ne laisse pas une ligne à 0.
          results[key] = {
            ok: false,
            fatal: true,
            reason: "product_unavailable",
          };
        } else {
          results[key] = {
            ok: false,
            fatal: false,
            reason: "stock_insufficient",
            maxQuantite: stock,
          };
        }
        continue;
      }
    }

    results[key] = { ok: true };
  }

  return NextResponse.json<ValidateResponse>({ results });
}
