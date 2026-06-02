import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type OrderStatus } from "@/lib/orders/stateMachine";
import { formatOrderNumber } from "@/lib/orders/order-number";

// =============================================================================
// Helper code-based pour la validation pickup producer (saisie code en haut
// de page commandes). Distingue strictement des routes id-based existantes
// (/api/orders/[id]/complete) : ici, le code seul résout l'order, et le
// scope producer est imposé après lookup.
//
// Format code : TRR-XXXXX ou TRR-XXXXXXX (préfixe TRR- + 5/7 chars charset sans confusion
// 23456789ABCDEFGHJKLMNPQRSTUVWXYZ). Source : trigger Postgres
// generate_order_code() (supabase/migrations/20260511007000_p0_sweep_f033_generate_order_code_7chars.sql).
// =============================================================================

const PICKUP_CODE_REGEX =
  /^TRR-(?:[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}|[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{7})$/;

export const pickupCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(PICKUP_CODE_REGEX, "Format de code invalide");

export type PickupCode = z.infer<typeof pickupCodeSchema>;

// -----------------------------------------------------------------------------
// Erreurs typées — discriminated union
//
// Note anti-info-leakage : la couche API (LOT 3) mappe `code_unknown` ET
// `wrong_producer` vers une réponse 404 générique commune. La distinction
// est conservée ici uniquement pour permettre l'audit log interne (events
// pickup_attempt_invalid avec raison) — un producer ne doit jamais pouvoir
// déduire qu'un code "exists but isn't mine" vs "doesn't exist at all".
// -----------------------------------------------------------------------------

export type PickupValidationError =
  | { kind: "code_format_invalid" }
  | { kind: "code_unknown" }
  | { kind: "wrong_producer" }
  | {
      kind: "order_not_confirmed";
      current_status: OrderStatus;
      order_id: string;
    }
  | {
      kind: "order_already_completed";
      completed_at: string | null;
      order_id: string;
    }
  | { kind: "order_cancelled"; order_id: string }
  | { kind: "order_refunded"; order_id: string };

export interface PickupOrderItem {
  name: string;
  qty: string;
  unit_price: number;
  total: number;
}

export interface PickupOrderPreview {
  id: string;
  code_commande: string;
  numero_commande: string;
  consumer_id: string;
  consumer_name: string;
  items: PickupOrderItem[];
  total_amount: number;
  status: OrderStatus;
  created_at: string;
}

export interface PickupValidatedOrder
  extends Omit<PickupOrderPreview, "status"> {
  status: "completed";
  completed_at: string;
}

export type PickupResult<T> =
  | { ok: true; order: T }
  | { ok: false; error: PickupValidationError };

// -----------------------------------------------------------------------------
// Internes
// -----------------------------------------------------------------------------

interface RawOrderRow {
  id: string;
  code_commande: string;
  producer_order_seq: number;
  producer_id: string;
  consumer_id: string;
  statut: OrderStatus;
  montant_total: number | string | null;
  completed_at: string | null;
  created_at: string;
  consumer:
    | { prenom: string | null; nom: string | null }
    | Array<{ prenom: string | null; nom: string | null }>
    | null;
  producer:
    | { producer_number: number }
    | Array<{ producer_number: number }>
    | null;
  order_items:
    | Array<{
        quantite: number | string;
        prix_unitaire: number | string;
        sous_total: number | string;
        products:
          | { nom: string; unite: string | null }
          | Array<{ nom: string; unite: string | null }>
          | null;
      }>
    | null;
}

const ORDER_SELECT = `
  id, code_commande, producer_order_seq, producer_id, consumer_id, statut, montant_total,
  completed_at, created_at,
  consumer:consumer_id ( prenom, nom ),
  producer:producers!orders_producer_id_fkey ( producer_number ),
  order_items ( quantite, prix_unitaire, sous_total, products:product_id ( nom, unite ) )
`;

function nonConfirmedStatusToError(
  status: OrderStatus,
  orderId: string,
  completedAt: string | null,
): PickupValidationError {
  if (status === "completed") {
    return {
      kind: "order_already_completed",
      completed_at: completedAt,
      order_id: orderId,
    };
  }
  if (status === "cancelled") {
    return { kind: "order_cancelled", order_id: orderId };
  }
  if (status === "refunded") {
    return { kind: "order_refunded", order_id: orderId };
  }
  // pending uniquement (Cluster C — T6 cleanup : 'ready' retiré du modèle).
  return {
    kind: "order_not_confirmed",
    current_status: status,
    order_id: orderId,
  };
}

function buildPreview(row: RawOrderRow): PickupOrderPreview {
  const consumer = Array.isArray(row.consumer) ? row.consumer[0] : row.consumer;
  const producer = Array.isArray(row.producer) ? row.producer[0] : row.producer;
  const consumerName =
    [consumer?.prenom, consumer?.nom].filter(Boolean).join(" ").trim() ||
    "Client";
  const producerNumber = producer?.producer_number ?? 0;

  const items: PickupOrderItem[] = (row.order_items ?? []).map((oi) => {
    const product = Array.isArray(oi.products) ? oi.products[0] : oi.products;
    const qty = Number(oi.quantite).toFixed(2).replace(".", ",");
    return {
      name: product?.nom ?? "Produit",
      qty: `${qty} ${product?.unite ?? ""}`.trim(),
      unit_price: Number(oi.prix_unitaire),
      total: Number(oi.sous_total),
    };
  });

  return {
    id: row.id,
    code_commande: row.code_commande,
    numero_commande: formatOrderNumber(producerNumber, row.producer_order_seq),
    consumer_id: row.consumer_id,
    consumer_name: consumerName,
    items,
    total_amount: Number(row.montant_total ?? 0),
    status: row.statut,
    created_at: row.created_at,
  };
}

// -----------------------------------------------------------------------------
// API publique
// -----------------------------------------------------------------------------

/**
 * Lecture seule par code, scope strict producer.
 *
 * Distingue 7 résultats possibles :
 *   - ok / preview complète (consumer_name + items + total)
 *   - code_format_invalid (Zod stop avant tout I/O)
 *   - code_unknown / wrong_producer (404 générique côté API)
 *   - order_not_confirmed (avec current_status, pour message UI explicite)
 *   - order_already_completed (avec completed_at)
 *   - order_cancelled / order_refunded
 */
export async function previewPickup(
  admin: SupabaseClient,
  rawCode: string,
  producerId: string,
): Promise<PickupResult<PickupOrderPreview>> {
  const parsed = pickupCodeSchema.safeParse(rawCode);
  if (!parsed.success) {
    return { ok: false, error: { kind: "code_format_invalid" } };
  }
  const code = parsed.data;

  const { data } = await admin
    .from("orders")
    .select(ORDER_SELECT)
    .eq("code_commande", code)
    .maybeSingle();

  // Cast direct vers RawOrderRow : PostgREST renvoie un type approximatif
  // pour les embeds nominaux (consumer:consumer_id(...), order_items(...)) et
  // ne peut pas être inféré finement même avec les types générés de
  // database.types.ts (les alias d'embed cassent le mapping automatique).
  // Le typage runtime reste aligné via RawOrderRow + parsing défensif dans
  // buildPreview.
  const row = data as RawOrderRow | null;
  if (!row) {
    return { ok: false, error: { kind: "code_unknown" } };
  }
  if (row.producer_id !== producerId) {
    return { ok: false, error: { kind: "wrong_producer" } };
  }
  if (row.statut !== "confirmed") {
    return {
      ok: false,
      error: nonConfirmedStatusToError(row.statut, row.id, row.completed_at),
    };
  }

  return { ok: true, order: buildPreview(row) };
}

/**
 * Transition atomique confirmed → completed.
 *
 * Pipeline :
 *   1. Validation Zod du format code (stop avant I/O si invalide)
 *   2. SELECT par code_commande pour caractériser les erreurs typées
 *   3. UPDATE atomique conditionné WHERE statut='confirmed' (race-safe
 *      face à un même producer ouvrant 2 tabs : seul le premier réussit,
 *      le second matche 0 rows et reçoit order_already_completed)
 *   4. En cas de 0 row affected, re-SELECT pour caractériser le nouvel
 *      état (probablement completed par l'autre tab)
 *
 * Les responsabilités externes (audit log, email, rate-limit) sont laissées
 * à la couche API — ce helper reste pure DB-side.
 */
export async function validatePickup(
  admin: SupabaseClient,
  rawCode: string,
  producerId: string,
): Promise<PickupResult<PickupValidatedOrder>> {
  const parsed = pickupCodeSchema.safeParse(rawCode);
  if (!parsed.success) {
    return { ok: false, error: { kind: "code_format_invalid" } };
  }
  const code = parsed.data;

  const { data: lookupData } = await admin
    .from("orders")
    .select(ORDER_SELECT)
    .eq("code_commande", code)
    .maybeSingle();

  const row = lookupData as RawOrderRow | null;
  if (!row) {
    return { ok: false, error: { kind: "code_unknown" } };
  }
  if (row.producer_id !== producerId) {
    return { ok: false, error: { kind: "wrong_producer" } };
  }
  if (row.statut !== "confirmed") {
    return {
      ok: false,
      error: nonConfirmedStatusToError(row.statut, row.id, row.completed_at),
    };
  }

  const completedAt = new Date().toISOString();

  // F-001 P0-TA : transition confirmed → completed via RPC SECDEF
  // complete_pickup_by_producer (auth dispatch interne owner > admin >
  // service_role + assertTransition + UPDATE atomique race-safe + audit
  // log `pickup_validated` cluster pickup_* dans la même transaction).
  // p_submitted_code passé pour double-vérif SQL-side defense-in-depth.
  const { error: rpcError } = await admin.rpc("complete_pickup_by_producer", {
    p_order_id: row.id,
    p_submitted_code: rawCode,
  });

  if (rpcError) {
    // Mapper SQLSTATE → PickupValidationError.
    // 22023 = invalid_pickup_code (RPC line 225, single cause confirmée
    // par grep migration F-001). Defense-in-depth : le SELECT initial a
    // déjà filtré, on n'arrive ici qu'en cas de race ultra-rare.
    if (rpcError.code === "22023") {
      return { ok: false, error: { kind: "code_unknown" } };
    }
    // 42501 = forbidden (la RPC re-vérifie owns_producer même si la
    // route a déjà filtré côté caller — defense-in-depth).
    if (rpcError.code === "42501") {
      return { ok: false, error: { kind: "wrong_producer" } };
    }
    // 02000 = order_not_found (la RPC SELECT INTO miss).
    if (rpcError.code === "02000") {
      return { ok: false, error: { kind: "code_unknown" } };
    }
    // P0001 = illegal transition (race : statut a bougé entre SELECT
    // initial et appel RPC). Re-caractériser l'état actuel.
    if (rpcError.code === "P0001" || rpcError.code === "40001") {
      const { data: refetchData } = await admin
        .from("orders")
        .select("id, statut, completed_at")
        .eq("id", row.id)
        .maybeSingle();
      const refetched = refetchData as
        | { id: string; statut: OrderStatus; completed_at: string | null }
        | null;
      if (!refetched) {
        return { ok: false, error: { kind: "code_unknown" } };
      }
      return {
        ok: false,
        error: nonConfirmedStatusToError(
          refetched.statut,
          refetched.id,
          refetched.completed_at,
        ),
      };
    }
    // Autres SQLSTATE inattendus : propage comme avant (caller route
    // gère le 500 forensique).
    throw rpcError;
  }

  // Re-lire l'order post-RPC pour rebuild le preview (la RPC retourne
  // juste l'uuid, pas la row complète — choix sécurité : exposer le RETURNING
  // via PostgREST leakerait montant_total etc. à tout caller authenticated
  // qui aurait l'UUID). 1 SELECT supplémentaire acceptable (pas hot path).
  const { data: refreshedData } = await admin
    .from("orders")
    .select(ORDER_SELECT)
    .eq("id", row.id)
    .maybeSingle();

  const updated = refreshedData as RawOrderRow | null;
  if (!updated) {
    return { ok: false, error: { kind: "code_unknown" } };
  }

  const preview = buildPreview(updated);
  return {
    ok: true,
    order: {
      ...preview,
      status: "completed",
      completed_at: updated.completed_at ?? completedAt,
    },
  };
}
