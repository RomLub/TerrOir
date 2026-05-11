// Tests vitest pour POST /api/cron/review-followup (cluster review_followup_*
// + marqueur DB dédup race-safe ajoutés 2026-05-07).
//
// Couverture :
//   - Auth assertCronAuth (Bearer CRON_SECRET) : 401 sans header,
//     401 bearer invalide, exécution si valide.
//   - Logique fenêtre J-2 / J-7 : 1 order completed dans la fenêtre
//     → 1 email envoyé avec dayOffset cohérent + audit sent_d{2,7}.
//   - Anti-spam guard : reviews.order_id existant → skip + audit
//     `review_followup_skipped` reason=review_exists.
//   - Robustesse missing data : consumer.email null OR producer null
//     → skip propre + audit reason discriminée.
//   - Dedup race-safe : UPDATE claimed=[] (concurrent) → audit
//     `review_followup_dedup_blocked`, pas de send.
//   - Réponse JSON { j2: { sent, skipped, dedup_blocked }, j7: ... }.
//   - F-020 : query principale enrichie embeds PostgREST
//     (`consumer:consumer_id(...)`, `producer:producer_id(...)`) + batch
//     mapWithConcurrency cap 5. Vérifié via `select` cols + absence de
//     `from('users')` / `from('producers')` séparés.
//
// Pattern aligné sur tests/app/api/cron/reminder-consumer/route.test.ts,
// avec queue par-table pour gérer reviews + UPDATE de claim sur orders.
// Post F-020 : consumer/producer fetchés via embeds dans le SELECT initial,
// plus de calls séparés `from('users')` / `from('producers')`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/resend/send", () => ({
  sendTemplate: vi.fn(),
}));

vi.mock("@/lib/resend/templates/review-request", () => ({
  default: () => null,
  subject: (props: { exploitation: string; dayOffset: 0 | 2 | 7 }) =>
    `Review subject ${props.exploitation} dayOffset=${props.dayOffset}`,
}));

vi.mock("@/lib/audit-logs/log-review-followup-event", () => ({
  logReviewFollowupEvent: vi.fn(),
}));

import { POST } from "@/app/api/cron/review-followup/route";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendTemplate } from "@/lib/resend/send";
import { logReviewFollowupEvent } from "@/lib/audit-logs/log-review-followup-event";

// =============================================================================
// Mock Supabase admin avec queue par-table.
//
// Le cron fait par batch (J-2, J-7) :
//   1. SELECT orders ... .is(dedupColumn, null)   → table='orders' SELECT path
//   2. SELECT reviews ... .maybeSingle()
//   3. SELECT users ... .maybeSingle()
//   4. SELECT producers ... .maybeSingle()
//   5. UPDATE orders ... .eq(id).is(dedup, null).select() → table='orders' UPDATE path
//
// Surfaces SELECT vs UPDATE sur orders sont distinguées via mode:
//   - `.update(...)` switche vers `mode='update'` qui consomme la queue
//     `responses.orders_update`.
//   - `.select()` non précédé d'un `.update()` consomme `responses.orders`.
// =============================================================================

type ChainResp = { data?: unknown; error?: unknown };

interface Captured {
  from: string[];
  selectCols: Array<{ table: string; cols: string }>;
  updates: Array<{ table: string; payload: unknown }>;
}

let responses: Record<string, ChainResp[]>;
let captured: Captured;

function makeClient(): SupabaseClient {
  return {
    from: (table: string) => {
      captured.from.push(table);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      let mode: "select" | "update" = "select";
      b.select = (cols: string) => {
        captured.selectCols.push({ table, cols });
        return b;
      };
      b.update = (payload: unknown) => {
        mode = "update";
        captured.updates.push({ table, payload });
        return b;
      };
      b.eq = () => b;
      b.gte = () => b;
      b.lte = () => b;
      b.is = () => b;
      const consume = (): ChainResp => {
        const queueKey =
          mode === "update" && table === "orders" ? "orders_update" : table;
        const queue = responses[queueKey];
        if (queue && queue.length > 0) return queue.shift()!;
        return { data: null, error: null };
      };
      b.maybeSingle = () => Promise.resolve(consume());
      b.then = (onFulfilled: (r: ChainResp) => unknown) =>
        onFulfilled(consume());
      return b;
    },
  } as unknown as SupabaseClient;
}

function makeRequest(opts: { auth?: string } = {}): Request {
  const headers = new Headers();
  if (opts.auth) headers.set("authorization", opts.auth);
  return new Request("http://localhost/api/cron/review-followup", {
    method: "POST",
    headers,
  });
}

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  responses = {};
  captured = { from: [], selectCols: [], updates: [] };
  vi.mocked(createSupabaseAdminClient).mockReset();
  vi.mocked(createSupabaseAdminClient).mockReturnValue(makeClient());
  vi.mocked(sendTemplate).mockReset();
  vi.mocked(sendTemplate).mockResolvedValue({ ok: true, id: "email-id" });
  vi.mocked(logReviewFollowupEvent).mockReset();
  vi.mocked(logReviewFollowupEvent).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_CRON_SECRET === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  }
});

// --- Helpers fixtures ---------------------------------------------------

function makeOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "order-1",
    code_commande: "TRR-ABCDE",
    consumer_id: "cons-1",
    producer_id: "prod-1",
    review_followup_d2_sent_at: null,
    review_followup_d7_sent_at: null,
    // F-020 : embeds PostgREST inline (consumer + producer fetchés en 1 query).
    consumer: { email: "consumer@test.fr" },
    producer: { nom_exploitation: "Ferme A" },
    ...overrides,
  };
}

function findAuditEvents(eventType: string) {
  return vi
    .mocked(logReviewFollowupEvent)
    .mock.calls.filter(
      (c) => (c[0] as { eventType: string }).eventType === eventType,
    );
}

// --- A. Auth ------------------------------------------------------------

describe("POST /api/cron/review-followup — auth", () => {
  it("A1 pas de header Authorization → 401", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();
  });

  it("A2 Bearer invalide → 401", async () => {
    const res = await POST(makeRequest({ auth: "Bearer wrong-secret" }));
    expect(res.status).toBe(401);
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();
  });

  it("A3 Bearer valide → 200 + JSON { j2: {sent,skipped,dedup_blocked}, j7 ... }", async () => {
    responses.orders = [
      { data: [], error: null }, // J-2
      { data: [], error: null }, // J-7
    ];
    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      j2: { sent: number; skipped: number; dedup_blocked: number };
      j7: { sent: number; skipped: number; dedup_blocked: number };
    };
    expect(body.j2).toEqual({ sent: 0, skipped: 0, dedup_blocked: 0 });
    expect(body.j7).toEqual({ sent: 0, skipped: 0, dedup_blocked: 0 });
  });
});

// --- B. Logique fenêtre J-2 / J-7 -------------------------------------

describe("POST /api/cron/review-followup — fenêtre J-2 / J-7", () => {
  it("B1 1 order J-2 sans review → email J+2 envoyé, audit sent_d2, claim UPDATE posé", async () => {
    const order = makeOrder({ id: "order-j2", code_commande: "TRR-J2AAA" });
    responses.orders = [
      { data: [order], error: null }, // J-2 batch
      { data: [], error: null }, // J-7 batch
    ];
    responses.reviews = [{ data: null, error: null }];
    responses.orders_update = [{ data: [{ id: "order-j2" }], error: null }];

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      j2: { sent: number; skipped: number; dedup_blocked: number };
      j7: { sent: number; skipped: number; dedup_blocked: number };
    };
    expect(body.j2.sent).toBe(1);
    expect(body.j7.sent).toBe(0);

    expect(vi.mocked(sendTemplate)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendTemplate).mock.calls[0]?.[0];
    expect(call?.template).toBe("review_request_j2");
    expect(call?.to).toBe("consumer@test.fr");
    expect(call?.subject).toContain("dayOffset=2");

    // Claim UPDATE posé sur la colonne D2
    const ordersUpdate = captured.updates.find((u) => u.table === "orders");
    expect(ordersUpdate).toBeDefined();
    expect(ordersUpdate?.payload).toMatchObject({
      review_followup_d2_sent_at: expect.any(String),
    });

    // Audit sent_d2 émis
    expect(findAuditEvents("review_followup_sent_d2")).toHaveLength(1);
  });

  it("B2 1 order J-7 sans review → email J+7 envoyé, audit sent_d7", async () => {
    const order = makeOrder({
      id: "order-j7",
      code_commande: "TRR-J7BBB",
      producer: { nom_exploitation: "Ferme B" },
    });
    responses.orders = [
      { data: [], error: null },
      { data: [order], error: null },
    ];
    responses.reviews = [{ data: null, error: null }];
    responses.orders_update = [{ data: [{ id: "order-j7" }], error: null }];

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      j7: { sent: number };
    };
    expect(body.j7.sent).toBe(1);

    expect(vi.mocked(sendTemplate)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendTemplate).mock.calls[0]?.[0];
    expect(call?.template).toBe("review_request_j7");
    expect(call?.subject).toContain("dayOffset=7");

    expect(findAuditEvents("review_followup_sent_d7")).toHaveLength(1);
  });

  it("B3 fenêtre vide (orders=[]) → 200 + sent:0, pas d'email, pas d'audit", async () => {
    responses.orders = [
      { data: [], error: null },
      { data: [], error: null },
    ];

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();
    expect(vi.mocked(logReviewFollowupEvent)).not.toHaveBeenCalled();
  });
});

// --- C. Anti-spam guard (review existante) ----------------------------

describe("POST /api/cron/review-followup — anti-spam (review existante)", () => {
  it("C1 order J-2 AVEC review existante → skip, audit reason=review_exists, pas d'email, pas de claim", async () => {
    const order = makeOrder();
    responses.orders = [
      { data: [order], error: null },
      { data: [], error: null },
    ];
    responses.reviews = [{ data: { id: "review-1" }, error: null }];

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();

    // Pas de claim UPDATE
    expect(captured.updates.filter((u) => u.table === "orders")).toHaveLength(0);

    const skipped = findAuditEvents("review_followup_skipped");
    expect(skipped.length).toBeGreaterThanOrEqual(1);
    expect(
      (skipped[0]![0] as { metadata?: Record<string, unknown> }).metadata
        ?.reason,
    ).toBe("review_exists");
  });
});

// --- D. Robustesse missing data ---------------------------------------

describe("POST /api/cron/review-followup — robustesse missing data", () => {
  it("D1 consumer.email null → skip + audit reason=consumer_email_missing", async () => {
    const order = makeOrder({ consumer: { email: null } });
    responses.orders = [
      { data: [order], error: null },
      { data: [], error: null },
    ];
    responses.reviews = [{ data: null, error: null }];

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();

    const skipped = findAuditEvents("review_followup_skipped");
    expect(skipped.length).toBeGreaterThanOrEqual(1);
    expect(
      (skipped[0]![0] as { metadata?: Record<string, unknown> }).metadata
        ?.reason,
    ).toBe("consumer_email_missing");
  });

  it("D2 producer null → skip + audit reason=producer_missing", async () => {
    const order = makeOrder({ producer: null });
    responses.orders = [
      { data: [order], error: null },
      { data: [], error: null },
    ];
    responses.reviews = [{ data: null, error: null }];

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();

    const skipped = findAuditEvents("review_followup_skipped");
    expect(skipped.length).toBeGreaterThanOrEqual(1);
    expect(
      (skipped[0]![0] as { metadata?: Record<string, unknown> }).metadata
        ?.reason,
    ).toBe("producer_missing");
  });

  it("D3 sendTemplate retourne ok=false → audit skipped reason=send_failed, sent NON incrémenté", async () => {
    const order = makeOrder();
    responses.orders = [
      { data: [order], error: null },
      { data: [], error: null },
    ];
    responses.reviews = [{ data: null, error: null }];
    responses.orders_update = [{ data: [{ id: "order-1" }], error: null }];
    vi.mocked(sendTemplate).mockResolvedValueOnce({
      ok: false,
      error: "send_failed",
    });

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { j2: { sent: number } };
    expect(body.j2.sent).toBe(0);

    const skipped = findAuditEvents("review_followup_skipped");
    expect(skipped.length).toBeGreaterThanOrEqual(1);
    expect(
      (skipped[0]![0] as { metadata?: Record<string, unknown> }).metadata
        ?.reason,
    ).toBe("send_failed");
  });
});

// --- E. Dedup race-safe -----------------------------------------------

describe("POST /api/cron/review-followup — dedup race-safe", () => {
  it("E1 UPDATE claimed=[] (concurrent perdu) → audit dedup_blocked, pas de send", async () => {
    const order = makeOrder();
    responses.orders = [
      { data: [order], error: null },
      { data: [], error: null },
    ];
    responses.reviews = [{ data: null, error: null }];
    // claim concurrent perdue : data: []
    responses.orders_update = [{ data: [], error: null }];

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();

    expect(findAuditEvents("review_followup_dedup_blocked")).toHaveLength(1);
    const body = (await res.json()) as { j2: { dedup_blocked: number } };
    expect(body.j2.dedup_blocked).toBe(1);
  });
});

// --- F. Refacto N+1 → embeds PostgREST + mapWithConcurrency (F-020) ----

describe("POST /api/cron/review-followup — F-020 perf", () => {
  it("F1 SELECT initial orders inclut embeds consumer + producer (1 query au lieu de 1+2N)", async () => {
    responses.orders = [
      { data: [], error: null },
      { data: [], error: null },
    ];

    await POST(makeRequest({ auth: "Bearer test-secret" }));

    // 2 SELECT sur orders (un par batch J-2 + J-7), tous deux avec embeds.
    const ordersSelects = captured.selectCols.filter((s) => s.table === "orders");
    expect(ordersSelects).toHaveLength(2);
    for (const s of ordersSelects) {
      expect(s.cols).toMatch(/consumer:consumer_id\s*\(\s*email\s*\)/);
      expect(s.cols).toMatch(
        /producer:producer_id\s*\(\s*nom_exploitation\s*\)/,
      );
    }

    // Plus aucun SELECT séparé sur `users` ou `producers` (data fetchée
    // via embeds dans la query principale).
    const usersFroms = captured.from.filter((t) => t === "users");
    const producersFroms = captured.from.filter((t) => t === "producers");
    expect(usersFroms).toHaveLength(0);
    expect(producersFroms).toHaveLength(0);
  });

  it("F2 batch de N orders → 1 query principale par batch + N envois en parallèle borné", async () => {
    // 8 orders dans la fenêtre J-2 : la concurrence cap=5 ne doit pas casser
    // le pattern. On vérifie que tous les sendTemplate sont appelés et que
    // chaque order a son audit sent_d2.
    const orders = Array.from({ length: 8 }, (_, i) =>
      makeOrder({ id: `order-${i}`, code_commande: `TRR-X${i}` }),
    );
    responses.orders = [
      { data: orders, error: null }, // J-2
      { data: [], error: null }, // J-7
    ];
    responses.reviews = Array.from({ length: 8 }, () => ({
      data: null,
      error: null,
    }));
    responses.orders_update = orders.map((o) => ({
      data: [{ id: o.id }],
      error: null,
    }));

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { j2: { sent: number } };
    expect(body.j2.sent).toBe(8);
    expect(vi.mocked(sendTemplate)).toHaveBeenCalledTimes(8);
    expect(findAuditEvents("review_followup_sent_d2")).toHaveLength(8);
  });
});
