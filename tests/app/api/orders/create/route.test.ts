// Vitest pour POST /api/orders/create.
// Couverture : auth (401), validation Zod (items vide / uuid invalide),
// pré-check slot (409 invalide), idempotence dedup pré-RPC (T-428 fenêtre
// 5 min), mapping SQLSTATE → HTTP via la RPC create_order_with_items
// (22023/P0002/23514/42501/inconnu), happy path avec vérification des
// params RPC (extractHeureRetrait, notes_client null, items.prix_unitaire
// forcé à 0), edges (RPC null silencieux 500, trim notes_client, SELECT
// post-RPC fail silencieux — comportement actuel à fixer T-427).
//
// Pattern aligné tests/app/api/orders/[id]/cancel/route.test.ts :
// builder Supabase chaînable multi-table avec queues séparées par opération.
// Extension : support .rpc() (pas dans cancel) avec capture + queue par nom.
// Extension T-428 : support .gt() + .limit() chainables pour le SELECT
// dedup pré-RPC (consumer_id + slot_id + date_retrait + statut + cutoff).

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
type Op = "select" | "update" | "pending";

type Captured = {
  fromCalls: string[];
  selects: Array<{ table: string; cols: string }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
  gtCalls: Array<{ table: string; col: string; val: unknown }>;
  limitCalls: Array<{ table: string; n: number }>;
  updateCalls: Array<{ table: string; payload: Record<string, unknown> }>;
  rpcCalls: Array<{ name: string; args: unknown }>;
};

let captured: Captured;
let responses: {
  slots?: { select?: Resp[]; update?: Resp[] };
  orders?: { select?: Resp[]; update?: Resp[] };
  rpc?: Record<string, Resp[]>;
};

function consumeFrom(table: "slots" | "orders", op: Op): Resp {
  if (op === "select") {
    const queue = responses[table]?.select;
    if (queue && queue.length > 0) return queue.shift()!;
  }
  if (op === "update") {
    const queue = responses[table]?.update;
    if (queue && queue.length > 0) return queue.shift()!;
  }
  return { data: null, error: null };
}

function consumeRpc(name: string): Resp {
  const queue = responses.rpc?.[name];
  if (queue && queue.length > 0) return queue.shift()!;
  if (name === "is_product_available_on_slot") {
    return { data: true, error: null };
  }
  return { data: null, error: null };
}

// Builder partagé entre createSupabaseServerClient (RPC + SELECT post-RPC)
// et createSupabaseAdminClient (UPDATE CGV F-001 P0-TA bascule). Les capture
// sont mutualisés pour préserver les assertions existantes.
function buildSupabaseClient() {
  return {
    from: (table: string) => {
      captured.fromCalls.push(table);
      const t = table as "slots" | "orders";
      const builder: Record<string, unknown> & { _op: Op } = { _op: "pending" };
      builder.select = (cols: string) => {
        captured.selects.push({ table, cols });
        builder._op = "select";
        return builder;
      };
      builder.update = (payload: Record<string, unknown>) => {
        captured.updateCalls.push({ table, payload });
        builder._op = "update";
        return builder;
      };
      builder.eq = (col: string, val: unknown) => {
        captured.eqCalls.push({ table, col, val });
        return builder;
      };
      builder.gt = (col: string, val: unknown) => {
        captured.gtCalls.push({ table, col, val });
        return builder;
      };
      builder.limit = (n: number) => {
        captured.limitCalls.push({ table, n });
        return builder;
      };
      builder.maybeSingle = () => Promise.resolve(consumeFrom(t, builder._op));
      builder.single = () => Promise.resolve(consumeFrom(t, builder._op));
      builder.then = (resolve: (r: Resp) => unknown) => {
        return Promise.resolve(consumeFrom(t, builder._op)).then(resolve);
      };
      return builder;
    },
    rpc: (name: string, args: unknown) => {
      captured.rpcCalls.push({ name, args });
      return Promise.resolve(consumeRpc(name));
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => buildSupabaseClient(),
}));

// F-001 P0-TA : la route bascule sur admin client pour l'UPDATE CGV
// (la policy "orders parties update" est retirée → user-context retourne
// 0 rows). Mock symétrique au server client pour préserver les capture.
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => buildSupabaseClient(),
}));

// --- Audit log mock (T-429) ---------------------------------------------
// Le helper logPaymentEvent est fail-safe interne (try/catch swallow).
// On le mocke pour vérifier l'instrumentation T-429 sans dépendance DB
// (cohérent pattern tests/lib/stripe/handle-payment-failed.test.ts:18-20).
vi.mock("@/lib/audit-logs/log-payment-event", () => ({
  logPaymentEvent: vi.fn(),
}));

// F-034 : rate-limit mock — par défaut success=true (pas de throttle).
// logAuthEvent mocké pour assertion rate_limit_exceeded.
const consumeRateLimitMock = vi.fn();
const logAuthEventMock = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: (...args: unknown[]) => consumeRateLimitMock(...args),
  getOrdersCreateRateLimit: () => ({}),
}));
vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: (...args: unknown[]) => logAuthEventMock(...args),
}));

// --- Import APRÈS les mocks ----------------------------------------------

import { POST } from "@/app/api/orders/create/route";
import {
  extractDateRetrait,
  extractHeureRetrait,
} from "@/lib/slots/format-slot-time";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";

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
const EXPECTED_DATE_RETRAIT = extractDateRetrait(SLOT_STARTS_AT);
const EXPECTED_HEURE_RETRAIT = extractHeureRetrait(SLOT_STARTS_AT);

const VALID_BODY = {
  producer_id: PRODUCER_ID,
  slot_id: SLOT_ID,
  date_retrait: "2026-05-15",
  notes_client: "Pickup à 18h",
  items: [{ product_id: PRODUCT_ID, quantite: 2 }],
  cgv_accepted: true,
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

function pushOrderUpdate(...resps: Resp[]) {
  responses.orders = responses.orders ?? {};
  responses.orders.update = [...(responses.orders.update ?? []), ...resps];
}

function pushRpc(name: string, ...resps: Resp[]) {
  responses.rpc = responses.rpc ?? {};
  responses.rpc[name] = [...(responses.rpc[name] ?? []), ...resps];
}

// --- Setup / teardown ----------------------------------------------------

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = {
    fromCalls: [],
    selects: [],
    eqCalls: [],
    gtCalls: [],
    limitCalls: [],
    updateCalls: [],
    rpcCalls: [],
  };
  responses = {};
  sessionUser = {
    id: CONSUMER_ID,
    email: "consumer@example.com",
    roles: ["consumer"],
    isAdmin: false,
  };
  // Defaults flow nominal : slot existe, dedup T-428 miss (pas d'order
  // pending récente), RPC retourne ORDER_ID, UPDATE CGV OK, post-fetch
  // enrich OK.
  pushSlotSelect({ data: { starts_at: SLOT_STARTS_AT }, error: null });
  pushOrderSelect(
    // 1er consume : dedup pré-RPC T-428 → miss (pas d'order existante)
    { data: null, error: null },
    // 2ème consume : enrich post-RPC → DEFAULT_ORDER
    { data: DEFAULT_ORDER, error: null },
  );
  // UPDATE post-RPC pour persister cgv_accepted_at + cgv_version (no-op
  // success par défaut, surchargeable pour tests d'erreur).
  pushOrderUpdate({ data: null, error: null });
  pushRpc("create_order_with_items", { data: ORDER_ID, error: null });
  // T-429 : reset le compteur d'appels audit log entre chaque test.
  vi.mocked(logPaymentEvent).mockClear();
  // F-034 : reset + default rate-limit success.
  consumeRateLimitMock.mockReset();
  consumeRateLimitMock.mockResolvedValue({
    success: true,
    limit: 10,
    remaining: 9,
    reset: Date.now() + 60_000,
  });
  logAuthEventMock.mockReset();
  logAuthEventMock.mockResolvedValue(undefined);
  // T-427 : spy console.warn pour assert log greppable [ORDER_CREATE_ENRICH_FAIL]
  // sur paths SELECT post-RPC fail (cf F3 enrichi + F4 nouveau).
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  consoleWarnSpy.mockRestore();
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

  it("B3 — cgv_accepted manquant → 400, aucun I/O", async () => {
    // Body sans cgv_accepted (cas client trafiqué supprimant le champ).
    const { cgv_accepted: _, ...bodyWithoutCgv } = VALID_BODY;
    const res = await POST(makeRequest(bodyWithoutCgv));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/conditions générales de vente/i);
    expect(captured.fromCalls).toEqual([]);
    expect(captured.rpcCalls).toEqual([]);
  });

  it("B4 — cgv_accepted=false → 400, aucun I/O", async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, cgv_accepted: false }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/conditions générales de vente/i);
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

// --- C2. Pre-check disponibilite produit-creneau -------------------------

describe("C2. Pre-check disponibilite produit-creneau", () => {
  it("C2.1 - produit incompatible avec le creneau choisi -> 409 avant creation", async () => {
    responses.rpc = {
      is_product_available_on_slot: [{ data: false, error: null }],
    };

    const res = await POST(makeRequest());

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: expect.stringMatching(/Aucun .* commun/i),
      code: "23514",
      hint: "product_slot_unavailable",
      details: `product_id=${PRODUCT_ID};slot_id=${SLOT_ID}`,
    });
    expect(captured.rpcCalls.map((call) => call.name)).toEqual([
      "is_product_available_on_slot",
    ]);
    expect(logPaymentEvent).not.toHaveBeenCalled();
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
    // T-429 : path erreur RPC → audit_log non posé (mutations DB seulement).
    expect(logPaymentEvent).not.toHaveBeenCalled();
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
    expect(logPaymentEvent).not.toHaveBeenCalled();
  });

  it("D3 — RPC error 23514 hint='stock_depleted' → 409 + message UX + hint + details (T-434)", async () => {
    responses.rpc = {
      create_order_with_items: [
        {
          data: null,
          error: {
            message: "Stock insuffisant pour XYZ",
            code: "23514",
            hint: "stock_depleted",
            details: "product_id=xyz-uuid",
          },
        },
      ],
    };
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error:
        "Un produit de votre panier n'est plus disponible. Ajustez votre panier.",
      code: "23514",
      hint: "stock_depleted",
      details: "product_id=xyz-uuid",
    });
    expect(logPaymentEvent).not.toHaveBeenCalled();
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
    expect(logPaymentEvent).not.toHaveBeenCalled();
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
    expect(logPaymentEvent).not.toHaveBeenCalled();
  });

  it("D6 — RPC error 23514 hint='slot_invalid' → 409 + message UX (T-434)", async () => {
    responses.rpc = {
      create_order_with_items: [
        {
          data: null,
          error: {
            message: "Slot abc invalide pour ce producteur",
            code: "23514",
            hint: "slot_invalid",
            details: "slot_id=abc-uuid",
          },
        },
      ],
    };
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Ce créneau n'est plus disponible. Choisissez un autre créneau.",
      code: "23514",
      hint: "slot_invalid",
      details: "slot_id=abc-uuid",
    });
    expect(logPaymentEvent).not.toHaveBeenCalled();
  });

  it("D7 — RPC error 23514 hint='slot_full' → 409 + message UX + details capacity/taken (T-434)", async () => {
    responses.rpc = {
      create_order_with_items: [
        {
          data: null,
          error: {
            message: "Slot abc complet : 3 / 3 réservations actives",
            code: "23514",
            hint: "slot_full",
            details: "slot_id=abc-uuid;capacity=3;taken=3",
          },
        },
      ],
    };
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Ce créneau de retrait est complet. Choisissez un autre créneau.",
      code: "23514",
      hint: "slot_full",
      details: "slot_id=abc-uuid;capacity=3;taken=3",
    });
    expect(logPaymentEvent).not.toHaveBeenCalled();
  });

  it("D8 — RPC error 23514 hint='product_producer_mismatch' → 409 + message générique (T-434, anomalie technique)", async () => {
    responses.rpc = {
      create_order_with_items: [
        {
          data: null,
          error: {
            message: "Produit xyz appartient à un autre producteur",
            code: "23514",
            hint: "product_producer_mismatch",
            details: "product_id=xyz-uuid",
          },
        },
      ],
    };
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Erreur technique. Contactez le support.",
      code: "23514",
      hint: "product_producer_mismatch",
      details: "product_id=xyz-uuid",
    });
    expect(logPaymentEvent).not.toHaveBeenCalled();
  });

  it("D9 — RPC error 23514 sans hint (legacy / migration pas appliquée) → 409 + fallback message brut (T-434)", async () => {
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
    expect(logPaymentEvent).not.toHaveBeenCalled();
  });

  it("D10 — RPC error P0001 (auto-purchase guard) → 403 + message brut (T-442 + T-448 wording UX)", async () => {
    responses.rpc = {
      create_order_with_items: [
        {
          data: null,
          error: {
            message: "Vous ne pouvez pas commander vos propres produits.",
            code: "P0001",
          },
        },
      ],
    };
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Vous ne pouvez pas commander vos propres produits.",
      code: "P0001",
    });
    expect(logPaymentEvent).not.toHaveBeenCalled();
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

    expect(captured.rpcCalls.map((call) => call.name)).toEqual([
      "is_product_available_on_slot",
      "create_order_with_items",
    ]);
    const rpcCall = captured.rpcCalls.find(
      (call) => call.name === "create_order_with_items",
    )!;
    expect(rpcCall.name).toBe("create_order_with_items");
    expect(rpcCall.args).toEqual({
      p_consumer_id: CONSUMER_ID, // session.id, PAS body.consumer_id (non envoyé)
      p_producer_id: PRODUCER_ID,
      p_slot_id: SLOT_ID,
      p_date_retrait: EXPECTED_DATE_RETRAIT,
      // heure_retrait extraite côté serveur depuis slot.starts_at, autoritatif
      p_heure_retrait: EXPECTED_HEURE_RETRAIT,
      p_notes_client: "Pickup à 18h",
      p_items: [
        // prix_unitaire forcé à 0 — la RPC l'ignore et refacture au prix DB.
        { product_id: PRODUCT_ID, quantite: 2, prix_unitaire: 0 },
      ],
    });

    // Pré-check slot + dedup T-428 (orders) + UPDATE CGV (orders) + post-fetch
    // enrich (orders) : 1 select slots + 3 from orders.
    expect(captured.fromCalls).toEqual(["slots", "orders", "orders", "orders"]);
    expect(
      captured.eqCalls.find((e) => e.table === "orders" && e.col === "id"),
    ).toEqual({ table: "orders", col: "id", val: ORDER_ID });

    // CGV : UPDATE post-RPC pose cgv_accepted_at + cgv_version.
    expect(captured.updateCalls).toHaveLength(1);
    const cgvUpdate = captured.updateCalls[0]!;
    expect(cgvUpdate.table).toBe("orders");
    expect(cgvUpdate.payload).toEqual({
      cgv_accepted_at: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      ),
      cgv_version: "1.0",
    });

    // T-429 : audit_log forensique posé après SELECT enrich, avant ack
    // HTTP. userId = session.id (consumer), metadata aligne 8 champs DB.
    expect(logPaymentEvent).toHaveBeenCalledTimes(1);
    expect(logPaymentEvent).toHaveBeenCalledWith({
      eventType: "order_created",
      userId: CONSUMER_ID,
      metadata: {
        order_id: ORDER_ID,
        producer_id: PRODUCER_ID,
        slot_id: SLOT_ID,
        date_retrait: EXPECTED_DATE_RETRAIT,
        montant_total: 25.5,
        commission: 1.28,
        montant_net: 24.22,
        items_count: 1,
      },
    });
  });
});

  it("E2 - ignore une date client incoherente et utilise la date du creneau", async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, date_retrait: "2026-05-16" }),
    );

    expect(res.status).toBe(200);
    const rpcCall = captured.rpcCalls.find(
      (call) => call.name === "create_order_with_items",
    )!;
    expect((rpcCall.args as Record<string, unknown>).p_date_retrait).toBe(
      EXPECTED_DATE_RETRAIT,
    );
    expect(
      captured.eqCalls.find(
        (e) => e.table === "orders" && e.col === "date_retrait",
      ),
    ).toEqual({
      table: "orders",
      col: "date_retrait",
      val: EXPECTED_DATE_RETRAIT,
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
    // Pré-check slot + dedup T-428 (miss) ; pas de fetch enrich quand
    // l'order_id RPC est absent (early return avant SELECT enrich).
    expect(captured.fromCalls).toEqual(["slots", "orders"]);
    // T-429 : RPC sans order_id → audit_log non posé (pas de mutation
    // DB confirmée, return early avant logPaymentEvent).
    expect(logPaymentEvent).not.toHaveBeenCalled();
  });

  it("F2 — notes_client trimmé par Zod avant passage à la RPC", async () => {
    await POST(
      makeRequest({ ...VALID_BODY, notes_client: "  Notes avec espaces  " }),
    );
    const rpcArgs = captured.rpcCalls.find(
      (call) => call.name === "create_order_with_items",
    )!.args as Record<string, unknown>;
    expect(rpcArgs.p_notes_client).toBe("Notes avec espaces");
  });

  it("F3 — SELECT post-RPC fail silencieux → 200 + warn log + body minimal (T-427 résolu)", async () => {
    // Override : le post-fetch orders renvoie data null sans error
    // (cas race : row supprimé entre RPC commit et SELECT). T-427
    // post-fix : le try/catch log warn même quand error est null si
    // data est aussi null (cohérence forensique).
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

    // T-427 : assertion log greppable [ORDER_CREATE_ENRICH_FAIL] (cas
    // race "row not found" — error null + data null).
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[ORDER_CREATE_ENRICH_FAIL\] order_id=.+ error=row not found$/,
      ),
    );

    // T-429 : audit_log posé MÊME si SELECT post-RPC échoue. Fallback
    // ?? null sur les 3 montants. order_id reste défini car retourné
    // par la RPC, pas par le SELECT.
    expect(logPaymentEvent).toHaveBeenCalledTimes(1);
    expect(logPaymentEvent).toHaveBeenCalledWith({
      eventType: "order_created",
      userId: CONSUMER_ID,
      metadata: {
        order_id: ORDER_ID,
        producer_id: PRODUCER_ID,
        slot_id: SLOT_ID,
        date_retrait: EXPECTED_DATE_RETRAIT,
        montant_total: null,
        commission: null,
        montant_net: null,
        items_count: 1,
      },
    });
  });

  it("F4 — SELECT post-RPC error non-null (RLS bug / lock_timeout) → 200 + warn log + body minimal + audit log posé (T-427)", async () => {
    // Override : le 1er SELECT (dedup T-428) miss propre, le 2ème
    // SELECT (enrich post-RPC) retourne une error non-null. T-427 :
    // try/catch capture, log warn forensique, fallback graceful order=null,
    // audit log T-429 posé quand même (mutation DB de la RPC effective).
    responses.orders = {
      select: [
        // 1er consume : dedup pré-RPC T-428 → miss
        { data: null, error: null },
        // 2ème consume : enrich post-RPC → error RLS (cas dominant prod)
        {
          data: null,
          error: {
            message: "new row violates row-level security policy",
            code: "42501",
          },
        },
      ],
    };
    const res = await POST(makeRequest());

    // Body minimal { order_id } — sémantique préservée (path SELECT-fail
    // = body partiel, asymétrie acceptable vs T-428 dedup hit complet).
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.order_id).toBe(ORDER_ID);
    expect("code_commande" in body).toBe(false);
    expect("montant_total" in body).toBe(false);

    // T-427 : log greppable forensique avec message error Supabase préservé.
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[ORDER_CREATE_ENRICH_FAIL\] order_id=.+ error=new row violates row-level security policy$/,
      ),
    );

    // T-429 : audit log posé même sur error SELECT (mutation DB effective
    // post-RPC), metadata partielle (montants null) acceptable.
    expect(logPaymentEvent).toHaveBeenCalledTimes(1);
    expect(logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "order_created",
        userId: CONSUMER_ID,
        metadata: expect.objectContaining({
          order_id: ORDER_ID,
          montant_total: null,
          commission: null,
          montant_net: null,
        }),
      }),
    );
  });
});

// --- G. Idempotence T-428 (dedup pre-RPC) -------------------------------

describe("G. Idempotence T-428 (dedup pre-RPC)", () => {
  const EXISTING_ORDER_ID = "66666666-6666-4666-8666-666666666666";
  const EXISTING_ORDER = {
    id: EXISTING_ORDER_ID,
    code_commande: "EXIST-007",
    montant_total: 18.4,
    commission_terroir: 1.1,
    montant_net_producteur: 17.3,
  };

  it("G1 — order pending existe < 5min même consumer/slot/date → return existante, RPC non appelée, pas de double audit log", async () => {
    // Override : 1er consume = dedup hit (existing order), 2ème consume
    // ne sera pas atteint (early return avant RPC + enrich).
    responses.orders = { select: [{ data: EXISTING_ORDER, error: null }] };

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      order_id: EXISTING_ORDER_ID,
      code_commande: "EXIST-007",
      montant_total: 18.4,
      commission: 1.1,
      montant_net: 17.3,
    });
    // La compatibilite produit-creneau est verifiee avant la dedup ; la
    // creation de commande reste court-circuitee.
    expect(captured.rpcCalls.map((call) => call.name)).toEqual([
      "is_product_available_on_slot",
    ]);
    // Pas de duplication audit log (1ère création a déjà loggé via T-429).
    expect(logPaymentEvent).not.toHaveBeenCalled();
    // Vérifier que les 4 filtres dedup sont posés sur la query orders.
    const ordersEqs = captured.eqCalls.filter((e) => e.table === "orders");
    expect(ordersEqs).toEqual(
      expect.arrayContaining([
        { table: "orders", col: "consumer_id", val: CONSUMER_ID },
        { table: "orders", col: "slot_id", val: SLOT_ID },
        { table: "orders", col: "date_retrait", val: EXPECTED_DATE_RETRAIT },
        { table: "orders", col: "statut", val: "pending" },
      ]),
    );
    // Vérifier la fenêtre temporelle : .gt('created_at', cutoff ISO).
    expect(captured.gtCalls).toEqual([
      {
        table: "orders",
        col: "created_at",
        val: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      },
    ]);
    // Vérifier .limit(1) pour bornage perf.
    expect(captured.limitCalls).toEqual([{ table: "orders", n: 1 }]);
  });

  it("G2 — dedup miss (pas d'order pending récente) → RPC appelée nominal", async () => {
    // Default beforeEach : 1er consume orders = dedup miss → RPC nominal.
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(captured.rpcCalls.map((call) => call.name)).toEqual([
      "is_product_available_on_slot",
      "create_order_with_items",
    ]);
    expect(logPaymentEvent).toHaveBeenCalledTimes(1);
    // 4 from au total : slots (pré-check) + orders (dedup miss) + orders
    // (UPDATE CGV) + orders (enrich post-RPC).
    expect(captured.fromCalls).toEqual(["slots", "orders", "orders", "orders"]);
  });

  it("G3 — dedup query : cutoff ISO = now() - 5min (fenêtre temporelle)", async () => {
    const before = Date.now();
    await POST(makeRequest());
    const after = Date.now();

    expect(captured.gtCalls).toHaveLength(1);
    const cutoffIso = captured.gtCalls[0]!.val as string;
    const cutoffMs = new Date(cutoffIso).getTime();
    const FIVE_MIN_MS = 5 * 60 * 1000;
    // Le cutoff doit être dans la fenêtre [before - 5min, after - 5min].
    expect(cutoffMs).toBeGreaterThanOrEqual(before - FIVE_MIN_MS - 10);
    expect(cutoffMs).toBeLessThanOrEqual(after - FIVE_MIN_MS + 10);
  });

  it("G4 — dedup hit n'appelle ni la RPC ni le SELECT enrich post-RPC", async () => {
    responses.orders = { select: [{ data: EXISTING_ORDER, error: null }] };

    await POST(makeRequest());

    // Pas de RPC de creation, pas de 2ème SELECT orders (enrich).
    expect(captured.fromCalls).toEqual(["slots", "orders"]);
    expect(captured.rpcCalls.map((call) => call.name)).toEqual([
      "is_product_available_on_slot",
    ]);
  });

  it("G5 — dedup query : .select() inclut les 5 colonnes nécessaires au shape de réponse", async () => {
    responses.orders = { select: [{ data: EXISTING_ORDER, error: null }] };

    await POST(makeRequest());

    // Le 1er .select() sur orders est le dedup pré-RPC.
    const ordersSelects = captured.selects.filter((s) => s.table === "orders");
    expect(ordersSelects.length).toBeGreaterThanOrEqual(1);
    const dedupCols = ordersSelects[0]!.cols;
    // 5 colonnes : id + 4 enrich cohérent shape réponse path nominal.
    expect(dedupCols).toContain("id");
    expect(dedupCols).toContain("code_commande");
    expect(dedupCols).toContain("montant_total");
    expect(dedupCols).toContain("commission_terroir");
    expect(dedupCols).toContain("montant_net_producteur");
  });

  it("G6 — order pending existe mais query rend null (autre consumer / slot / date / statut / hors fenêtre) → RPC nominal", async () => {
    // Toutes les variantes "miss" produisent le même résultat côté Supabase :
    // .maybeSingle() retourne { data: null, error: null }. Le default beforeEach
    // simule déjà ce cas (1er consume = null). On vérifie le path nominal.
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { order_id: string };
    expect(body.order_id).toBe(ORDER_ID); // nouvelle order créée par la RPC
    expect(captured.rpcCalls.map((call) => call.name)).toEqual([
      "is_product_available_on_slot",
      "create_order_with_items",
    ]);
    // Audit log T-429 posé (path nominal, pas dedup hit).
    expect(logPaymentEvent).toHaveBeenCalledTimes(1);
  });
});

// --- H. CGV persistance (UPDATE post-RPC) -------------------------------

describe("H. CGV persistance", () => {
  it("H1 — UPDATE post-RPC échoue (RLS / lock) → 200, log warn forensique, flow non cassé", async () => {
    // Override : UPDATE CGV retourne une error. Le flow doit continuer
    // (l'order est déjà créée via RPC, l'user doit pouvoir payer).
    responses.orders = {
      select: [
        { data: null, error: null }, // dedup miss
        { data: DEFAULT_ORDER, error: null }, // enrich
      ],
      update: [
        {
          data: null,
          error: { message: "row-level security policy violation" },
        },
      ],
    };

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[ORDER_CGV_PERSIST_FAIL\] order_id=.+ error=row-level security policy violation$/,
      ),
    );
    // Audit log T-429 posé (mutation principale RPC effective).
    expect(logPaymentEvent).toHaveBeenCalledTimes(1);
  });

  it("H2 — UPDATE CGV pose les bonnes valeurs (eq sur order_id RPC + payload version + timestamp)", async () => {
    await POST(makeRequest());

    expect(captured.updateCalls).toHaveLength(1);
    const cgvUpdate = captured.updateCalls[0]!;
    expect(cgvUpdate.table).toBe("orders");
    expect(cgvUpdate.payload.cgv_version).toBe("1.0");
    expect(cgvUpdate.payload.cgv_accepted_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );

    // Le UPDATE est filtré sur l'order_id retourné par la RPC.
    const updateEqs = captured.eqCalls.filter(
      (e) => e.table === "orders" && e.col === "id" && e.val === ORDER_ID,
    );
    expect(updateEqs.length).toBeGreaterThanOrEqual(1);
  });

  it("H3 — RPC échoue → pas d'UPDATE CGV (early return avant)", async () => {
    responses.rpc = {
      create_order_with_items: [
        { data: null, error: { message: "RPC fail", code: "23514" } },
      ],
    };

    await POST(makeRequest());

    expect(captured.updateCalls).toEqual([]);
  });

  it("H4 — dedup hit → pas d'UPDATE CGV (path court-circuit)", async () => {
    const EXISTING = {
      id: "66666666-6666-4666-8666-666666666666",
      code_commande: "EXIST-007",
      montant_total: 18.4,
      commission_terroir: 1.1,
      montant_net_producteur: 17.3,
    };
    responses.orders = { select: [{ data: EXISTING, error: null }] };

    await POST(makeRequest());

    // Dedup hit : la 1ère création a déjà persisté la CGV. Pas de
    // re-UPDATE sur ce path (idempotent : décision YAGNI, edge case
    // double-clic 5 min).
    expect(captured.updateCalls).toEqual([]);
  });
});

// --- I. Rate-limit F-034 ------------------------------------------------

describe("I. Rate-limit F-034", () => {
  it("I1 — rate-limit miss → 429 + Retry-After + audit rate_limit_exceeded, aucun I/O DB", async () => {
    consumeRateLimitMock.mockResolvedValue({
      success: false,
      limit: 10,
      remaining: 0,
      reset: Date.now() + 30_000,
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    const body = (await res.json()) as { error: string; retry_after: number };
    expect(body.error).toBe("rate_limited");
    expect(body.retry_after).toBeGreaterThan(0);

    // Audit log forensique.
    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "rate_limit_exceeded",
      userId: CONSUMER_ID,
      metadata: expect.objectContaining({
        route: "orders_create",
        cap: 10,
      }),
    });
    // Aucun I/O DB (court-circuit avant SELECT slots et RPC).
    expect(captured.fromCalls).toEqual([]);
    expect(captured.rpcCalls).toEqual([]);
    expect(logPaymentEvent).not.toHaveBeenCalled();
  });

  it("I2 — 11 calls successifs : 10 OK, 11e rate-limited", async () => {
    let callIndex = 0;
    consumeRateLimitMock.mockImplementation(() => {
      callIndex += 1;
      if (callIndex <= 10) {
        return Promise.resolve({
          success: true,
          limit: 10,
          remaining: 10 - callIndex,
          reset: Date.now() + 60_000,
        });
      }
      return Promise.resolve({
        success: false,
        limit: 10,
        remaining: 0,
        reset: Date.now() + 45_000,
      });
    });

    // Pré-charge les responses pour 10 happy paths consécutifs.
    for (let i = 0; i < 10; i++) {
      pushSlotSelect({ data: { starts_at: SLOT_STARTS_AT }, error: null });
      pushOrderSelect(
        { data: null, error: null },
        { data: DEFAULT_ORDER, error: null },
      );
      pushOrderUpdate({ data: null, error: null });
      pushRpc("create_order_with_items", { data: ORDER_ID, error: null });
    }

    // Reset des défaults beforeEach déjà push (1 set) — on consomme d'abord,
    // les 10 calls vont chacun consommer 1 entrée des queues.
    // Le beforeEach a déjà push 1 set par défaut, on en a 11 total ; les
    // 10 premiers calls happy path consomment 10. OK.

    let okCount = 0;
    let rlCount = 0;
    for (let i = 1; i <= 11; i++) {
      const res = await POST(makeRequest());
      if (res.status === 200) okCount++;
      else if (res.status === 429) rlCount++;
    }
    expect(okCount).toBe(10);
    expect(rlCount).toBe(1);
  });
});
