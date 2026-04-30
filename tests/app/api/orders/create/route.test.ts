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
type Op = "select" | "pending";

type Captured = {
  fromCalls: string[];
  selects: Array<{ table: string; cols: string }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
  gtCalls: Array<{ table: string; col: string; val: unknown }>;
  limitCalls: Array<{ table: string; n: number }>;
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
      return builder;
    },
    rpc: (name: string, args: unknown) => {
      captured.rpcCalls.push({ name, args });
      return Promise.resolve(consumeRpc(name));
    },
  }),
}));

// --- Audit log mock (T-429) ---------------------------------------------
// Le helper logPaymentEvent est fail-safe interne (try/catch swallow).
// On le mocke pour vérifier l'instrumentation T-429 sans dépendance DB
// (cohérent pattern tests/lib/stripe/handle-payment-failed.test.ts:18-20).
vi.mock("@/lib/audit-logs/log-payment-event", () => ({
  logPaymentEvent: vi.fn(),
}));

// --- Import APRÈS les mocks ----------------------------------------------

import { POST } from "@/app/api/orders/create/route";
import { extractHeureRetrait } from "@/lib/slots/format-slot-time";
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

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = {
    fromCalls: [],
    selects: [],
    eqCalls: [],
    gtCalls: [],
    limitCalls: [],
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
  // pending récente), RPC retourne ORDER_ID, post-fetch enrich OK.
  pushSlotSelect({ data: { starts_at: SLOT_STARTS_AT }, error: null });
  pushOrderSelect(
    // 1er consume : dedup pré-RPC T-428 → miss (pas d'order existante)
    { data: null, error: null },
    // 2ème consume : enrich post-RPC → DEFAULT_ORDER
    { data: DEFAULT_ORDER, error: null },
  );
  pushRpc("create_order_with_items", { data: ORDER_ID, error: null });
  // T-429 : reset le compteur d'appels audit log entre chaque test.
  vi.mocked(logPaymentEvent).mockClear();
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

    // Pré-check slot + dedup T-428 (orders) + post-fetch enrich (orders) : 3 SELECTs.
    expect(captured.fromCalls).toEqual(["slots", "orders", "orders"]);
    expect(
      captured.eqCalls.find((e) => e.table === "orders" && e.col === "id"),
    ).toEqual({ table: "orders", col: "id", val: ORDER_ID });

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
        date_retrait: "2026-05-15",
        montant_total: 25.5,
        commission: 1.28,
        montant_net: 24.22,
        items_count: 1,
      },
    });
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
    const rpcArgs = captured.rpcCalls[0]!.args as Record<string, unknown>;
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
        date_retrait: "2026-05-15",
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
    // RPC non appelée : la dedup court-circuite avant.
    expect(captured.rpcCalls).toEqual([]);
    // Pas de duplication audit log (1ère création a déjà loggé via T-429).
    expect(logPaymentEvent).not.toHaveBeenCalled();
    // Vérifier que les 4 filtres dedup sont posés sur la query orders.
    const ordersEqs = captured.eqCalls.filter((e) => e.table === "orders");
    expect(ordersEqs).toEqual(
      expect.arrayContaining([
        { table: "orders", col: "consumer_id", val: CONSUMER_ID },
        { table: "orders", col: "slot_id", val: SLOT_ID },
        { table: "orders", col: "date_retrait", val: "2026-05-15" },
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
    expect(captured.rpcCalls).toHaveLength(1);
    expect(logPaymentEvent).toHaveBeenCalledTimes(1);
    // 3 from au total : slots (pré-check) + orders (dedup miss) + orders (enrich post-RPC).
    expect(captured.fromCalls).toEqual(["slots", "orders", "orders"]);
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

    // Pas de RPC, pas de 2ème SELECT orders (enrich) → 2 from total.
    expect(captured.fromCalls).toEqual(["slots", "orders"]);
    expect(captured.rpcCalls).toEqual([]);
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
    expect(captured.rpcCalls).toHaveLength(1);
    // Audit log T-429 posé (path nominal, pas dedup hit).
    expect(logPaymentEvent).toHaveBeenCalledTimes(1);
  });
});
