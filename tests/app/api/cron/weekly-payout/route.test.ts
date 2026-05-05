// Tests vitest pour POST /api/cron/weekly-payout — audit RPC M-1
// Smoke test : auth + envoi parallèle borné via mapWithConcurrency.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/stripe/payouts", () => ({
  processWeeklyPayouts: vi.fn(),
}));

vi.mock("@/lib/resend/send", () => ({
  sendTemplate: vi.fn(),
}));

vi.mock("@/lib/resend/templates/payout-summary", () => ({
  default: () => null,
  subject: () => "Récap virements",
}));

import { POST } from "@/app/api/cron/weekly-payout/route";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { processWeeklyPayouts } from "@/lib/stripe/payouts";
import { sendTemplate } from "@/lib/resend/send";

function buildClient(opts: {
  producerByProducerId?: Record<string, { nom_exploitation: string; user_id: string } | null>;
  userByUserId?: Record<string, { email: string } | null>;
} = {}): SupabaseClient {
  return {
    from: (table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      let lastEqVal: string | null = null;
      b.select = () => b;
      b.eq = (_col: string, val: string) => {
        lastEqVal = val;
        return b;
      };
      b.maybeSingle = () => {
        if (table === "producers") {
          return Promise.resolve({
            data: opts.producerByProducerId?.[lastEqVal ?? ""] ?? null,
            error: null,
          });
        }
        if (table === "users") {
          return Promise.resolve({
            data: opts.userByUserId?.[lastEqVal ?? ""] ?? null,
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

function makeRequest(opts: { auth?: string } = {}): Request {
  const headers = new Headers();
  if (opts.auth) headers.set("authorization", opts.auth);
  return new Request("http://localhost/api/cron/weekly-payout", {
    method: "POST",
    headers,
  });
}

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  vi.mocked(createSupabaseAdminClient).mockReset();
  vi.mocked(processWeeklyPayouts).mockReset();
  vi.mocked(sendTemplate).mockReset();
  vi.mocked(sendTemplate).mockResolvedValue({ ok: true, id: "email_id" });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_CRON_SECRET === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  }
});

const FAKE_DATES = {
  start: new Date("2026-04-21T00:00:00.000Z"),
  end: new Date("2026-04-27T23:59:59.999Z"),
};

describe("POST /api/cron/weekly-payout — auth", () => {
  it("401 sans header", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(processWeeklyPayouts).not.toHaveBeenCalled();
  });

  it("401 sur Bearer wrong", async () => {
    const res = await POST(makeRequest({ auth: "Bearer wrong" }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/cron/weekly-payout — envoi parallèle", () => {
  it("3 results valides → sendTemplate appelé 3×, emailed=3 (mapWithConcurrency cap 5)", async () => {
    vi.mocked(processWeeklyPayouts).mockResolvedValue({
      start: FAKE_DATES.start,
      end: FAKE_DATES.end,
      results: [
        {
          producer_id: "prod-1",
          payout_id: "po-1",
          stripe_transfer_id: "tr_1",
          orders: [],
          montantBrut: 100,
          commission: 10,
          montantNet: 90,
          periodeDebut: "2026-04-21",
          periodeFin: "2026-04-27",
        },
        {
          producer_id: "prod-2",
          payout_id: "po-2",
          stripe_transfer_id: "tr_2",
          orders: [],
          montantBrut: 200,
          commission: 20,
          montantNet: 180,
          periodeDebut: "2026-04-21",
          periodeFin: "2026-04-27",
        },
        {
          producer_id: "prod-3",
          payout_id: "po-3",
          stripe_transfer_id: "tr_3",
          orders: [],
          montantBrut: 300,
          commission: 30,
          montantNet: 270,
          periodeDebut: "2026-04-21",
          periodeFin: "2026-04-27",
        },
      ],
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      buildClient({
        producerByProducerId: {
          "prod-1": { nom_exploitation: "F1", user_id: "u1" },
          "prod-2": { nom_exploitation: "F2", user_id: "u2" },
          "prod-3": { nom_exploitation: "F3", user_id: "u3" },
        },
        userByUserId: {
          u1: { email: "p1@test.fr" },
          u2: { email: "p2@test.fr" },
          u3: { email: "p3@test.fr" },
        },
      }),
    );

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(sendTemplate)).toHaveBeenCalledTimes(3);
    const body = await res.json();
    expect(body.processed).toBe(3);
    expect(body.emailed).toBe(3);
  });

  it("skip already_exists et error (pas de sendTemplate)", async () => {
    vi.mocked(processWeeklyPayouts).mockResolvedValue({
      start: FAKE_DATES.start,
      end: FAKE_DATES.end,
      results: [
        {
          producer_id: "prod-skip",
          payout_id: "po-skip",
          stripe_transfer_id: null,
          orders: [],
          montantBrut: 0,
          commission: 0,
          montantNet: 0,
          periodeDebut: "2026-04-21",
          periodeFin: "2026-04-27",
          skipped: "already_exists",
        },
        {
          producer_id: "prod-err",
          payout_id: null,
          stripe_transfer_id: null,
          orders: [],
          montantBrut: 0,
          commission: 0,
          montantNet: 0,
          periodeDebut: "2026-04-21",
          periodeFin: "2026-04-27",
          error: "transfer failed",
        },
      ],
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(buildClient());

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.emailed).toBe(0);
    expect(body.processed).toBe(2);
  });

  it("producer sans user_id → skip silencieux, pas de sendTemplate", async () => {
    vi.mocked(processWeeklyPayouts).mockResolvedValue({
      start: FAKE_DATES.start,
      end: FAKE_DATES.end,
      results: [
        {
          producer_id: "prod-orphan",
          payout_id: "po-orphan",
          stripe_transfer_id: "tr_orphan",
          orders: [],
          montantBrut: 50,
          commission: 5,
          montantNet: 45,
          periodeDebut: "2026-04-21",
          periodeFin: "2026-04-27",
        },
      ],
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      buildClient({
        producerByProducerId: { "prod-orphan": null },
      }),
    );

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.emailed).toBe(0);
  });
});
