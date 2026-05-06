// Tests vitest pour GET /api/admin/legal-compliance/users.
//
// Stratégie : mock getSessionUser + listUsersWithCGUStatus. La route est un
// passe-plat (parsing query → call helper → JSON), donc on n'a pas besoin
// de mocker Supabase à ce niveau ; ces couches sont déjà testées par
// tests/lib/legal/compliance.test.ts.

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

const { mockListUsers } = vi.hoisted(() => ({
  mockListUsers: vi.fn(),
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

import { GET } from "@/app/api/admin/legal-compliance/users/route";

function makeRequest(qs = ""): NextRequest {
  return new NextRequest(
    `https://admin.terroir-local.fr/api/admin/legal-compliance/users${qs}`,
  );
}

beforeEach(() => {
  sessionUser = {
    id: "admin-1",
    email: "admin@example.com",
    roles: [],
    isAdmin: true,
  };
  mockListUsers.mockReset();
  mockListUsers.mockResolvedValue({
    users: [],
    total: 0,
    page: 1,
    totalPages: 1,
  });
});

describe("GET /api/admin/legal-compliance/users — auth", () => {
  it("session absente → 403", async () => {
    sessionUser = null;
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
  });

  it("session non-admin → 403", async () => {
    sessionUser = {
      id: "u",
      email: "u@x",
      roles: ["consumer"],
      isAdmin: false,
    };
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/legal-compliance/users — query parsing", () => {
  it("status invalide → fallback 'all'", async () => {
    await GET(makeRequest("?status=__bogus__"));
    expect(mockListUsers).toHaveBeenCalledWith(
      expect.objectContaining({ status: "all" }),
    );
  });

  it("status valide passé tel quel", async () => {
    await GET(makeRequest("?status=never_accepted"));
    expect(mockListUsers).toHaveBeenCalledWith(
      expect.objectContaining({ status: "never_accepted" }),
    );
  });

  it("search tronqué et trimé", async () => {
    await GET(makeRequest("?search=admin"));
    expect(mockListUsers).toHaveBeenCalledWith(
      expect.objectContaining({ search: "admin" }),
    );
  });

  it("page=1 par défaut → offset=0", async () => {
    await GET(makeRequest());
    expect(mockListUsers).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0, limit: 50 }),
    );
  });

  it("page=3 → offset=100", async () => {
    await GET(makeRequest("?page=3"));
    expect(mockListUsers).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 100, limit: 50 }),
    );
  });

  it("page=NaN ou négatif → fallback 1", async () => {
    await GET(makeRequest("?page=abc"));
    expect(mockListUsers).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0 }),
    );
    mockListUsers.mockClear();
    await GET(makeRequest("?page=-3"));
    expect(mockListUsers).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0 }),
    );
  });
});

describe("GET /api/admin/legal-compliance/users — réponse", () => {
  it("retourne le résultat du helper en JSON", async () => {
    mockListUsers.mockResolvedValue({
      users: [
        {
          id: "u1",
          email: "old@example.com",
          prenom: "Romain",
          nom: "L",
          createdAt: "2026-01-01T00:00:00Z",
          status: "never_accepted",
          acceptedAt: null,
          acceptedVersion: null,
          daysSinceAcceptance: null,
        },
      ],
      total: 11,
      page: 1,
      totalPages: 1,
    });
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; users: unknown[] };
    expect(body.total).toBe(11);
    expect(body.users).toHaveLength(1);
  });

  it("erreur helper → 500", async () => {
    mockListUsers.mockRejectedValue(new Error("DB exploded"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("DB exploded");
  });
});
