// Tests vitest pour GET /api/stock-alerts/unsubscribe.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

vi.mock("server-only", () => ({}));

const { mockUnsubscribeStockAlert } = vi.hoisted(() => ({
  mockUnsubscribeStockAlert: vi.fn(),
}));

vi.mock("@/lib/stock-alerts/unsubscribe-alert", () => ({
  unsubscribeStockAlert: mockUnsubscribeStockAlert,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({}),
}));

import { GET } from "@/app/api/stock-alerts/unsubscribe/route";

beforeEach(() => {
  mockUnsubscribeStockAlert.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeRequest(token: string | null): Request {
  const url = token
    ? `http://localhost/api/stock-alerts/unsubscribe?token=${encodeURIComponent(token)}`
    : `http://localhost/api/stock-alerts/unsubscribe`;
  return new Request(url);
}

function getRedirectStatus(res: Response): string | null {
  const loc = res.headers.get("location");
  if (!loc) return null;
  const url = new URL(loc);
  return url.searchParams.get("status");
}

describe("GET /api/stock-alerts/unsubscribe", () => {
  it("token absent → helper appelé avec '' → invalid_token", async () => {
    mockUnsubscribeStockAlert.mockResolvedValueOnce({
      ok: false,
      error: "invalid_token",
    });
    const res = await GET(makeRequest(null));
    expect(res.status).toBe(303);
    expect(getRedirectStatus(res)).toBe("invalid_token");
  });

  it("helper success (already_unsubscribed=false) → redirect status:success", async () => {
    mockUnsubscribeStockAlert.mockResolvedValueOnce({
      ok: true,
      data: { id: "a1", product_id: "p1", already_unsubscribed: false },
    });
    const res = await GET(makeRequest("X"));
    expect(getRedirectStatus(res)).toBe("success");
  });

  it("helper success (already_unsubscribed=true) → redirect status:already_unsubscribed", async () => {
    mockUnsubscribeStockAlert.mockResolvedValueOnce({
      ok: true,
      data: { id: "a1", product_id: "p1", already_unsubscribed: true },
    });
    const res = await GET(makeRequest("X"));
    expect(getRedirectStatus(res)).toBe("already_unsubscribed");
  });

  it("helper invalid_token → redirect status:invalid_token", async () => {
    mockUnsubscribeStockAlert.mockResolvedValueOnce({
      ok: false,
      error: "invalid_token",
    });
    const res = await GET(makeRequest("BAD"));
    expect(getRedirectStatus(res)).toBe("invalid_token");
  });

  it("helper db_error → redirect status:invalid", async () => {
    mockUnsubscribeStockAlert.mockResolvedValueOnce({
      ok: false,
      error: "db_error",
    });
    const res = await GET(makeRequest("X"));
    expect(getRedirectStatus(res)).toBe("invalid");
  });

  it("redirect pointe vers /alertes-stock/unsubscribe", async () => {
    mockUnsubscribeStockAlert.mockResolvedValueOnce({
      ok: true,
      data: { id: "a1", product_id: "p1", already_unsubscribed: false },
    });
    const res = await GET(makeRequest("X"));
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/alertes-stock/unsubscribe");
  });
});
