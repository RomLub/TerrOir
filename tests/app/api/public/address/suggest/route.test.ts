import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ consume: vi.fn(), fetchSuggest: vi.fn() }));

vi.mock("@/lib/rate-limit", () => ({
  getGeocodeRateLimit: () => ({}),
  consumeRateLimit: () => h.consume(),
}));
vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  extractRequestContext: () => ({ ipAddress: "1.2.3.4" }),
}));
vi.mock("@/lib/geo/address-suggestions", () => ({
  fetchAddressSuggestions: h.fetchSuggest,
}));

import { POST } from "@/app/api/public/address/suggest/route";

function req(body: unknown): Request {
  return new Request("http://localhost/api/public/address/suggest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.consume.mockResolvedValue({ success: true });
});

describe("POST /api/public/address/suggest", () => {
  it("q trop court → 400, pas d'appel API", async () => {
    const res = await POST(req({ q: "ru", cp: "72000" }));
    expect(res.status).toBe(400);
    expect(h.fetchSuggest).not.toHaveBeenCalled();
  });

  it("cp invalide → 400, pas d'appel API", async () => {
    const res = await POST(req({ q: "1 rue de la", cp: "72" }));
    expect(res.status).toBe(400);
    expect(h.fetchSuggest).not.toHaveBeenCalled();
  });

  it("succès → 200 + suggestions", async () => {
    h.fetchSuggest.mockResolvedValueOnce({
      ok: true,
      suggestions: [{ label: "1 Rue X 72000 Le Mans", name: "1 Rue X" }],
    });
    const res = await POST(req({ q: "1 rue x", cp: "72000" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      suggestions: [{ label: "1 Rue X 72000 Le Mans", name: "1 Rue X" }],
    });
  });

  it("erreur amont → 502", async () => {
    h.fetchSuggest.mockResolvedValueOnce({ ok: false, code: "network" });
    const res = await POST(req({ q: "1 rue x", cp: "72000" }));
    expect(res.status).toBe(502);
  });

  it("rate-limit dépassé → 429, pas d'appel API", async () => {
    h.consume.mockResolvedValueOnce({ success: false });
    const res = await POST(req({ q: "1 rue x", cp: "72000" }));
    expect(res.status).toBe(429);
    expect(h.fetchSuggest).not.toHaveBeenCalled();
  });

  it("DOCTRINE garde-fou-cp : ne logue jamais la saisie (q ni cp)", async () => {
    h.fetchSuggest.mockResolvedValueOnce({ ok: true, suggestions: [] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await POST(req({ q: "12 rue secrete", cp: "72190" }));
    for (const spy of [logSpy, warnSpy, errSpy]) {
      for (const call of spy.mock.calls) {
        expect(call.join(" ")).not.toContain("72190");
        expect(call.join(" ")).not.toContain("secrete");
      }
    }
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });
});
