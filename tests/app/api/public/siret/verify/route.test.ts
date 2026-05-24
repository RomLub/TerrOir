import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ consume: vi.fn(), verify: vi.fn() }));

vi.mock("@/lib/rate-limit", () => ({
  getGeocodeRateLimit: () => ({}),
  consumeRateLimit: () => h.consume(),
}));
vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  extractRequestContext: () => ({ ipAddress: "1.2.3.4" }),
}));
vi.mock("@/lib/sirene/verify-siret", () => ({
  verifySiret: h.verify,
}));

import { POST } from "@/app/api/public/siret/verify/route";

const SIRET = "12345678901234";

function req(body: unknown): Request {
  return new Request("http://localhost/api/public/siret/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.consume.mockResolvedValue({ success: true });
});

describe("POST /api/public/siret/verify", () => {
  it("SIRET mal formé → 400, pas d'appel API", async () => {
    const res = await POST(req({ siret: "123" }));
    expect(res.status).toBe(400);
    expect(h.verify).not.toHaveBeenCalled();
  });

  it("trouvé → 200 + nom légal", async () => {
    h.verify.mockResolvedValueOnce({ ok: true, found: true, legalName: "FERME X" });
    const res = await POST(req({ siret: SIRET }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, found: true, legalName: "FERME X" });
  });

  it("introuvable → 200 found:false", async () => {
    h.verify.mockResolvedValueOnce({ ok: true, found: false });
    const res = await POST(req({ siret: SIRET }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, found: false });
  });

  it("erreur amont → 502", async () => {
    h.verify.mockResolvedValueOnce({ ok: false, code: "network" });
    const res = await POST(req({ siret: SIRET }));
    expect(res.status).toBe(502);
  });

  it("rate-limit dépassé → 429, pas d'appel API", async () => {
    h.consume.mockResolvedValueOnce({ success: false });
    const res = await POST(req({ siret: SIRET }));
    expect(res.status).toBe(429);
    expect(h.verify).not.toHaveBeenCalled();
  });
});
