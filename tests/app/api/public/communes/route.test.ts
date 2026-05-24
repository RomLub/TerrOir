import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ consume: vi.fn(), fetchCommunes: vi.fn() }));

vi.mock("@/lib/rate-limit", () => ({
  getGeocodeRateLimit: () => ({}),
  consumeRateLimit: () => h.consume(),
}));
vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  extractRequestContext: () => ({ ipAddress: "1.2.3.4" }),
}));
vi.mock("@/lib/geo/communes-by-postal", () => ({
  fetchCommunesByPostalCode: h.fetchCommunes,
}));

import { POST } from "@/app/api/public/communes/route";

function req(body: unknown): Request {
  return new Request("http://localhost/api/public/communes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.consume.mockResolvedValue({ success: true });
});

describe("POST /api/public/communes", () => {
  it("CP invalide → 400, pas d'appel à l'API gouv", async () => {
    const res = await POST(req({ cp: "72" }));
    expect(res.status).toBe(400);
    expect(h.fetchCommunes).not.toHaveBeenCalled();
  });

  it("succès → 200 + communes", async () => {
    h.fetchCommunes.mockResolvedValueOnce({ ok: true, communes: ["Le Mans"] });
    const res = await POST(req({ cp: "72000" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, communes: ["Le Mans"] });
  });

  it("not_found → 404", async () => {
    h.fetchCommunes.mockResolvedValueOnce({ ok: false, code: "not_found" });
    const res = await POST(req({ cp: "99999" }));
    expect(res.status).toBe(404);
  });

  it("rate-limit dépassé → 429, pas d'appel gouv", async () => {
    h.consume.mockResolvedValueOnce({ success: false });
    const res = await POST(req({ cp: "72000" }));
    expect(res.status).toBe(429);
    expect(h.fetchCommunes).not.toHaveBeenCalled();
  });

  it("DOCTRINE garde-fou-cp : ne logue jamais le CP saisi", async () => {
    h.fetchCommunes.mockResolvedValueOnce({ ok: true, communes: ["Le Mans"] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await POST(req({ cp: "72000" }));
    for (const spy of [logSpy, warnSpy, errSpy]) {
      for (const call of spy.mock.calls) {
        expect(call.join(" ")).not.toContain("72000");
      }
    }
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });
});
