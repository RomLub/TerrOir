import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase admin avec thenable builder : chaque chain method retourne le
// même objet, le terminal `await` résolve à mockResponse (pattern aligné
// LESSONS Tests vitest mocks Supabase thenable).
type MockResponse = {
  data: { created_at: string }[] | null;
  error: { message: string } | null;
};

let mockResponse: MockResponse = { data: [], error: null };

vi.mock("@/lib/supabase/admin", () => {
  const makeThenable = (): unknown => {
    type ChainMethod = () => unknown;
    const t: Record<string, unknown> = {};
    const chain: ChainMethod = () => t;
    t.from = chain;
    t.select = chain;
    t.eq = chain;
    t.gte = chain;
    t.order = chain;
    t.then = (onFulfilled: (v: MockResponse) => unknown) =>
      onFulfilled(mockResponse);
    return t;
  };
  return {
    createSupabaseAdminClient: () => makeThenable(),
  };
});

import { checkOtpRateLimit } from "@/lib/email-change/rate-limit";

beforeEach(() => {
  mockResponse = { data: [], error: null };
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("checkOtpRateLimit", () => {
  it("ok=true si aucune row dans la fenêtre 60s", async () => {
    mockResponse = { data: [], error: null };
    const r = await checkOtpRateLimit("user-1", "current");
    expect(r).toEqual({ ok: true });
  });

  it("ok=true avec 1 row (sous la cap)", async () => {
    mockResponse = {
      data: [{ created_at: new Date(Date.now() - 10_000).toISOString() }],
      error: null,
    };
    expect(await checkOtpRateLimit("user-1", "current")).toEqual({ ok: true });
  });

  it("ok=true avec 2 rows (sous la cap de 3)", async () => {
    mockResponse = {
      data: [
        { created_at: new Date(Date.now() - 30_000).toISOString() },
        { created_at: new Date(Date.now() - 10_000).toISOString() },
      ],
      error: null,
    };
    expect(await checkOtpRateLimit("user-1", "current")).toEqual({ ok: true });
  });

  it("ok=false avec 3 rows : retryAfterSeconds calculé depuis le plus ancien", async () => {
    const oldestAgo = 30_000; // 30s ago, donc retry dans ~30s
    mockResponse = {
      data: [
        { created_at: new Date(Date.now() - oldestAgo).toISOString() },
        { created_at: new Date(Date.now() - 20_000).toISOString() },
        { created_at: new Date(Date.now() - 10_000).toISOString() },
      ],
      error: null,
    };
    const r = await checkOtpRateLimit("user-1", "current");
    if (r.ok) throw new Error("expected blocked");
    expect(r.retryAfterSeconds).toBeGreaterThanOrEqual(28);
    expect(r.retryAfterSeconds).toBeLessThanOrEqual(31);
  });

  it("ok=false avec 4 rows (au-dessus de la cap) : retryAfter calculé depuis le plus ancien", async () => {
    mockResponse = {
      data: [
        { created_at: new Date(Date.now() - 50_000).toISOString() },
        { created_at: new Date(Date.now() - 30_000).toISOString() },
        { created_at: new Date(Date.now() - 20_000).toISOString() },
        { created_at: new Date(Date.now() - 5_000).toISOString() },
      ],
      error: null,
    };
    const r = await checkOtpRateLimit("user-1", "current");
    if (r.ok) throw new Error("expected blocked");
    // retry = 60 - 50 = ~10s
    expect(r.retryAfterSeconds).toBeGreaterThanOrEqual(8);
    expect(r.retryAfterSeconds).toBeLessThanOrEqual(11);
  });

  it("retryAfterSeconds = 0 si plus ancien tout juste hors fenêtre (race query/calcul)", async () => {
    // Edge case : la query DB filtre côté SQL par created_at >= cutoff. Si
    // entre la query et le calcul ici la 1re row passe sous le cutoff,
    // expiresAtMs - Date.now() devient négatif → clamp à 0.
    mockResponse = {
      data: [
        { created_at: new Date(Date.now() - 60_500).toISOString() },
        { created_at: new Date(Date.now() - 30_000).toISOString() },
        { created_at: new Date(Date.now() - 10_000).toISOString() },
      ],
      error: null,
    };
    const r = await checkOtpRateLimit("user-1", "current");
    if (r.ok) throw new Error("expected blocked");
    expect(r.retryAfterSeconds).toBe(0);
  });

  it("fail-open + console.warn si la DB renvoie une error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockResponse = { data: null, error: { message: "connection refused" } };
    const r = await checkOtpRateLimit("user-1", "current");
    expect(r).toEqual({ ok: true });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("OTP_RATE_LIMIT_DB_WARN"),
    );
  });

  it("fail-open : warn inclut user et step pour forensique", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockResponse = { data: null, error: { message: "timeout" } };
    await checkOtpRateLimit("user-42", "new");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("user=user-42"),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("step=new"));
  });

  it("data null sans error → traité comme array vide (ok=true)", async () => {
    mockResponse = { data: null, error: null };
    expect(await checkOtpRateLimit("user-1", "current")).toEqual({ ok: true });
  });
});
