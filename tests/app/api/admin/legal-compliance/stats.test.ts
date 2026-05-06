import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "test-service-role-key";
});

type SessionUser = {
  id: string;
  email: string | null;
  roles: string[];
  isAdmin: boolean;
} | null;

let sessionUser: SessionUser;
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => sessionUser,
}));

const { mockGetStats } = vi.hoisted(() => ({
  mockGetStats: vi.fn(),
}));

vi.mock("@/lib/legal/compliance", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/legal/compliance")
  >("@/lib/legal/compliance");
  return {
    ...actual,
    getCGUComplianceStats: mockGetStats,
  };
});

import { GET } from "@/app/api/admin/legal-compliance/stats/route";

beforeEach(() => {
  sessionUser = {
    id: "admin-1",
    email: "admin@example.com",
    roles: [],
    isAdmin: true,
  };
  mockGetStats.mockReset();
});

describe("GET /api/admin/legal-compliance/stats", () => {
  it("session absente → 403", async () => {
    sessionUser = null;
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("non-admin → 403", async () => {
    sessionUser = {
      id: "u",
      email: "u@x",
      roles: ["consumer"],
      isAdmin: false,
    };
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("retourne stats JSON", async () => {
    mockGetStats.mockResolvedValue({
      total: 42,
      acceptedCurrent: 31,
      acceptedOutdated: 0,
      neverAccepted: 11,
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      total: 42,
      acceptedCurrent: 31,
      acceptedOutdated: 0,
      neverAccepted: 11,
    });
  });

  it("erreur helper → 500", async () => {
    mockGetStats.mockRejectedValue(new Error("boom"));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
