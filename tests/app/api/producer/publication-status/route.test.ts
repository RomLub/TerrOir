import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getPublicationStatus: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/lib/producers/publication-status", () => ({
  getPublicationStatus: mocks.getPublicationStatus,
}));

import { GET } from "@/app/api/producer/publication-status/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/producer/publication-status", () => {
  it("401 sans session", async () => {
    mocks.getSessionUser.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("200 + statut pour un producteur connecté", async () => {
    mocks.getSessionUser.mockResolvedValueOnce({ id: "u1" });
    mocks.getPublicationStatus.mockResolvedValueOnce({
      found: true,
      allOk: false,
      criteria: {},
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(mocks.getPublicationStatus).toHaveBeenCalledWith("u1");
  });
});
