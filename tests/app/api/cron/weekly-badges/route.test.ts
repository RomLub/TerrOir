// Tests vitest pour POST/GET /api/cron/weekly-badges (T-417).
// Boucle producers actifs + appel direct au helper recompute-badges
// (suppression de l'ancien proxy fetch HTTP interne avec Bearer manuel).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/producers/recompute-badges", () => ({
  recomputeBadgesForProducer: vi.fn(),
}));

import { POST } from "@/app/api/cron/weekly-badges/route";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recomputeBadgesForProducer } from "@/lib/producers/recompute-badges";

type SelectResp = {
  data?: unknown;
  error?: { message: string } | null;
};

interface Control {
  selectProducers?: SelectResp;
}

function buildClient(ctrl: Control = {}): SupabaseClient {
  return {
    from: (_table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      b.select = () => b;
      b.eq = () => Promise.resolve(ctrl.selectProducers ?? { data: [], error: null });
      return b;
    },
  } as unknown as SupabaseClient;
}

function makeRequest(opts: { auth?: string } = {}): Request {
  const headers = new Headers();
  if (opts.auth) headers.set("authorization", opts.auth);
  return new Request("http://localhost/api/cron/weekly-badges", {
    method: "POST",
    headers,
  });
}

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  vi.mocked(createSupabaseAdminClient).mockReset();
  vi.mocked(recomputeBadgesForProducer).mockReset();
});

afterEach(() => {
  if (ORIGINAL_CRON_SECRET === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  }
});

describe("POST /api/cron/weekly-badges — auth", () => {
  it("returns 401 when authorization header missing", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(vi.mocked(recomputeBadgesForProducer)).not.toHaveBeenCalled();
  });

  it("returns 401 on wrong Bearer", async () => {
    const res = await POST(makeRequest({ auth: "Bearer wrong" }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/cron/weekly-badges — boucle nominal", () => {
  it("3 producers actifs → 3 appels helper, processed=3, errors=[]", async () => {
    const client = buildClient({
      selectProducers: {
        data: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
        error: null,
      },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
    vi.mocked(recomputeBadgesForProducer).mockResolvedValue({
      producer_id: "p?",
      total_orders: 5,
      badge_stock_score: 100,
      badge_confirmation_score: 100,
      badge_annulation_score: 100,
    });

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);

    expect(vi.mocked(recomputeBadgesForProducer)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(recomputeBadgesForProducer)).toHaveBeenCalledWith(client, "p1");
    expect(vi.mocked(recomputeBadgesForProducer)).toHaveBeenCalledWith(client, "p2");
    expect(vi.mocked(recomputeBadgesForProducer)).toHaveBeenCalledWith(client, "p3");

    const body = await res.json();
    expect(body).toEqual({ processed: 3, errors: [] });
  });

  it("aucun producer actif → processed=0, errors=[]", async () => {
    const client = buildClient({
      selectProducers: { data: [], error: null },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(recomputeBadgesForProducer)).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ processed: 0, errors: [] });
  });
});

describe("POST /api/cron/weekly-badges — agrégation errors", () => {
  it("batch mixte (2 OK + 1 error helper.error) → processed=2, errors=1", async () => {
    const client = buildClient({
      selectProducers: {
        data: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
        error: null,
      },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
    vi.mocked(recomputeBadgesForProducer)
      .mockResolvedValueOnce({
        producer_id: "p1",
        total_orders: 1,
        badge_stock_score: 100,
        badge_confirmation_score: 100,
        badge_annulation_score: 100,
      })
      .mockResolvedValueOnce({
        producer_id: "p2",
        error: "RLS denied",
      })
      .mockResolvedValueOnce({
        producer_id: "p3",
        reason: "no_orders",
      });

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.processed).toBe(2); // p1 + p3 (no_orders compte comme processed)
    expect(body.errors).toEqual([{ producer_id: "p2", error: "RLS denied" }]);
  });

  it("batch mixte (1 OK + 1 throw exception) → processed=1, errors=1 message exception", async () => {
    const client = buildClient({
      selectProducers: {
        data: [{ id: "p1" }, { id: "p2" }],
        error: null,
      },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
    vi.mocked(recomputeBadgesForProducer)
      .mockResolvedValueOnce({
        producer_id: "p1",
        total_orders: 1,
        badge_stock_score: 100,
        badge_confirmation_score: 100,
        badge_annulation_score: 100,
      })
      .mockRejectedValueOnce(new Error("network timeout"));

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.processed).toBe(1);
    expect(body.errors).toEqual([{ producer_id: "p2", error: "network timeout" }]);
  });

  it("SELECT producers error → 500", async () => {
    const client = buildClient({
      selectProducers: { data: null, error: { message: "db down" } },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "db down" });
    expect(vi.mocked(recomputeBadgesForProducer)).not.toHaveBeenCalled();
  });
});
