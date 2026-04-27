import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Mocks hoistés AVANT l'import de la route. createSupabaseAdminClient et
// stripe.refunds.create sont substitués pour ne pas avoir à set
// SUPABASE_SERVICE_ROLE_KEY ni STRIPE_SECRET_KEY dans l'env du test (le
// vrai module @/lib/stripe/server throw au chargement si la clé manque).
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/stripe/server", () => ({
  stripe: {
    refunds: {
      create: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/resend/send", () => ({
  sendTemplate: vi.fn(),
}));

vi.mock("@/lib/resend/templates/order-timeout-cancelled", () => ({
  default: () => null,
  subject: (props: { codeCommande: string }) =>
    `Commande ${props.codeCommande} annulée (timeout)`,
}));

import { POST } from "@/app/api/cron/order-timeout/route";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";
import { sendTemplate } from "@/lib/resend/send";
import { revalidateTag } from "next/cache";

// =============================================================================
// Mock Supabase admin — chaque appel `from(table)` retourne un builder neuf.
// Le builder est thenable (chaînes terminées par `await`, ex. SELECT orders /
// UPDATE orders) et expose `.maybeSingle()` (SELECT producers / users).
// =============================================================================
type ChainResp = { data?: unknown; error?: unknown };

interface SupabaseControl {
  selectOrders?: ChainResp;
  updateOrders?: ChainResp;
  producer?: ChainResp;
  consumer?: ChainResp;
}

interface Captured {
  from: string[];
  selectCols: Array<{ table: string; cols: string }>;
  updates: Array<{ table: string; payload: Record<string, unknown> }>;
  eqs: Array<{ table: string; col: string; val: unknown }>;
  lts: Array<{ table: string; col: string; val: unknown }>;
  maybeSingleCount: number;
}

function makeSupabase(ctrl: SupabaseControl = {}): {
  client: SupabaseClient;
  captured: Captured;
} {
  const captured: Captured = {
    from: [],
    selectCols: [],
    updates: [],
    eqs: [],
    lts: [],
    maybeSingleCount: 0,
  };

  const buildBuilder = (table: string) => {
    let mode: "select" | "update" | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};

    b.select = (cols: string) => {
      captured.selectCols.push({ table, cols });
      if (mode === null) mode = "select";
      return b;
    };
    b.update = (payload: Record<string, unknown>) => {
      captured.updates.push({ table, payload });
      mode = "update";
      return b;
    };
    b.eq = (col: string, val: unknown) => {
      captured.eqs.push({ table, col, val });
      return b;
    };
    b.lt = (col: string, val: unknown) => {
      captured.lts.push({ table, col, val });
      return b;
    };
    b.maybeSingle = () => {
      captured.maybeSingleCount += 1;
      if (table === "producers") {
        return Promise.resolve(
          ctrl.producer ?? {
            data: { nom_exploitation: "Ferme Test" },
            error: null,
          },
        );
      }
      if (table === "users") {
        return Promise.resolve(
          ctrl.consumer ?? {
            data: { email: "consumer@test.fr" },
            error: null,
          },
        );
      }
      return Promise.resolve({ data: null, error: null });
    };
    b.then = (onFulfilled: (r: ChainResp) => unknown) => {
      let resp: ChainResp;
      if (table === "orders" && mode === "update") {
        resp = ctrl.updateOrders ?? { data: null, error: null };
      } else if (table === "orders" && mode === "select") {
        resp = ctrl.selectOrders ?? { data: [], error: null };
      } else {
        resp = { data: null, error: null };
      }
      return onFulfilled(resp);
    };
    return b;
  };

  const client = {
    from: (table: string) => {
      captured.from.push(table);
      return buildBuilder(table);
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

function makeRequest(opts: { auth?: string } = {}): Request {
  const headers = new Headers();
  if (opts.auth) headers.set("authorization", opts.auth);
  return new Request("http://localhost/api/cron/order-timeout", {
    method: "POST",
    headers,
  });
}

function makeOrder(opts: { id: string; paymentIntent?: string | null }) {
  return {
    id: opts.id,
    code_commande: `CMD-${opts.id}`,
    consumer_id: `consumer-${opts.id}`,
    producer_id: `producer-${opts.id}`,
    montant_total: 25.5,
    stripe_payment_intent_id: opts.paymentIntent ?? null,
  };
}

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const FROZEN_NOW = new Date("2026-04-27T12:00:00.000Z");
const EXPECTED_CUTOFF = "2026-04-26T12:00:00.000Z";

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";

  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);

  vi.mocked(stripe.refunds.create).mockReset();
  vi.mocked(stripe.refunds.create).mockResolvedValue({
    id: "re_test",
  } as never);

  vi.mocked(sendTemplate).mockReset();
  vi.mocked(sendTemplate).mockResolvedValue({ ok: true, id: "email_id" });

  vi.mocked(createSupabaseAdminClient).mockReset();

  vi.mocked(revalidateTag).mockReset();

  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (ORIGINAL_CRON_SECRET === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  }
});

// =============================================================================
// 1-3. Auth — header missing / wrong / CRON_SECRET non configuré
// =============================================================================
describe("POST /api/cron/order-timeout — auth", () => {
  it("returns 401 when authorization header is missing", async () => {
    const { client } = makeSupabase();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 401 when authorization header does not match Bearer <CRON_SECRET>", async () => {
    const { client } = makeSupabase();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest({ auth: "Bearer wrong-secret" }));
    expect(res.status).toBe(401);
  });

  it("returns 500 when CRON_SECRET env var is not configured", async () => {
    delete process.env.CRON_SECRET;
    const { client } = makeSupabase();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("CRON_SECRET");
  });
});

// =============================================================================
// 4-5. SELECT orders — erreur PostgREST + cas no-op (cutoff filter)
// =============================================================================
describe("POST /api/cron/order-timeout — DB select", () => {
  it("returns 500 with the PostgREST error message when SELECT fails", async () => {
    const { client } = makeSupabase({
      selectOrders: { data: null, error: { message: "RLS denied" } },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("RLS denied");
  });

  it("returns processed=0 with no side effects when no pending orders match the cutoff", async () => {
    const { client, captured } = makeSupabase({
      selectOrders: { data: [], error: null },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ processed: 0 });

    // Filtre SQL : orders.statut=pending + orders.created_at < (now - 24h).
    expect(captured.from).toEqual(["orders"]);
    expect(captured.eqs).toContainEqual({
      table: "orders",
      col: "statut",
      val: "pending",
    });
    expect(captured.lts).toEqual([
      { table: "orders", col: "created_at", val: EXPECTED_CUTOFF },
    ]);

    // Aucun side-effect.
    expect(captured.updates).toEqual([]);
    expect(vi.mocked(stripe.refunds.create)).not.toHaveBeenCalled();
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 6-8. Single order — sans PI / PI+refund OK / PI+refund KO
// =============================================================================
describe("POST /api/cron/order-timeout — single order", () => {
  it("cancels (status=cancelled) an order without payment_intent, no Stripe refund call", async () => {
    const order = makeOrder({ id: "order-1", paymentIntent: null });
    const { client, captured } = makeSupabase({
      selectOrders: { data: [order], error: null },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      processed: number;
      results: Array<Record<string, unknown>>;
    };

    expect(vi.mocked(stripe.refunds.create)).not.toHaveBeenCalled();

    const ordersUpdate = captured.updates.find((u) => u.table === "orders");
    expect(ordersUpdate?.payload).toEqual({
      statut: "cancelled",
      cancellation_reason: "timeout",
      cancelled_at: FROZEN_NOW.toISOString(),
    });

    // Le filtre WHERE de l'UPDATE est posé sur orders.id.
    expect(captured.eqs).toContainEqual({
      table: "orders",
      col: "id",
      val: "order-1",
    });

    expect(body.processed).toBe(1);
    expect(body.results).toEqual([
      { order_id: "order-1", refunded: false },
    ]);
  });

  it("refunds (status=refunded) an order with payment_intent when Stripe refund succeeds", async () => {
    const order = makeOrder({ id: "order-2", paymentIntent: "pi_abc" });
    const { client, captured } = makeSupabase({
      selectOrders: { data: [order], error: null },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      processed: number;
      results: Array<Record<string, unknown>>;
    };

    expect(vi.mocked(stripe.refunds.create)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(stripe.refunds.create)).toHaveBeenCalledWith({
      payment_intent: "pi_abc",
    });

    const ordersUpdate = captured.updates.find((u) => u.table === "orders");
    expect(ordersUpdate?.payload.statut).toBe("refunded");
    expect(ordersUpdate?.payload.cancellation_reason).toBe("timeout");
    expect(ordersUpdate?.payload.cancelled_at).toBe(FROZEN_NOW.toISOString());

    expect(body.processed).toBe(1);
    expect(body.results).toEqual([
      { order_id: "order-2", refunded: true },
    ]);
  });

  it("falls back to cancelled when Stripe refund throws, capturing the error in results", async () => {
    const order = makeOrder({ id: "order-3", paymentIntent: "pi_fail" });
    const { client, captured } = makeSupabase({
      selectOrders: { data: [order], error: null },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
    vi.mocked(stripe.refunds.create).mockRejectedValueOnce(
      new Error("card_error"),
    );

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      processed: number;
      results: Array<Record<string, unknown>>;
    };

    expect(vi.mocked(stripe.refunds.create)).toHaveBeenCalledTimes(1);

    const ordersUpdate = captured.updates.find((u) => u.table === "orders");
    expect(ordersUpdate?.payload.statut).toBe("cancelled");

    expect(body.results).toEqual([
      { order_id: "order-3", refunded: false, error: "card_error" },
    ]);
  });
});

// =============================================================================
// 9. N orders — batch mixte
// =============================================================================
describe("POST /api/cron/order-timeout — multiple orders", () => {
  it("processes all orders when the batch mixes no-PI / PI-OK / PI-failed", async () => {
    const orderA = makeOrder({ id: "order-A", paymentIntent: null });
    const orderB = makeOrder({ id: "order-B", paymentIntent: "pi_ok" });
    const orderC = makeOrder({ id: "order-C", paymentIntent: "pi_ko" });
    const { client, captured } = makeSupabase({
      selectOrders: { data: [orderA, orderB, orderC], error: null },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
    // Premier refund (order-B) OK, deuxième (order-C) rejeté.
    vi.mocked(stripe.refunds.create)
      .mockResolvedValueOnce({ id: "re_ok" } as never)
      .mockRejectedValueOnce(new Error("declined"));

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      processed: number;
      results: Array<Record<string, unknown>>;
    };

    // Order-A skip refund, order-B+C tentent refund.
    expect(vi.mocked(stripe.refunds.create)).toHaveBeenCalledTimes(2);
    expect(captured.updates.filter((u) => u.table === "orders")).toHaveLength(
      3,
    );
    expect(body.processed).toBe(3);
    expect(body.results).toEqual([
      { order_id: "order-A", refunded: false },
      { order_id: "order-B", refunded: true },
      { order_id: "order-C", refunded: false, error: "declined" },
    ]);
  });
});

// =============================================================================
// 10-12. Email — skip si données manquantes / envoi happy path
// =============================================================================
describe("POST /api/cron/order-timeout — email notification", () => {
  it("skips email when consumer email is null", async () => {
    const order = makeOrder({ id: "order-1", paymentIntent: null });
    const { client } = makeSupabase({
      selectOrders: { data: [order], error: null },
      consumer: { data: { email: null }, error: null },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();
  });

  it("skips email when producer record is missing", async () => {
    const order = makeOrder({ id: "order-1", paymentIntent: null });
    const { client } = makeSupabase({
      selectOrders: { data: [order], error: null },
      producer: { data: null, error: null },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();
  });

  it("sends order_timeout_cancelled email with correct props/metadata when consumer+producer are present", async () => {
    const order = makeOrder({ id: "order-7", paymentIntent: null });
    const { client } = makeSupabase({
      selectOrders: { data: [order], error: null },
      producer: { data: { nom_exploitation: "Ferme du Test" }, error: null },
      consumer: { data: { email: "alice@example.com" }, error: null },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    await POST(makeRequest({ auth: "Bearer test-secret" }));

    expect(vi.mocked(sendTemplate)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendTemplate).mock.calls[0]?.[0];
    expect(call?.to).toBe("alice@example.com");
    expect(call?.userId).toBe("consumer-order-7");
    expect(call?.template).toBe("order_timeout_cancelled");
    expect(call?.subject).toContain("CMD-order-7");
    expect(call?.metadata).toEqual({
      order_id: "order-7",
      code_commande: "CMD-order-7",
    });
  });
});

// =============================================================================
// B1-B2. Robustesse UPDATE (anciennement it.todo, désormais couverts)
// =============================================================================
describe("POST /api/cron/order-timeout — UPDATE error handling", () => {
  it("B1 UPDATE error remonte dans results.db_error, status 200, sendTemplate skipped pour cet order", async () => {
    const order = makeOrder({ id: "order-db-fail", paymentIntent: null });
    const { client, captured } = makeSupabase({
      selectOrders: { data: [order], error: null },
      updateOrders: { data: null, error: { message: "RLS denied" } },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      processed: number;
      results: Array<Record<string, unknown>>;
    };

    // L'UPDATE a bien été tenté (capturé) et a échoué.
    expect(captured.updates.find((u) => u.table === "orders")).toBeDefined();

    // L'erreur DB remonte explicitement dans results.
    expect(body.processed).toBe(1);
    expect(body.results).toEqual([
      {
        order_id: "order-db-fail",
        refunded: false,
        db_error: "RLS denied",
      },
    ]);

    // Email skip (continue dans la boucle après UPDATE error).
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();
  });

  it("B2 refund Stripe OK + UPDATE error → console.warn [REFUND_DB_DRIFT] grep-able avec order_id+pi", async () => {
    const order = makeOrder({ id: "order-drift", paymentIntent: "pi_drift" });
    const { client } = makeSupabase({
      selectOrders: { data: [order], error: null },
      updateOrders: { data: null, error: { message: "constraint violation" } },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);

    // Le refund Stripe a bien été émis (avant l'UPDATE).
    expect(vi.mocked(stripe.refunds.create)).toHaveBeenCalledTimes(1);

    // Warning de drift Stripe/DB capturé avec préfixe grep-able + order_id + pi.
    const driftWarnings = consoleWarnSpy.mock.calls
      .map((c: unknown[]) => String(c[0] ?? ""))
      .filter((m: string) => m.includes("[REFUND_DB_DRIFT]"));
    expect(driftWarnings).toHaveLength(1);
    expect(driftWarnings[0]).toContain("order=order-drift");
    expect(driftWarnings[0]).toContain("pi=pi_drift");
    expect(driftWarnings[0]).toContain("constraint violation");
  });

  it("B2bis pas de refund Stripe (no PI) + UPDATE error → pas de [REFUND_DB_DRIFT] (drift impossible)", async () => {
    const order = makeOrder({ id: "order-no-pi", paymentIntent: null });
    const { client } = makeSupabase({
      selectOrders: { data: [order], error: null },
      updateOrders: { data: null, error: { message: "RLS denied" } },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    await POST(makeRequest({ auth: "Bearer test-secret" }));

    const driftWarnings = consoleWarnSpy.mock.calls
      .map((c: unknown[]) => String(c[0] ?? ""))
      .filter((m: string) => m.includes("[REFUND_DB_DRIFT]"));
    expect(driftWarnings).toHaveLength(0);
  });
});

// =============================================================================
// B3-B5. revalidateTag('public-stats') en sortie de boucle
// =============================================================================
describe("POST /api/cron/order-timeout — revalidateTag", () => {
  it("B3 cas nominal (≥1 UPDATE OK) → revalidateTag('public-stats') appelé une seule fois", async () => {
    const orderA = makeOrder({ id: "order-A", paymentIntent: null });
    const orderB = makeOrder({ id: "order-B", paymentIntent: "pi_ok" });
    const { client } = makeSupabase({
      selectOrders: { data: [orderA, orderB], error: null },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    await POST(makeRequest({ auth: "Bearer test-secret" }));

    // Une seule invalidation atomique pour tout le batch (pas N).
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith("public-stats");
  });

  it("B4 revalidateTag throw → 200 conservé + console.warn [STATS_REVAL_WARN]", async () => {
    const order = makeOrder({ id: "order-1", paymentIntent: null });
    const { client } = makeSupabase({
      selectOrders: { data: [order], error: null },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
    vi.mocked(revalidateTag).mockImplementation(() => {
      throw new Error("cache down");
    });

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);

    const revalWarnings = consoleWarnSpy.mock.calls
      .map((c: unknown[]) => String(c[0] ?? ""))
      .filter((m: string) => m.includes("[STATS_REVAL_WARN]"));
    expect(revalWarnings).toHaveLength(1);
    expect(revalWarnings[0]).toContain("cron=order-timeout");
    expect(revalWarnings[0]).toContain("cache down");
  });

  it("B5 toutes les UPDATE échouent → revalidateTag PAS appelé (no-op silent)", async () => {
    const orderA = makeOrder({ id: "order-A", paymentIntent: null });
    const orderB = makeOrder({ id: "order-B", paymentIntent: null });
    const { client } = makeSupabase({
      selectOrders: { data: [orderA, orderB], error: null },
      updateOrders: { data: null, error: { message: "RLS denied" } },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    await POST(makeRequest({ auth: "Bearer test-secret" }));

    // Aucune UPDATE n'a réussi → cache non invalidé (cache stale > flap à vide).
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });
});
