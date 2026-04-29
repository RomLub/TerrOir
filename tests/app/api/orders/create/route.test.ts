// Vitest pour POST /api/orders/create.
// Couverture : auth (401), validation Zod (items vide / uuid invalide),
// pré-check slot (409 invalide), mapping SQLSTATE → HTTP via la RPC
// create_order_with_items (22023/P0002/23514/42501/inconnu), happy path
// avec vérification des params RPC (extractHeureRetrait, notes_client null,
// items.prix_unitaire forcé à 0), edges (RPC null silencieux 500, trim
// notes_client, SELECT post-RPC fail silencieux — comportement actuel à
// fixer T-427).
//
// Pattern aligné tests/app/api/orders/[id]/cancel/route.test.ts :
// builder Supabase chaînable multi-table avec queues séparées par opération.
// Extension : support .rpc() (pas dans cancel) avec capture + queue par nom.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Auth mock (closure variable) ----------------------------------------
type SessionUser = {
  id: string;
  email: string | null;
  roles: string[];
  isAdmin: boolean;
} | null;

let sessionUser: SessionUser;
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => sessionUser,
}));

// --- Supabase server client mock -----------------------------------------
// La route utilise createSupabaseServerClient (PAS admin) pour que la RPC
// SECURITY DEFINER puisse vérifier auth.uid() = p_consumer_id côté DB.
//
// Builder chaînable : from(table).select(cols).eq(col, val).maybeSingle()/single()
// Extension RPC : rpc(name, args) → consume responses.rpc[name] FIFO sinon
// défaut {data: null, error: null}.

type Resp = { data?: unknown; error?: unknown };
type Op = "select" | "pending";

type Captured = {
  fromCalls: string[];
  selects: Array<{ table: string; cols: string }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
  rpcCalls: Array<{ name: string; args: unknown }>;
};

let captured: Captured;
let responses: {
  slots?: { select?: Resp[] };
  orders?: { select?: Resp[] };
  rpc?: Record<string, Resp[]>;
};

function consumeFrom(table: "slots" | "orders", op: Op): Resp {
  if (op === "select") {
    const queue = responses[table]?.select;
    if (queue && queue.length > 0) return queue.shift()!;
  }
  return { data: null, error: null };
}

function consumeRpc(name: string): Resp {
  const queue = responses.rpc?.[name];
  if (queue && queue.length > 0) return queue.shift()!;
  return { data: null, error: null };
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    from: (table: string) => {
      captured.fromCalls.push(table);
      const t = table as "slots" | "orders";
      const builder: Record<string, unknown> & { _op: Op } = { _op: "pending" };
      builder.select = (cols: string) => {
        captured.selects.push({ table, cols });
        builder._op = "select";
        return builder;
      };
      builder.eq = (col: string, val: unknown) => {
        captured.eqCalls.push({ table, col, val });
        return builder;
      };
      builder.maybeSingle = () => Promise.resolve(consumeFrom(t, builder._op));
      builder.single = () => Promise.resolve(consumeFrom(t, builder._op));
      return builder;
    },
    rpc: (name: string, args: unknown) => {
      captured.rpcCalls.push({ name, args });
      return Promise.resolve(consumeRpc(name));
    },
  }),
}));

// --- Import APRÈS les mocks ----------------------------------------------

import { POST } from "@/app/api/orders/create/route";
import { extractHeureRetrait } from "@/lib/slots/format-slot-time";

// --- Helpers -------------------------------------------------------------

const CONSUMER_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCER_ID = "22222222-2222-4222-8222-222222222222";
const SLOT_ID = "33333333-3333-4333-8333-333333333333";
const PRODUCT_ID = "44444444-4444-4444-8444-444444444444";
const ORDER_ID = "55555555-5555-4555-8555-555555555555";

// ISO unambiguë : 2026-05-15 est en CEST (+02:00) → 07:30 UTC = 09:30 Paris.
// On laisse extractHeureRetrait calculer le résultat exact pour que le test
// reste robuste à toute évolution du helper (qui a ses propres tests dédiés).
const SLOT_STARTS_AT = "2026-05-15T07:30:00Z";
const EXPECTED_HEURE_RETRAIT = extractHeureRetrait(SLOT_STARTS_AT);

const VALID_BODY = {
  producer_id: PRODUCER_ID,
  slot_id: SLOT_ID,
  date_retrait: "2026-05-15",
  notes_client: "Pickup à 18h",
  items: [{ product_id: PRODUCT_ID, quantite: 2 }],
};

const DEFAULT_ORDER = {
  code_commande: "ABC-123",
  montant_total: 25.5,
  commission_terroir: 1.28,
  montant_net_producteur: 24.22,
};

function makeRequest(body: unknown = VALID_BODY): Request {
  return {
    json: async () => body,
  } as unknown as Request;
}

function pushSlotSelect(...resps: Resp[]) {
  responses.slots = responses.slots ?? {};
  responses.slots.select = [...(responses.slots.select ?? []), ...resps];
}

function pushOrderSelect(...resps: Resp[]) {
  responses.orders = responses.orders ?? {};
  responses.orders.select = [...(responses.orders.select ?? []), ...resps];
}

function pushRpc(name: string, ...resps: Resp[]) {
  responses.rpc = responses.rpc ?? {};
  responses.rpc[name] = [...(responses.rpc[name] ?? []), ...resps];
}

// --- Setup / teardown ----------------------------------------------------

beforeEach(() => {
  captured = { fromCalls: [], selects: [], eqCalls: [], rpcCalls: [] };
  responses = {};
  sessionUser = {
    id: CONSUMER_ID,
    email: "consumer@example.com",
    roles: ["consumer"],
    isAdmin: false,
  };
  // Defaults flow nominal : slot existe, RPC retourne ORDER_ID, post-fetch OK.
  pushSlotSelect({ data: { starts_at: SLOT_STARTS_AT }, error: null });
  pushRpc("create_order_with_items", { data: ORDER_ID, error: null });
  pushOrderSelect({ data: DEFAULT_ORDER, error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- A. Auth -------------------------------------------------------------

describe("A. Auth", () => {
  it("A1 — pas de session → 401, aucun I/O", async () => {
    sessionUser = null;
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(captured.fromCalls).toEqual([]);
    expect(captured.rpcCalls).toEqual([]);
  });
});

// --- B. Validation Zod ---------------------------------------------------

describe("B. Validation Zod", () => {
  it("B1 — items vide → 400, aucun I/O", async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, items: [] }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
    expect(captured.fromCalls).toEqual([]);
    expect(captured.rpcCalls).toEqual([]);
  });

  it("B2 — producer_id non-uuid → 400, aucun I/O", async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, producer_id: "not-a-uuid" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
    expect(captured.fromCalls).toEqual([]);
    expect(captured.rpcCalls).toEqual([]);
  });
});

// --- C. Pré-check slot ---------------------------------------------------

describe("C. Pré-check slot", () => {
  it("C1 — slot inexistant → 409 'Créneau invalide', RPC non appelée", async () => {
    responses.slots = { select: [{ data: null, error: null }] };
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Créneau invalide ou indisponible",
    });
    expect(captured.rpcCalls).toEqual([]);
    // Le SELECT slot est filtré sur le slot_id passé.
    const slotEq = captured.eqCalls.find((e) => e.table === "slots");
    expect(slotEq).toEqual({ table: "slots", col: "id", val: SLOT_ID });
  });
});

// --- D. SQLSTATE → HTTP mapping ------------------------------------------

describe("D. SQLSTATE → HTTP mapping", () => {
  it("D1 — RPC error 22023 (invalid_parameter_value) → 400 + code dans body", async () => {
    responses.rpc = {
      create_order_with_items: [
        { data: null, error: { message: "items must be a non-empty array", code: "22023" } },
      ],
    };
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "items must be a non-empty array",
      code: "22023",
    });
  });

  it("D2 — RPC error P0002 (no_data_found) → 404", async () => {
    responses.rpc = {
      create_order_with_items: [
        { data: null, error: { message: "Produit introuvable", code: "P0002" } },
      ],
    };
    const res = await POST(makeRequest());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "Produit introuvable",
      code: "P0002",
    });
  });

  it("D3 — RPC error 23514 (stock insuffisant) → 409", async () => {
    responses.rpc = {
      create_order_with_items: [
        { data: null, error: { message: "Stock insuffisant pour XYZ", code: "23514" } },
      ],
    };
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Stock insuffisant pour XYZ",
      code: "23514",
    });
  });

  it("D4 — RPC error 42501 (consumer mismatch ou produit inactif) → 403", async () => {
    responses.rpc = {
      create_order_with_items: [
        { data: null, error: { message: "Consumer mismatch with auth.uid()", code: "42501" } },
      ],
    };
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Consumer mismatch with auth.uid()",
      code: "42501",
    });
  });

  it("D5 — RPC error code inconnu → 500", async () => {
    responses.rpc = {
      create_order_with_items: [
        { data: null, error: { message: "Unexpected DB failure", code: "99999" } },
      ],
    };
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Unexpected DB failure",
      code: "99999",
    });
  });
});

// --- E. Happy path -------------------------------------------------------

describe("E. Happy path", () => {
  it("E1 — RPC succès → 200 + RPC appelée avec params extraits côté serveur", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      order_id: ORDER_ID,
      code_commande: "ABC-123",
      montant_total: 25.5,
      commission: 1.28,
      montant_net: 24.22,
    });

    expect(captured.rpcCalls).toHaveLength(1);
    const rpcCall = captured.rpcCalls[0]!;
    expect(rpcCall.name).toBe("create_order_with_items");
    expect(rpcCall.args).toEqual({
      p_consumer_id: CONSUMER_ID, // session.id, PAS body.consumer_id (non envoyé)
      p_producer_id: PRODUCER_ID,
      p_slot_id: SLOT_ID,
      p_date_retrait: "2026-05-15",
      // heure_retrait extraite côté serveur depuis slot.starts_at, autoritatif
      p_heure_retrait: EXPECTED_HEURE_RETRAIT,
      p_notes_client: "Pickup à 18h",
      p_items: [
        // prix_unitaire forcé à 0 — la RPC l'ignore et refacture au prix DB.
        { product_id: PRODUCT_ID, quantite: 2, prix_unitaire: 0 },
      ],
    });

    // Pré-check slot + post-fetch order : 2 SELECTs au total.
    expect(captured.fromCalls).toEqual(["slots", "orders"]);
    expect(
      captured.eqCalls.find((e) => e.table === "orders" && e.col === "id"),
    ).toEqual({ table: "orders", col: "id", val: ORDER_ID });
  });
});

// --- F. Edge cases -------------------------------------------------------

describe("F. Edge cases", () => {
  it("F1 — RPC data null + error null → 500 'RPC returned no order_id'", async () => {
    responses.rpc = {
      create_order_with_items: [{ data: null, error: null }],
    };
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "RPC returned no order_id" });
    // Pas de fetch post-RPC quand l'order_id est absent.
    expect(captured.fromCalls).toEqual(["slots"]);
  });

  it("F2 — notes_client trimmé par Zod avant passage à la RPC", async () => {
    await POST(
      makeRequest({ ...VALID_BODY, notes_client: "  Notes avec espaces  " }),
    );
    const rpcArgs = captured.rpcCalls[0]!.args as Record<string, unknown>;
    expect(rpcArgs.p_notes_client).toBe("Notes avec espaces");
  });

  it("F3 — SELECT post-RPC fail silencieux → 200 + code_commande absent (T-427 documenté)", async () => {
    // Override : le post-fetch orders renvoie data null sans error → la
    // route ne check pas error et continue avec order = null.
    responses.orders = { select: [{ data: null, error: null }] };
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.order_id).toBe(ORDER_ID);
    // NextResponse.json strip les undefined → les clés enrichies disparaissent.
    expect("code_commande" in body).toBe(false);
    expect("montant_total" in body).toBe(false);
    expect("commission" in body).toBe(false);
    expect("montant_net" in body).toBe(false);
  });
});
