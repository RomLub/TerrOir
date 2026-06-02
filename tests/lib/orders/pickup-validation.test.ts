// Tests vitest pour lib/orders/pickup-validation.ts.
//
// Couverture :
//   - pickupCodeSchema : format strict TRR-XXXXX / TRR-XXXXXXX,
//     charset sans confusion,
//     normalisation trim+toUpperCase
//   - previewPickup : nominal + 7 cas d'erreurs typées (code_unknown,
//     wrong_producer, statut pending/completed/cancelled/refunded,
//     format_invalid)
//   - validatePickup : nominal avec UPDATE atomique, race condition (UPDATE
//     retourne null → re-fetch caractérise), format_invalid sans I/O,
//     producer mismatch sans UPDATE
//
// Pattern de mock Supabase léger (queue FIFO de réponses + capture des
// appels) : suffisant car helper avec DI propre, pas de vi.mock global.

import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  pickupCodeSchema,
  previewPickup,
  validatePickup,
} from "@/lib/orders/pickup-validation";

// --- Types & helpers de mock --------------------------------------------

type MockResp = { data: unknown; error?: unknown };

interface Captured {
  fromCalls: string[];
  selects: Array<{ table: string; cols: string }>;
  updates: Array<{ table: string; payload: unknown }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
  rpcCalls: Array<{ name: string; params: unknown }>;
}

let captured: Captured;
let responses: MockResp[]; // FIFO : maybeSingle() consomme la première
// F-001 P0-TA : queue de retours RPC (FIFO comme responses).
// `complete_pickup_by_producer` consomme la 1re entrée. Default = success.
let rpcResponses: MockResp[];

function makeAdmin(): SupabaseClient {
  const admin = {
    from: (table: string) => {
      captured.fromCalls.push(table);
      const builder: Record<string, unknown> = {};
      builder.select = (cols: string) => {
        captured.selects.push({ table, cols });
        return builder;
      };
      builder.update = (payload: unknown) => {
        captured.updates.push({ table, payload });
        return builder;
      };
      builder.eq = (col: string, val: unknown) => {
        captured.eqCalls.push({ table, col, val });
        return builder;
      };
      builder.maybeSingle = () => {
        const r = responses.shift() ?? { data: null };
        return Promise.resolve(r);
      };
      return builder;
    },
    rpc: (name: string, params: unknown) => {
      captured.rpcCalls.push({ name, params });
      const r = rpcResponses.shift() ?? { data: null, error: null };
      return Promise.resolve(r);
    },
  };
  return admin as unknown as SupabaseClient;
}

// --- Données de test ----------------------------------------------------

const PRODUCER_ID = "prod-1";
const OTHER_PRODUCER_ID = "prod-2";
const ORDER_ID = "order-1";
const CODE = "TRR-ABCDE";
const CODE_7 = "TRR-ABCDEFG";
const CONSUMER_ID = "cons-1";

const baseRow = {
  id: ORDER_ID,
  code_commande: CODE,
  producer_id: PRODUCER_ID,
  consumer_id: CONSUMER_ID,
  statut: "confirmed",
  montant_total: "12.50",
  completed_at: null,
  created_at: "2026-05-06T10:00:00Z",
  consumer: { prenom: "Marie", nom: "Dupont" },
  order_items: [
    {
      quantite: "1",
      prix_unitaire: "8.00",
      sous_total: "8.00",
      products: { nom: "Saucisson sec", unite: "pièce" },
    },
    {
      quantite: "0.5",
      prix_unitaire: "9.00",
      sous_total: "4.50",
      products: { nom: "Pâté de campagne", unite: "kg" },
    },
  ],
};

beforeEach(() => {
  captured = {
    fromCalls: [],
    selects: [],
    updates: [],
    eqCalls: [],
    rpcCalls: [],
  };
  responses = [];
  rpcResponses = [];
});

// --- A. pickupCodeSchema (format strict) --------------------------------

describe("pickupCodeSchema — format strict TRR-XXXXX / TRR-XXXXXXX", () => {
  describe("acceptés", () => {
    it("A1 TRR-ABCDE → ok", () => {
      expect(pickupCodeSchema.safeParse("TRR-ABCDE").success).toBe(true);
    });

    it("A2 lowercase trr-abcde → ok (toUpperCase auto)", () => {
      const r = pickupCodeSchema.safeParse("trr-abcde");
      expect(r.success).toBe(true);
      if (r.success) expect(r.data).toBe("TRR-ABCDE");
    });

    it("A3 espaces autour → ok (trim auto)", () => {
      const r = pickupCodeSchema.safeParse("  TRR-23456  ");
      expect(r.success).toBe(true);
      if (r.success) expect(r.data).toBe("TRR-23456");
    });

    it("A4 charset complet 23456789ABCDEFGHJKLMNPQRSTUVWXYZ accepté", () => {
      // 5 chars du charset, sans 0/1/I/O
      expect(pickupCodeSchema.safeParse("TRR-23456").success).toBe(true);
      expect(pickupCodeSchema.safeParse("TRR-WXYZJ").success).toBe(true);
    });

    it("A5 nouveau format 7 caractères → ok", () => {
      expect(pickupCodeSchema.safeParse(CODE_7).success).toBe(true);
    });
  });

  describe("rejetés", () => {
    it.each([
      ["TRR-12345", "char '1' hors charset"],
      ["TRR-I0OAB", "chars I/0/O hors charset"],
      ["TRR-ABCD", "trop court (4 chars)"],
      ["TRR-ABCDEF", "longueur intermédiaire refusée (6 chars)"],
      ["TRR-ABCDEFGH", "trop long (8 chars)"],
      ["ABC-ABCDE", "mauvais préfixe"],
      ["TRRABCDE", "pas de tiret"],
      ["", "vide"],
      ["TRR-", "préfixe seul"],
      ["trr-abcd1", "char '1' interdit même en lowercase"],
    ])("rejet : %s (%s)", (input) => {
      expect(pickupCodeSchema.safeParse(input).success).toBe(false);
    });
  });
});

// --- B. previewPickup ---------------------------------------------------

describe("previewPickup", () => {
  it("B1 nominal → ok + preview complet (consumer_name, items, total)", async () => {
    responses = [{ data: baseRow }];
    const result = await previewPickup(makeAdmin(), CODE, PRODUCER_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.id).toBe(ORDER_ID);
    expect(result.order.code_commande).toBe(CODE);
    expect(result.order.consumer_id).toBe(CONSUMER_ID);
    expect(result.order.consumer_name).toBe("Marie Dupont");
    expect(result.order.status).toBe("confirmed");
    expect(result.order.total_amount).toBe(12.5);
    expect(result.order.items).toHaveLength(2);
    expect(result.order.items[0]).toEqual({
      name: "Saucisson sec",
      qty: "1,00 pièce",
      unit_price: 8,
      total: 8,
    });
    expect(result.order.items[1]).toEqual({
      name: "Pâté de campagne",
      qty: "0,50 kg",
      unit_price: 9,
      total: 4.5,
    });
  });

  it("B2 lookup par code_commande (assertion sur eq calls)", async () => {
    responses = [{ data: baseRow }];
    await previewPickup(makeAdmin(), CODE, PRODUCER_ID);
    const codeEq = captured.eqCalls.find((e) => e.col === "code_commande");
    expect(codeEq).toBeDefined();
    expect(codeEq!.val).toBe(CODE);
    expect(captured.updates).toEqual([]); // lecture seule
  });

  it("B3 code introuvable → code_unknown", async () => {
    responses = [{ data: null }];
    const result = await previewPickup(makeAdmin(), CODE, PRODUCER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("code_unknown");
  });

  it("B4 producer mismatch → wrong_producer (anti-info-leakage côté API)", async () => {
    responses = [{ data: baseRow }];
    const result = await previewPickup(makeAdmin(), CODE, OTHER_PRODUCER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("wrong_producer");
  });

  it("B5 statut pending → order_not_confirmed avec current_status='pending'", async () => {
    responses = [{ data: { ...baseRow, statut: "pending" } }];
    const result = await previewPickup(makeAdmin(), CODE, PRODUCER_ID);
    expect(result.ok).toBe(false);
    if (result.ok || result.error.kind !== "order_not_confirmed") {
      expect.fail("expected order_not_confirmed");
    }
    expect(result.error.current_status).toBe("pending");
    expect(result.error.order_id).toBe(ORDER_ID);
  });

  it("B6 statut completed → order_already_completed (completed_at préservé)", async () => {
    const completedAt = "2026-05-05T14:00:00Z";
    responses = [
      {
        data: { ...baseRow, statut: "completed", completed_at: completedAt },
      },
    ];
    const result = await previewPickup(makeAdmin(), CODE, PRODUCER_ID);
    expect(result.ok).toBe(false);
    if (result.ok || result.error.kind !== "order_already_completed") {
      expect.fail("expected order_already_completed");
    }
    expect(result.error.completed_at).toBe(completedAt);
    expect(result.error.order_id).toBe(ORDER_ID);
  });

  it("B7 statut cancelled → order_cancelled", async () => {
    responses = [{ data: { ...baseRow, statut: "cancelled" } }];
    const result = await previewPickup(makeAdmin(), CODE, PRODUCER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("order_cancelled");
  });

  it("B8 statut refunded → order_refunded", async () => {
    responses = [{ data: { ...baseRow, statut: "refunded" } }];
    const result = await previewPickup(makeAdmin(), CODE, PRODUCER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("order_refunded");
  });

  it("B9 format invalide → code_format_invalid sans aucun I/O Supabase", async () => {
    const result = await previewPickup(makeAdmin(), "WRONG", PRODUCER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("code_format_invalid");
    expect(captured.fromCalls).toEqual([]);
  });

  it("B11 consumer null → consumer_name fallback 'Client'", async () => {
    responses = [{ data: { ...baseRow, consumer: null } }];
    const result = await previewPickup(makeAdmin(), CODE, PRODUCER_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order.consumer_name).toBe("Client");
  });

  it("B12 order_items null → items=[] (pas de crash)", async () => {
    responses = [{ data: { ...baseRow, order_items: null } }];
    const result = await previewPickup(makeAdmin(), CODE, PRODUCER_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order.items).toEqual([]);
  });
});

// --- C. validatePickup --------------------------------------------------

describe("validatePickup", () => {
  it("C1 nominal confirmed → completed via RPC SECDEF (F-001 P0-TA)", async () => {
    const completedAt = "2026-05-06T11:00:00Z";
    responses = [
      { data: baseRow }, // SELECT lookup initial
      {
        data: { ...baseRow, statut: "completed", completed_at: completedAt },
      }, // SELECT post-RPC pour rebuild preview
    ];
    // RPC default success (data: null, error: null).
    const result = await validatePickup(makeAdmin(), CODE, PRODUCER_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.status).toBe("completed");
    expect(result.order.completed_at).toBe(completedAt);
    expect(result.order.id).toBe(ORDER_ID);

    // F-001 P0-TA : .rpc('complete_pickup_by_producer') au lieu d'.update().
    expect(captured.rpcCalls).toContainEqual({
      name: "complete_pickup_by_producer",
      params: { p_order_id: ORDER_ID, p_submitted_code: CODE },
    });
    expect(captured.updates).toEqual([]);
  });

  it("C2 RPC complete_pickup_by_producer atomicité SQL-side (race-safe garantie côté SQL)", async () => {
    responses = [
      { data: baseRow },
      {
        data: {
          ...baseRow,
          statut: "completed",
          completed_at: "2026-05-06T11:00:00Z",
        },
      },
    ];
    await validatePickup(makeAdmin(), CODE, PRODUCER_ID);
    // F-001 P0-TA : la garde atomique `.eq("statut","confirmed")` est
    // désormais SQL-side dans la RPC SECDEF (cf migration F-001 ligne 247).
    // Pas observable depuis ce mock vitest — la RPC encapsule. On vérifie
    // juste que la RPC est bien appelée (la garde atomique est testée
    // indirectement par les tests C6/C7 qui simulent la race via SQLSTATE).
    expect(captured.rpcCalls).toContainEqual({
      name: "complete_pickup_by_producer",
      params: { p_order_id: ORDER_ID, p_submitted_code: CODE },
    });
  });

  it("C3 code introuvable → code_unknown sans UPDATE", async () => {
    responses = [{ data: null }];
    const result = await validatePickup(makeAdmin(), CODE, PRODUCER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("code_unknown");
    expect(captured.updates).toEqual([]);
  });

  it("C4 producer mismatch → wrong_producer sans UPDATE", async () => {
    responses = [{ data: baseRow }];
    const result = await validatePickup(makeAdmin(), CODE, OTHER_PRODUCER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("wrong_producer");
    expect(captured.updates).toEqual([]);
  });

  it("C5 statut completed déjà → order_already_completed sans UPDATE", async () => {
    const completedAt = "2026-05-05T14:00:00Z";
    responses = [
      {
        data: { ...baseRow, statut: "completed", completed_at: completedAt },
      },
    ];
    const result = await validatePickup(makeAdmin(), CODE, PRODUCER_ID);
    expect(result.ok).toBe(false);
    if (result.ok || result.error.kind !== "order_already_completed") {
      expect.fail("expected order_already_completed");
    }
    expect(result.error.completed_at).toBe(completedAt);
    expect(captured.updates).toEqual([]);
  });

  it("C6 race perdue (RPC P0001) → re-fetch caractérise already_completed", async () => {
    const raceCompletedAt = "2026-05-06T11:30:00Z";
    responses = [
      { data: baseRow }, // SELECT lookup → confirmed
      {
        data: {
          id: ORDER_ID,
          statut: "completed",
          completed_at: raceCompletedAt,
        },
      }, // re-fetch post-P0001
    ];
    rpcResponses = [
      {
        data: null,
        error: { code: "P0001", message: "illegal_transition" },
      },
    ];
    const result = await validatePickup(makeAdmin(), CODE, PRODUCER_ID);
    expect(result.ok).toBe(false);
    if (result.ok || result.error.kind !== "order_already_completed") {
      expect.fail("expected order_already_completed via race re-fetch");
    }
    expect(result.error.completed_at).toBe(raceCompletedAt);
  });

  it("C7 race perdue + re-fetch null → code_unknown (cas dégénéré)", async () => {
    responses = [
      { data: baseRow }, // SELECT lookup
      { data: null }, // re-fetch null (cas extrême : DELETE entre temps)
    ];
    rpcResponses = [
      {
        data: null,
        error: { code: "P0001", message: "illegal_transition" },
      },
    ];
    const result = await validatePickup(makeAdmin(), CODE, PRODUCER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("code_unknown");
  });

  it("C8 statut pending → order_not_confirmed sans UPDATE", async () => {
    responses = [{ data: { ...baseRow, statut: "pending" } }];
    const result = await validatePickup(makeAdmin(), CODE, PRODUCER_ID);
    expect(result.ok).toBe(false);
    if (result.ok || result.error.kind !== "order_not_confirmed") {
      expect.fail("expected order_not_confirmed");
    }
    expect(result.error.current_status).toBe("pending");
    expect(captured.updates).toEqual([]);
  });

  it("C9 format invalide → code_format_invalid sans I/O ni UPDATE", async () => {
    const result = await validatePickup(makeAdmin(), "WRONG", PRODUCER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("code_format_invalid");
    expect(captured.fromCalls).toEqual([]);
    expect(captured.updates).toEqual([]);
  });

  it("C10 erreur DB inattendue lors RPC → throw remonté au caller (500-grade)", async () => {
    responses = [{ data: baseRow }];
    // F-001 P0-TA : SQLSTATE inconnu (hors mapping kind) → throw rpcError.
    rpcResponses = [
      {
        data: null,
        error: { code: "XX000", message: "DB connection lost" },
      },
    ];
    await expect(
      validatePickup(makeAdmin(), CODE, PRODUCER_ID),
    ).rejects.toMatchObject({ message: "DB connection lost" });
  });
});
