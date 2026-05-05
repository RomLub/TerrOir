// Tests vitest pour /api/stock-alerts/confirm — 2-step pattern :
//   GET  → renvoie HTML avec form POST (pas d'effet DB)
//   POST → exécute confirmStockAlert + redirect 303 vers /alertes-stock/confirm?status=…

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

const { mockConfirmStockAlert } = vi.hoisted(() => ({
  mockConfirmStockAlert: vi.fn(),
}));

vi.mock("@/lib/stock-alerts/confirm-alert", () => ({
  confirmStockAlert: mockConfirmStockAlert,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({}),
}));

import { GET, POST } from "@/app/api/stock-alerts/confirm/route";

beforeEach(() => {
  mockConfirmStockAlert.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeGetRequest(token: string | null): Request {
  const url = token
    ? `http://localhost/api/stock-alerts/confirm?token=${encodeURIComponent(token)}`
    : `http://localhost/api/stock-alerts/confirm`;
  return new Request(url);
}

function makePostRequest(token: string | null): Request {
  const body = new URLSearchParams();
  if (token !== null) body.set("token", token);
  return new Request("http://localhost/api/stock-alerts/confirm", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

function getRedirectStatus(res: Response): string | null {
  const loc = res.headers.get("location");
  if (!loc) return null;
  const url = new URL(loc);
  return url.searchParams.get("status");
}

describe("GET /api/stock-alerts/confirm — page HTML 2-step (pas d'effet DB)", () => {
  it("renvoie 200 HTML, pas d'appel helper, token présent dans le form", async () => {
    const res = await GET(makeGetRequest("VALIDTOKEN"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<form");
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/api/stock-alerts/confirm"');
    expect(html).toContain('value="VALIDTOKEN"');
    expect(mockConfirmStockAlert).not.toHaveBeenCalled();
  });

  it("token absent → page HTML quand même, input hidden vide", async () => {
    const res = await GET(makeGetRequest(null));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('value=""');
    expect(mockConfirmStockAlert).not.toHaveBeenCalled();
  });

  it("token avec caractères spéciaux → escapé dans le HTML", async () => {
    const res = await GET(makeGetRequest('"><script>alert(1)</script>'));
    const html = await res.text();
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&quot;");
    expect(html).toContain("&lt;script&gt;");
  });

  it("response no-store + noindex (anti-cache prefetch + anti-indexation)", async () => {
    const res = await GET(makeGetRequest("X"));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
});

describe("POST /api/stock-alerts/confirm — exécute l'effet", () => {
  it("token absent → helper appelé avec '' → redirect status:invalid_token", async () => {
    mockConfirmStockAlert.mockResolvedValueOnce({
      ok: false,
      error: "invalid_token",
    });
    const res = await POST(makePostRequest(null));
    expect(res.status).toBe(303);
    expect(getRedirectStatus(res)).toBe("invalid_token");
    expect(mockConfirmStockAlert).toHaveBeenCalledWith(expect.anything(), "");
  });

  it("helper success (already_confirmed=false) → redirect status:success", async () => {
    mockConfirmStockAlert.mockResolvedValueOnce({
      ok: true,
      data: { id: "a1", product_id: "p1", already_confirmed: false },
    });
    const res = await POST(makePostRequest("VALIDTOKEN"));
    expect(res.status).toBe(303);
    expect(getRedirectStatus(res)).toBe("success");
  });

  it("helper success (already_confirmed=true) → idempotence → status:already_confirmed", async () => {
    mockConfirmStockAlert.mockResolvedValueOnce({
      ok: true,
      data: { id: "a1", product_id: "p1", already_confirmed: true },
    });
    const res = await POST(makePostRequest("VALIDTOKEN"));
    expect(res.status).toBe(303);
    expect(getRedirectStatus(res)).toBe("already_confirmed");
  });

  it("helper invalid_token → redirect status:invalid_token", async () => {
    mockConfirmStockAlert.mockResolvedValueOnce({
      ok: false,
      error: "invalid_token",
    });
    const res = await POST(makePostRequest("BAD"));
    expect(getRedirectStatus(res)).toBe("invalid_token");
  });

  it("helper expired → redirect status:expired", async () => {
    mockConfirmStockAlert.mockResolvedValueOnce({
      ok: false,
      error: "expired",
    });
    const res = await POST(makePostRequest("OLDTOKEN"));
    expect(getRedirectStatus(res)).toBe("expired");
  });

  it("helper unsubscribed → redirect status:unsubscribed", async () => {
    mockConfirmStockAlert.mockResolvedValueOnce({
      ok: false,
      error: "unsubscribed",
    });
    const res = await POST(makePostRequest("X"));
    expect(getRedirectStatus(res)).toBe("unsubscribed");
  });

  it("helper db_error → redirect status:invalid (masque l'erreur)", async () => {
    mockConfirmStockAlert.mockResolvedValueOnce({
      ok: false,
      error: "db_error",
    });
    const res = await POST(makePostRequest("X"));
    expect(getRedirectStatus(res)).toBe("invalid");
  });

  it("redirect pointe vers /alertes-stock/confirm", async () => {
    mockConfirmStockAlert.mockResolvedValueOnce({
      ok: true,
      data: { id: "a1", product_id: "p1", already_confirmed: false },
    });
    const res = await POST(makePostRequest("X"));
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/alertes-stock/confirm");
  });
});
