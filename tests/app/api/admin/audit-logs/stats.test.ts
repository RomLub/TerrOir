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

vi.mock("@/lib/audit-logs/stats", () => ({
  getAuditLogStats: mockGetStats,
}));

import { GET } from "@/app/api/admin/audit-logs/stats/route";

beforeEach(() => {
  sessionUser = {
    id: "admin-1",
    email: "admin@example.com",
    roles: [],
    isAdmin: true,
  };
  mockGetStats.mockReset();
});

describe("GET /api/admin/audit-logs/stats", () => {
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

  it("retourne stats JSON 200 + Cache-Control private max-age=60 (sec-P2-5)", async () => {
    mockGetStats.mockResolvedValue({
      todayCount: 5,
      last7daysCount: 60,
      topEventType7d: { eventType: "account_login_password", count: 30 },
      failed7dCount: 2,
    });
    const res = await GET();
    expect(res.status).toBe(200);
    // sec-P2-5 (T9 2026-05-07) : cache HTTP browser-side 60s pour réduire
    // charge DB sur dashboard admin (4 count agrégés + fetch 50k lignes).
    // `private` interdit cache CDN/proxy partagé.
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
    const body = await res.json();
    expect(body).toEqual({
      todayCount: 5,
      last7daysCount: 60,
      topEventType7d: { eventType: "account_login_password", count: 30 },
      failed7dCount: 2,
    });
  });

  it("erreur helper → 500 stats_unavailable", async () => {
    mockGetStats.mockRejectedValue(new Error("boom"));
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("stats_unavailable");
  });
});
