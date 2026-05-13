import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Tests DELETE /api/admin/producer-interests/[id] — refactor PR1.

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

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({}),
}));

const { mockGet, mockDelete, mockLog } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockDelete: vi.fn(),
  mockLog: vi.fn(),
}));

vi.mock("@/lib/admin/producer-interests/fetch", () => ({
  getProducerInterest: mockGet,
}));

vi.mock("@/lib/admin/producer-interests/mutations", () => ({
  deleteProducerInterest: mockDelete,
}));

vi.mock("@/lib/audit-logs/log-producer-interests-event", () => ({
  logProducerInterestsEvent: mockLog,
}));

import { DELETE } from "@/app/api/admin/producer-interests/[id]/route";

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

const INTEREST = {
  id: "int-42",
  email: "del@example.com",
  statut: "contacted" as const,
  source: "invitation_directe" as const,
  created_at: "2026-04-15T10:00:00Z",
  prenom: "Alice",
  nom: "Martin",
  telephone: null,
  nom_exploitation: null,
  commune: null,
  especes: null,
  message: null,
};

beforeEach(() => {
  sessionUser = {
    id: "admin-1",
    email: "admin@example.com",
    roles: [],
    isAdmin: true,
  };
  mockGet.mockReset().mockResolvedValue(INTEREST);
  mockDelete.mockReset().mockResolvedValue({ ok: true, data: null });
  mockLog.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DELETE /api/admin/producer-interests/[id]", () => {
  it("non authentifié → 403", async () => {
    sessionUser = null;
    const res = await DELETE({} as Request, makeContext("int-42"));
    expect(res.status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("non admin → 403", async () => {
    sessionUser = {
      id: "u",
      email: null,
      roles: ["consumer"],
      isAdmin: false,
    };
    const res = await DELETE({} as Request, makeContext("int-42"));
    expect(res.status).toBe(403);
  });

  it("interest introuvable → 404", async () => {
    mockGet.mockResolvedValue(null);
    const res = await DELETE({} as Request, makeContext("missing"));
    expect(res.status).toBe(404);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("succès → 200 + audit log avec snapshot complet", async () => {
    const res = await DELETE({} as Request, makeContext("int-42"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "int-42" });
    expect(mockDelete).toHaveBeenCalledOnce();
    expect(mockLog).toHaveBeenCalledOnce();
    const audit = mockLog.mock.calls[0][0];
    expect(audit.eventType).toBe("admin_producer_interest_deleted");
    expect(audit.userId).toBe("admin-1");
    expect(audit.metadata).toMatchObject({
      interest_id: "int-42",
      email: "del@example.com",
      source: "invitation_directe",
      statut: "contacted",
      created_at: "2026-04-15T10:00:00Z",
    });
  });

  it("helper delete retourne ok:false → 500 + pas d'audit log", async () => {
    mockDelete.mockResolvedValue({ ok: false, error: "db down" });
    const res = await DELETE({} as Request, makeContext("int-42"));
    expect(res.status).toBe(500);
    expect(mockLog).not.toHaveBeenCalled();
  });
});
