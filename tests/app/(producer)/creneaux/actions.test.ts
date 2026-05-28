// Tests vitest des server actions exclude (chantier annuler-et-fermer,
// 2026-05-29). Couvre les nouveaux retours { error, blocking_orders }
// avec shape complète : id, code_commande, consumer_prenom, montant_total,
// slot_starts_at, slot_ends_at.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("@/lib/slots/generate", () => ({
  generateSlotsForProducer: vi.fn(),
  invalidateProducer: vi.fn(),
}));

import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  excludeSlotAction,
  excludeSlotsByIdsAction,
  type BlockingOrder,
} from "@/app/(producer)/creneaux/actions";

const SESSION = {
  id: "user-prod-owner",
  email: "prod@example.com",
  roles: ["producer"],
  isAdmin: false,
} as const;

const PRODUCER_ID = "prod-1";

// Builder de client Supabase mock paramétrable selon les selects/updates
// attendus dans la séquence des actions exclude.
type SelectResp = { data: unknown; error?: { message: string } | null };

type ClientControl = {
  // resolveProducerId → producers.select(id).eq(user_id).maybeSingle()
  producerLookup?: SelectResp;
  // slot lookup ownership : slots.select(id, producer_id).eq(id).maybeSingle()
  // (pour excludeSlotAction)
  slotLookup?: SelectResp;
  // slots batch lookup : .in("id", slotIds) (pour excludeSlotsByIdsAction)
  slotsBatchLookup?: SelectResp;
  // fetchBlockingOrders → orders.select(...).in(slot_id).in(statut)
  blockingOrders?: SelectResp;
  // slots UPDATE excluded_at
  slotsUpdate?: { error?: { message: string } | null };
};

type Captured = {
  fromCalls: string[];
  updates: Array<{ table: string; payload: Record<string, unknown> }>;
};

function buildClient(ctrl: ClientControl = {}): {
  client: SupabaseClient;
  captured: Captured;
} {
  const captured: Captured = { fromCalls: [], updates: [] };

  function makeBuilder(table: string): unknown {
    type Mode = "select" | "update" | null;
    const state: { mode: Mode; nextResp: SelectResp | null } = {
      mode: null,
      nextResp: null,
    };
    const b: any = {};
    b.select = (_cols: string) => {
      state.mode = "select";
      return b;
    };
    b.update = (payload: Record<string, unknown>) => {
      captured.updates.push({ table, payload });
      state.mode = "update";
      return b;
    };
    b.eq = (col: string, _val: unknown) => {
      // pour update (slots) : c'est le terminal, retourne la résolution
      if (state.mode === "update") {
        return Promise.resolve(ctrl.slotsUpdate ?? { error: null });
      }
      // pour select : route selon la table + colonne
      if (table === "producers" && col === "user_id") {
        state.nextResp = ctrl.producerLookup ?? null;
      } else if (table === "slots" && col === "id") {
        state.nextResp = ctrl.slotLookup ?? null;
      }
      return b;
    };
    b.in = (_col: string, _vals: unknown[]) => {
      if (table === "slots") {
        // batch lookup ownership
        return Promise.resolve(
          ctrl.slotsBatchLookup ?? { data: [], error: null },
        );
      }
      if (table === "orders") {
        // fetchBlockingOrders : 2 .in() chaînés (slot_id, statut). On
        // n'a besoin de gérer que le terminal — chainable.
        if (state.mode === "select") {
          // 1er .in() retourne le builder pour le 2e .in()
          // 2e .in() → on continue avec order() puis await
          return b;
        }
      }
      return b;
    };
    b.order = (_col: string, _opts?: unknown) => {
      // chainable, sera awaited via .then
      return b;
    };
    b.maybeSingle = () => Promise.resolve(state.nextResp ?? { data: null, error: null });
    b.then = (onFulfilled: (r: SelectResp) => unknown) => {
      // Catch-all pour les awaits sans .maybeSingle (orders fetchBlocking).
      if (table === "orders") {
        return onFulfilled(ctrl.blockingOrders ?? { data: [], error: null });
      }
      return onFulfilled({ data: null, error: null });
    };
    return b;
  }

  const client = {
    from: (table: string) => {
      captured.fromCalls.push(table);
      return makeBuilder(table);
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

beforeEach(() => {
  vi.mocked(getSessionUser).mockReset();
  vi.mocked(createSupabaseAdminClient).mockReset();
});

function mockAuthAndProducer(client: SupabaseClient) {
  vi.mocked(getSessionUser).mockResolvedValue(SESSION as never);
  vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
}

// ─── excludeSlotAction ───────────────────────────────────────────────────

describe("excludeSlotAction — chantier annuler-et-fermer", () => {
  it("aucune commande active → success, excluded_at posé, pas de blocking_orders", async () => {
    const { client, captured } = buildClient({
      producerLookup: { data: { id: PRODUCER_ID }, error: null },
      slotLookup: { data: { id: "s1", producer_id: PRODUCER_ID }, error: null },
      blockingOrders: { data: [], error: null },
    });
    mockAuthAndProducer(client);

    const res = await excludeSlotAction("s1");
    expect(res).toEqual({ success: true });
    expect(captured.updates).toHaveLength(1);
    expect(captured.updates[0]!.table).toBe("slots");
    expect(captured.updates[0]!.payload).toHaveProperty("excluded_at");
  });

  it("avec 2 commandes pending → error + blocking_orders avec shape complète, aucun UPDATE", async () => {
    const blockingRows = [
      {
        id: "o1",
        code_commande: "ABC-001",
        montant_total: 28.5,
        consumer: { prenom: "Marie" },
        slot: { starts_at: "2026-05-30T08:00:00Z", ends_at: "2026-05-30T08:15:00Z" },
      },
      {
        id: "o2",
        code_commande: "ABC-002",
        montant_total: 45,
        consumer: { prenom: "Paul" },
        slot: { starts_at: "2026-05-30T08:30:00Z", ends_at: "2026-05-30T08:45:00Z" },
      },
    ];
    const { client, captured } = buildClient({
      producerLookup: { data: { id: PRODUCER_ID }, error: null },
      slotLookup: { data: { id: "s1", producer_id: PRODUCER_ID }, error: null },
      blockingOrders: { data: blockingRows, error: null },
    });
    mockAuthAndProducer(client);

    const res = await excludeSlotAction("s1");
    expect("success" in res).toBe(false);
    if ("error" in res) {
      expect(res.error).toMatch(/commande active/i);
      expect(res.blocking_orders).toBeDefined();
      const orders = res.blocking_orders as BlockingOrder[];
      expect(orders).toHaveLength(2);
      expect(orders[0]).toEqual({
        id: "o1",
        code_commande: "ABC-001",
        consumer_prenom: "Marie",
        montant_total: 28.5,
        slot_starts_at: "2026-05-30T08:00:00Z",
        slot_ends_at: "2026-05-30T08:15:00Z",
      });
      expect(orders[1]).toEqual({
        id: "o2",
        code_commande: "ABC-002",
        consumer_prenom: "Paul",
        montant_total: 45,
        slot_starts_at: "2026-05-30T08:30:00Z",
        slot_ends_at: "2026-05-30T08:45:00Z",
      });
    }
    // Aucun UPDATE slots déclenché.
    expect(captured.updates).toHaveLength(0);
  });

  it("ownership KO → error 'Créneau introuvable.', pas de blocking_orders", async () => {
    const { client } = buildClient({
      producerLookup: { data: { id: PRODUCER_ID }, error: null },
      slotLookup: { data: { id: "s1", producer_id: "other-prod" }, error: null },
    });
    mockAuthAndProducer(client);

    const res = await excludeSlotAction("s1");
    expect(res).toEqual({ error: "Créneau introuvable." });
  });

  it("non authentifié → error 'Non authentifié', aucun call DB", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    const res = await excludeSlotAction("s1");
    expect(res).toEqual({ error: "Non authentifié" });
  });
});

// ─── excludeSlotsByIdsAction ─────────────────────────────────────────────

describe("excludeSlotsByIdsAction — chantier annuler-et-fermer", () => {
  it("ouverture RDV 3 slots, 0 commande active → success + UPDATE batch", async () => {
    const { client, captured } = buildClient({
      producerLookup: { data: { id: PRODUCER_ID }, error: null },
      slotsBatchLookup: {
        data: [
          { id: "s1", producer_id: PRODUCER_ID },
          { id: "s2", producer_id: PRODUCER_ID },
          { id: "s3", producer_id: PRODUCER_ID },
        ],
        error: null,
      },
      blockingOrders: { data: [], error: null },
    });
    mockAuthAndProducer(client);

    const res = await excludeSlotsByIdsAction(["s1", "s2", "s3"]);
    expect(res).toEqual({ success: true });
    expect(captured.updates).toHaveLength(1);
  });

  it("orders sur 1 des 3 slots → error + blocking_orders listée, aucun UPDATE", async () => {
    const { client, captured } = buildClient({
      producerLookup: { data: { id: PRODUCER_ID }, error: null },
      slotsBatchLookup: {
        data: [
          { id: "s1", producer_id: PRODUCER_ID },
          { id: "s2", producer_id: PRODUCER_ID },
          { id: "s3", producer_id: PRODUCER_ID },
        ],
        error: null,
      },
      blockingOrders: {
        data: [
          {
            id: "o-mid",
            code_commande: "MID-001",
            montant_total: 12,
            consumer: { prenom: "Claire" },
            slot: { starts_at: "2026-05-30T09:00:00Z", ends_at: "2026-05-30T09:15:00Z" },
          },
        ],
        error: null,
      },
    });
    mockAuthAndProducer(client);

    const res = await excludeSlotsByIdsAction(["s1", "s2", "s3"]);
    expect("success" in res).toBe(false);
    if ("error" in res) {
      expect(res.error).toMatch(/commande active/i);
      const orders = res.blocking_orders as BlockingOrder[];
      expect(orders).toHaveLength(1);
      expect(orders[0]!.consumer_prenom).toBe("Claire");
    }
    expect(captured.updates).toHaveLength(0);
  });

  it("ownership partielle (1 slot d'un autre producteur) → error 'Créneau introuvable.' sans blocking_orders", async () => {
    const { client } = buildClient({
      producerLookup: { data: { id: PRODUCER_ID }, error: null },
      slotsBatchLookup: {
        data: [
          { id: "s1", producer_id: PRODUCER_ID },
          { id: "s2", producer_id: "other-prod" },
        ],
        error: null,
      },
    });
    mockAuthAndProducer(client);

    const res = await excludeSlotsByIdsAction(["s1", "s2"]);
    expect(res).toEqual({ error: "Créneau introuvable." });
  });

  it("liste vide → no-op success", async () => {
    const { client, captured } = buildClient({
      producerLookup: { data: { id: PRODUCER_ID }, error: null },
    });
    mockAuthAndProducer(client);

    const res = await excludeSlotsByIdsAction([]);
    expect(res).toEqual({ success: true });
    expect(captured.updates).toHaveLength(0);
  });
});
