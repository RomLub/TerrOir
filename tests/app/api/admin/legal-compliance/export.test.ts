// Tests vitest pour GET /api/admin/legal-compliance/export.
// Couvre : auth admin, format CSV (BOM + header + rows), filename
// (avec/sans _filtered selon filtres), audit log fail-safe.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

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

const { mockListUsers, mockLogLegal } = vi.hoisted(() => ({
  mockListUsers: vi.fn(),
  mockLogLegal: vi.fn(),
}));

vi.mock("@/lib/legal/compliance", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/legal/compliance")
  >("@/lib/legal/compliance");
  return {
    ...actual,
    listUsersWithCGUStatus: mockListUsers,
  };
});

vi.mock("@/lib/audit-logs/log-legal-event", () => ({
  logLegalEvent: mockLogLegal,
}));

import { GET } from "@/app/api/admin/legal-compliance/export/route";

function makeRequest(qs = ""): NextRequest {
  return new NextRequest(
    `https://admin.terroir-local.fr/api/admin/legal-compliance/export${qs}`,
  );
}

const ADMIN_ID = "dddddddd-dddd-4ddd-dddd-dddddddddddd";

beforeEach(() => {
  sessionUser = {
    id: ADMIN_ID,
    email: "admin@example.com",
    roles: [],
    isAdmin: true,
  };
  mockListUsers.mockReset();
  mockLogLegal.mockReset();
  mockListUsers.mockResolvedValue({
    users: [],
    total: 0,
    page: 1,
    totalPages: 1,
  });
  mockLogLegal.mockResolvedValue(undefined);
  // Date figée pour la stabilité du filename.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-06T12:00:00Z"));
});

describe("GET /api/admin/legal-compliance/export — auth", () => {
  it("session absente → 403", async () => {
    sessionUser = null;
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    vi.useRealTimers();
  });

  it("non-admin → 403", async () => {
    sessionUser = {
      id: "u",
      email: "u@x",
      roles: ["consumer"],
      isAdmin: false,
    };
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    vi.useRealTimers();
  });
});

describe("GET /api/admin/legal-compliance/export — CSV body + filename", () => {
  it("sans filtres : filename basique + BOM + header", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="legal-compliance_2026-05-06.csv"',
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    const text = new TextDecoder("utf-8").decode(bytes);
    expect(text).toContain(
      "user_id;email;prenom;nom;created_at;cgu_status;cgu_accepted_at;cgu_version",
    );
    vi.useRealTimers();
  });

  it("avec status=never_accepted : filename _filtered + helper reçoit le filtre", async () => {
    mockListUsers.mockResolvedValue({
      users: [
        {
          id: "u1",
          email: "old@example.com",
          prenom: null,
          nom: null,
          createdAt: "2026-01-01T00:00:00Z",
          status: "never_accepted" as const,
          acceptedAt: null,
          acceptedVersion: null,
          daysSinceAcceptance: null,
        },
      ],
      total: 11,
      page: 1,
      totalPages: 1,
    });
    const res = await GET(makeRequest("?status=never_accepted"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="legal-compliance_2026-05-06_filtered.csv"',
    );
    expect(mockListUsers).toHaveBeenCalledWith(
      expect.objectContaining({ status: "never_accepted" }),
    );
    const text = await res.text();
    expect(text).toContain("u1;old@example.com;;;2026-01-01T00:00:00Z;never_accepted;;");
    vi.useRealTimers();
  });

  it("avec search : filename _filtered", async () => {
    const res = await GET(makeRequest("?search=admin"));
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="legal-compliance_2026-05-06_filtered.csv"',
    );
    expect(mockListUsers).toHaveBeenCalledWith(
      expect.objectContaining({ search: "admin" }),
    );
    vi.useRealTimers();
  });
});

describe("GET /api/admin/legal-compliance/export — audit log", () => {
  it("émet admin_legal_compliance_exported avec metadata", async () => {
    mockListUsers.mockResolvedValue({
      users: Array.from({ length: 3 }, (_, i) => ({
        id: `u${i}`,
        email: `u${i}@example.com`,
        prenom: null,
        nom: null,
        createdAt: "2026-05-01T00:00:00Z",
        status: "never_accepted" as const,
        acceptedAt: null,
        acceptedVersion: null,
        daysSinceAcceptance: null,
      })),
      total: 3,
      page: 1,
      totalPages: 1,
    });
    await GET(makeRequest("?status=never_accepted&search=foo"));
    expect(mockLogLegal).toHaveBeenCalledWith({
      eventType: "admin_legal_compliance_exported",
      userId: ADMIN_ID,
      metadata: {
        status: "never_accepted",
        search: "foo",
        count: 3,
        truncated: false,
      },
    });
    vi.useRealTimers();
  });

  it("search vide = null en metadata", async () => {
    await GET(makeRequest());
    expect(mockLogLegal).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ search: null }),
      }),
    );
    vi.useRealTimers();
  });
});

describe("GET /api/admin/legal-compliance/export — erreur", () => {
  it("erreur helper → 500", async () => {
    mockListUsers.mockRejectedValue(new Error("boom"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("boom");
    vi.useRealTimers();
  });
});
