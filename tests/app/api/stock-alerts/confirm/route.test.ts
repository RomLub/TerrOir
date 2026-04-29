// Tests vitest pour GET /api/stock-alerts/confirm — redirige vers la page
// publique avec un query param `status` selon le résultat helper.

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

const { mockConfirmStockAlert } = vi.hoisted(() => ({
  mockConfirmStockAlert: vi.fn(),
}));

vi.mock("@/lib/stock-alerts/confirm-alert", () => ({
  confirmStockAlert: mockConfirmStockAlert,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({}),
}));

import { GET } from "@/app/api/stock-alerts/confirm/route";

beforeEach(() => {
  mockConfirmStockAlert.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeRequest(token: string | null): Request {
  const url = token
    ? `http://localhost/api/stock-alerts/confirm?token=${encodeURIComponent(token)}`
    : `http://localhost/api/stock-alerts/confirm`;
  return new Request(url);
}

function getRedirectStatus(res: Response): string | null {
  const loc = res.headers.get("location");
  if (!loc) return null;
  const url = new URL(loc);
  return url.searchParams.get("status");
}

describe("GET /api/stock-alerts/confirm", () => {
  it("token absent → helper appelé avec '' → redirect status invalid_token", async () => {
    mockConfirmStockAlert.mockResolvedValueOnce({
      ok: false,
      error: "invalid_token",
    });
    const res = await GET(makeRequest(null));
    expect(res.status).toBe(303);
    expect(getRedirectStatus(res)).toBe("invalid_token");
    expect(mockConfirmStockAlert).toHaveBeenCalledWith(expect.anything(), "");
  });

  it("helper success (already_confirmed=false) → redirect status:success", async () => {
    mockConfirmStockAlert.mockResolvedValueOnce({
      ok: true,
      data: { id: "a1", product_id: "p1", already_confirmed: false },
    });
    const res = await GET(makeRequest("VALIDTOKEN"));
    expect(res.status).toBe(303);
    expect(getRedirectStatus(res)).toBe("success");
  });

  it("helper success (already_confirmed=true) → redirect status:already_confirmed", async () => {
    mockConfirmStockAlert.mockResolvedValueOnce({
      ok: true,
      data: { id: "a1", product_id: "p1", already_confirmed: true },
    });
    const res = await GET(makeRequest("VALIDTOKEN"));
    expect(res.status).toBe(303);
    expect(getRedirectStatus(res)).toBe("already_confirmed");
  });

  it("helper invalid_token → redirect status:invalid_token", async () => {
    mockConfirmStockAlert.mockResolvedValueOnce({
      ok: false,
      error: "invalid_token",
    });
    const res = await GET(makeRequest("BAD"));
    expect(getRedirectStatus(res)).toBe("invalid_token");
  });

  it("helper expired → redirect status:expired", async () => {
    mockConfirmStockAlert.mockResolvedValueOnce({
      ok: false,
      error: "expired",
    });
    const res = await GET(makeRequest("OLDTOKEN"));
    expect(getRedirectStatus(res)).toBe("expired");
  });

  it("helper unsubscribed → redirect status:unsubscribed", async () => {
    mockConfirmStockAlert.mockResolvedValueOnce({
      ok: false,
      error: "unsubscribed",
    });
    const res = await GET(makeRequest("X"));
    expect(getRedirectStatus(res)).toBe("unsubscribed");
  });

  it("helper db_error → redirect status:invalid (masque l'erreur)", async () => {
    mockConfirmStockAlert.mockResolvedValueOnce({
      ok: false,
      error: "db_error",
    });
    const res = await GET(makeRequest("X"));
    expect(getRedirectStatus(res)).toBe("invalid");
  });

  it("redirect pointe vers /alertes-stock/confirm", async () => {
    mockConfirmStockAlert.mockResolvedValueOnce({
      ok: true,
      data: { id: "a1", product_id: "p1", already_confirmed: false },
    });
    const res = await GET(makeRequest("X"));
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/alertes-stock/confirm");
  });
});
