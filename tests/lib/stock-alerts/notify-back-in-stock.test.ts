// Tests vitest pour lib/stock-alerts/notify-back-in-stock.tsx.
//
// Stratégie : mock SupabaseClient injecté + mock sendTemplate (module
// @/lib/resend/send). On capture les args de sendTemplate pour vérifier
// que les props du template sont correctement injectées (productName,
// productUrl, producerName, unsubscribeUrl).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Hoist le stub env-var avant les imports static (sinon lib/env/urls.ts
// throw au module-load). Pattern aligné tests/app/api/admin/producers/
// invite/route.test.ts.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

vi.mock("server-only", () => ({}));

// Hoist le mock pour que la factory vi.mock puisse référencer mockSendTemplate.
const { mockSendTemplate } = vi.hoisted(() => ({
  mockSendTemplate: vi.fn(),
}));

vi.mock("@/lib/resend/send", () => ({
  sendTemplate: mockSendTemplate,
}));

import { notifyBackInStock } from "@/lib/stock-alerts/notify-back-in-stock";

type Resp = { data?: unknown; error?: unknown };
type Op = "select" | "update" | "insert" | "pending";

type Captured = {
  fromCalls: string[];
  selects: Array<{ table: string; cols: string }>;
  updates: Array<{ table: string; payload: unknown }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
  isCalls: Array<{ table: string; col: string; val: unknown }>;
  notCalls: Array<{ table: string; col: string; op: string; val: unknown }>;
};

let captured: Captured;
let responses: Record<
  string,
  Partial<Record<"select" | "update" | "insert", Resp[]>>
>;

function consume(table: string, op: Op): Resp {
  if (op !== "pending") {
    const queue = responses[table]?.[op];
    if (queue && queue.length > 0) return queue.shift()!;
  }
  return { data: null, error: null };
}

function pushResp(
  table: string,
  op: "select" | "update" | "insert",
  ...resps: Resp[]
) {
  responses[table] = responses[table] ?? {};
  responses[table][op] = [...(responses[table][op] ?? []), ...resps];
}

function buildMockClient(): SupabaseClient {
  return {
    from: (table: string) => {
      captured.fromCalls.push(table);
      const builder: Record<string, unknown> & { _op: Op } = { _op: "pending" };
      builder.select = (cols: string) => {
        captured.selects.push({ table, cols });
        if (builder._op === "pending") builder._op = "select";
        return builder;
      };
      builder.update = (payload: unknown) => {
        captured.updates.push({ table, payload });
        builder._op = "update";
        return builder;
      };
      builder.eq = (col: string, val: unknown) => {
        captured.eqCalls.push({ table, col, val });
        return builder;
      };
      builder.is = (col: string, val: unknown) => {
        captured.isCalls.push({ table, col, val });
        return builder;
      };
      builder.not = (col: string, op: string, val: unknown) => {
        captured.notCalls.push({ table, col, op, val });
        return builder;
      };
      builder.maybeSingle = () =>
        Promise.resolve(consume(table, builder._op));
      builder.single = () => Promise.resolve(consume(table, builder._op));
      builder.then = (onFulfilled: (r: Resp) => unknown) =>
        onFulfilled(consume(table, builder._op));
      return builder;
    },
  } as unknown as SupabaseClient;
}

const PRODUCT_ID = "product-uuid-1";
const PRODUCER_ID = "producer-uuid-1";
const ALERT_ID = "alert-uuid-1";
const CONSUMER_ID = "consumer-uuid-1";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = {
    fromCalls: [],
    selects: [],
    updates: [],
    eqCalls: [],
    isCalls: [],
    notCalls: [],
  };
  responses = {};
  mockSendTemplate.mockReset();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function defaultProductOk() {
  pushResp("products", "select", {
    data: { id: PRODUCT_ID, nom: "Faux-filet", producer_id: PRODUCER_ID },
    error: null,
  });
}

function defaultProducerOk() {
  pushResp("producers", "select", {
    data: { slug: "ferme-foo", nom_exploitation: "Ferme du Foo" },
    error: null,
  });
}

describe("notifyBackInStock — pré-conditions", () => {
  it("product introuvable → 0/0/0 sans erreur (CASCADE déjà passé)", async () => {
    pushResp("products", "select", { data: null, error: null });
    const client = buildMockClient();
    const res = await notifyBackInStock(client, PRODUCT_ID);
    expect(res).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(mockSendTemplate).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("erreur fetch product → 0/0/0 + console.error", async () => {
    pushResp("products", "select", {
      data: null,
      error: { message: "db down" },
    });
    const client = buildMockClient();
    const res = await notifyBackInStock(client, PRODUCT_ID);
    expect(res).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("erreur fetch alerts → 0/0/0 + console.error", async () => {
    defaultProductOk();
    defaultProducerOk();
    pushResp("product_stock_alerts", "select", {
      data: null,
      error: { message: "alerts query failed" },
    });
    const client = buildMockClient();
    const res = await notifyBackInStock(client, PRODUCT_ID);
    expect(res).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("aucune alerte éligible (table vide pour ce product) → 0/0/0 sans erreur", async () => {
    defaultProductOk();
    defaultProducerOk();
    pushResp("product_stock_alerts", "select", { data: [], error: null });
    const client = buildMockClient();
    const res = await notifyBackInStock(client, PRODUCT_ID);
    expect(res).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });
});

describe("notifyBackInStock — envoi", () => {
  it("1 alerte, send OK + update OK → sent=1", async () => {
    defaultProductOk();
    defaultProducerOk();
    pushResp("product_stock_alerts", "select", {
      data: [
        {
          id: ALERT_ID,
          email: "consumer@example.com",
          unsubscribe_token: "UNSUB_T",
          consumer_id: CONSUMER_ID,
        },
      ],
      error: null,
    });
    pushResp("product_stock_alerts", "update", { data: null, error: null });
    mockSendTemplate.mockResolvedValueOnce({ ok: true, id: "resend-1" });

    const client = buildMockClient();
    const res = await notifyBackInStock(client, PRODUCT_ID);
    expect(res).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(mockSendTemplate).toHaveBeenCalledTimes(1);

    // UPDATE notified_at déclenché
    expect(captured.updates).toHaveLength(1);
    const updatePayload = captured.updates[0].payload as Record<string, unknown>;
    expect(typeof updatePayload.notified_at).toBe("string");
    expect(captured.eqCalls).toContainEqual({
      table: "product_stock_alerts",
      col: "id",
      val: ALERT_ID,
    });
  });

  it("1 alerte, send fail → failed=1, pas d'UPDATE notified_at", async () => {
    defaultProductOk();
    defaultProducerOk();
    pushResp("product_stock_alerts", "select", {
      data: [
        {
          id: ALERT_ID,
          email: "consumer@example.com",
          unsubscribe_token: "UNSUB_T",
          consumer_id: null,
        },
      ],
      error: null,
    });
    mockSendTemplate.mockResolvedValueOnce({ ok: false, error: "rate limited" });

    const client = buildMockClient();
    const res = await notifyBackInStock(client, PRODUCT_ID);
    expect(res).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(captured.updates).toHaveLength(0);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("1 alerte, send OK + update fail → failed=1 (email parti, mais notified_at non setté)", async () => {
    defaultProductOk();
    defaultProducerOk();
    pushResp("product_stock_alerts", "select", {
      data: [
        {
          id: ALERT_ID,
          email: "consumer@example.com",
          unsubscribe_token: "UNSUB_T",
          consumer_id: null,
        },
      ],
      error: null,
    });
    pushResp("product_stock_alerts", "update", {
      data: null,
      error: { message: "update fail" },
    });
    mockSendTemplate.mockResolvedValueOnce({ ok: true, id: "resend-1" });

    const client = buildMockClient();
    const res = await notifyBackInStock(client, PRODUCT_ID);
    expect(res).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("3 alertes, mix succès + send fail + update fail → counts corrects", async () => {
    defaultProductOk();
    defaultProducerOk();
    pushResp("product_stock_alerts", "select", {
      data: [
        { id: "a1", email: "a@x.com", unsubscribe_token: "T1", consumer_id: null },
        { id: "a2", email: "b@x.com", unsubscribe_token: "T2", consumer_id: null },
        { id: "a3", email: "c@x.com", unsubscribe_token: "T3", consumer_id: null },
      ],
      error: null,
    });
    // a1 OK : send OK + update OK
    // a2 send fail
    // a3 send OK + update fail
    pushResp(
      "product_stock_alerts",
      "update",
      { data: null, error: null }, // pour a1
      { data: null, error: { message: "update fail" } }, // pour a3
    );
    mockSendTemplate
      .mockResolvedValueOnce({ ok: true, id: "r1" })
      .mockResolvedValueOnce({ ok: false, error: "fail" })
      .mockResolvedValueOnce({ ok: true, id: "r3" });

    const client = buildMockClient();
    const res = await notifyBackInStock(client, PRODUCT_ID);
    expect(res).toEqual({ sent: 1, failed: 2, skipped: 0 });
    expect(mockSendTemplate).toHaveBeenCalledTimes(3);
  });
});

describe("notifyBackInStock — props passées au template", () => {
  it("productName + productUrl + producerName + unsubscribeUrl correctement injectés", async () => {
    defaultProductOk();
    defaultProducerOk();
    pushResp("product_stock_alerts", "select", {
      data: [
        {
          id: ALERT_ID,
          email: "consumer@example.com",
          unsubscribe_token: "UNSUB_T",
          consumer_id: CONSUMER_ID,
        },
      ],
      error: null,
    });
    pushResp("product_stock_alerts", "update", { data: null, error: null });
    mockSendTemplate.mockResolvedValueOnce({ ok: true, id: "r1" });

    const client = buildMockClient();
    await notifyBackInStock(client, PRODUCT_ID);

    expect(mockSendTemplate).toHaveBeenCalledTimes(1);
    const args = mockSendTemplate.mock.calls[0][0];
    expect(args.to).toBe("consumer@example.com");
    expect(args.userId).toBe(CONSUMER_ID);
    expect(args.template).toBe("stock-alert-back-in-stock");
    expect(args.subject).toBe("Faux-filet est de retour en stock");
    expect(args.metadata).toEqual({
      product_id: PRODUCT_ID,
      alert_id: ALERT_ID,
    });

    // Inspection des props du composant React passé en `element`
    const element = args.element as { props: Record<string, unknown> };
    expect(element.props.productName).toBe("Faux-filet");
    expect(element.props.productUrl).toBe(
      "http://localhost:3000/producteurs/ferme-foo/produits/" + PRODUCT_ID,
    );
    expect(element.props.producerName).toBe("Ferme du Foo");
    expect(element.props.unsubscribeUrl).toBe(
      "http://localhost:3000/api/stock-alerts/unsubscribe?token=UNSUB_T",
    );
  });

  it("producer fetch en erreur → producerName=null + URL fallback /producteurs", async () => {
    defaultProductOk();
    pushResp("producers", "select", {
      data: null,
      error: { message: "producer query fail" },
    });
    pushResp("product_stock_alerts", "select", {
      data: [
        {
          id: ALERT_ID,
          email: "x@y.com",
          unsubscribe_token: "T",
          consumer_id: null,
        },
      ],
      error: null,
    });
    pushResp("product_stock_alerts", "update", { data: null, error: null });
    mockSendTemplate.mockResolvedValueOnce({ ok: true, id: "r1" });

    const client = buildMockClient();
    const res = await notifyBackInStock(client, PRODUCT_ID);
    expect(res).toEqual({ sent: 1, failed: 0, skipped: 0 });

    const element = mockSendTemplate.mock.calls[0][0].element as {
      props: Record<string, unknown>;
    };
    expect(element.props.producerName).toBeNull();
    expect(element.props.productUrl).toBe("http://localhost:3000/producteurs");
    expect(consoleWarnSpy).toHaveBeenCalled();
  });

  it("product sans producer_id → producerName=null + URL fallback", async () => {
    pushResp("products", "select", {
      data: { id: PRODUCT_ID, nom: "Mystère", producer_id: null },
      error: null,
    });
    // Pas de fetch producer attendu (producer_id null short-circuit).
    pushResp("product_stock_alerts", "select", {
      data: [
        {
          id: ALERT_ID,
          email: "x@y.com",
          unsubscribe_token: "T",
          consumer_id: null,
        },
      ],
      error: null,
    });
    pushResp("product_stock_alerts", "update", { data: null, error: null });
    mockSendTemplate.mockResolvedValueOnce({ ok: true, id: "r1" });

    const client = buildMockClient();
    await notifyBackInStock(client, PRODUCT_ID);

    expect(captured.fromCalls).not.toContain("producers");
    const element = mockSendTemplate.mock.calls[0][0].element as {
      props: Record<string, unknown>;
    };
    expect(element.props.producerName).toBeNull();
    expect(element.props.productUrl).toBe("http://localhost:3000/producteurs");
  });
});
