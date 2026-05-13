import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Tests PATCH /api/admin/producer-interests/[id]/statut — refactor PR1.
//
// Stratégie : mock les helpers fetch/mutations + audit log + getSessionUser.
// Le client Supabase n'est jamais touché directement (helpers abstrayent
// tout) — supabase/admin retourne juste un objet vide.

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

const { mockGet, mockUpdate, mockLog } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockUpdate: vi.fn(),
  mockLog: vi.fn(),
}));

vi.mock("@/lib/admin/producer-interests/fetch", () => ({
  getProducerInterest: mockGet,
}));

vi.mock("@/lib/admin/producer-interests/mutations", () => ({
  updateProducerInterestStatut: mockUpdate,
}));

vi.mock("@/lib/audit-logs/log-producer-interests-event", () => ({
  logProducerInterestsEvent: mockLog,
}));

import { PATCH } from "@/app/api/admin/producer-interests/[id]/statut/route";

function makeRequest(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

const INTEREST = {
  id: "int-1",
  email: "lead@example.com",
  statut: "new" as const,
  source: "formulaire_public" as const,
  created_at: "2026-05-01T00:00:00Z",
  prenom: "Jean",
  nom: "Dupont",
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
  mockUpdate.mockReset().mockResolvedValue({ ok: true, data: null });
  mockLog.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PATCH /api/admin/producer-interests/[id]/statut", () => {
  it("non authentifié → 403", async () => {
    sessionUser = null;
    const res = await PATCH(
      makeRequest({ statut: "contacted" }),
      makeContext("int-1"),
    );
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("non admin → 403", async () => {
    sessionUser = {
      id: "u",
      email: null,
      roles: ["consumer"],
      isAdmin: false,
    };
    const res = await PATCH(
      makeRequest({ statut: "contacted" }),
      makeContext("int-1"),
    );
    expect(res.status).toBe(403);
  });

  it("body invalide (statut hors enum) → 400", async () => {
    const res = await PATCH(
      makeRequest({ statut: "invalid" }),
      makeContext("int-1"),
    );
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("body invalide (statut manquant) → 400", async () => {
    const res = await PATCH(makeRequest({}), makeContext("int-1"));
    expect(res.status).toBe(400);
  });

  it("interest introuvable → 404", async () => {
    mockGet.mockResolvedValue(null);
    const res = await PATCH(
      makeRequest({ statut: "contacted" }),
      makeContext("missing-id"),
    );
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("succès → 200 + audit log avec previous/new statut", async () => {
    const res = await PATCH(
      makeRequest({ statut: "contacted" }),
      makeContext("int-1"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "int-1", statut: "contacted" });
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockLog).toHaveBeenCalledOnce();
    const audit = mockLog.mock.calls[0][0];
    expect(audit.eventType).toBe("admin_producer_interest_statut_changed");
    expect(audit.userId).toBe("admin-1");
    expect(audit.metadata).toMatchObject({
      interest_id: "int-1",
      email: "lead@example.com",
      previous_statut: "new",
      new_statut: "contacted",
    });
  });

  it("helper update retourne ok:false → 500 + pas d'audit log", async () => {
    mockUpdate.mockResolvedValue({ ok: false, error: "db down" });
    const res = await PATCH(
      makeRequest({ statut: "onboarded" }),
      makeContext("int-1"),
    );
    expect(res.status).toBe(500);
    expect(mockLog).not.toHaveBeenCalled();
  });
});
