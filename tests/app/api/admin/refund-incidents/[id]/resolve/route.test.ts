import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Tests POST /api/admin/refund-incidents/[id]/resolve (PR3 feature/
// admin-new-surfaces — gap AUDIT_ADMIN.md §6 P0 #3). Pattern mock cohérent
// avec /api/admin/animals/[id] et /api/admin/producers/[id]/statut.

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

// Mock chain builder Supabase : on capture select+eq+maybeSingle pour la
// pre-SELECT et update+eq pour l'UPDATE.
type SelectResp = { data?: unknown; error?: unknown };
type UpdateResp = { error?: unknown };

const { mockSelect, mockUpdate, mockLog, mockRevalidate } = vi.hoisted(() => ({
  mockSelect: vi.fn<() => Promise<SelectResp>>(),
  mockUpdate: vi.fn<() => Promise<UpdateResp>>(),
  mockLog: vi.fn(),
  mockRevalidate: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => mockSelect(),
        }),
      }),
      update: (payload: unknown) => ({
        eq: () => {
          // Capture le payload via mockUpdate qui accepte un argument.
          mockUpdateCapture.lastPayload = payload;
          return mockUpdate();
        },
      }),
    }),
  }),
}));

vi.mock("@/lib/audit-logs/log-refund-incidents-event", () => ({
  logRefundIncidentsEvent: mockLog,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidate,
}));

// Variable de capture pour le payload UPDATE (vi.hoisted ne supporte pas
// les vi.fn avec captures complexes ; on capture en parallèle).
const mockUpdateCapture: { lastPayload: unknown } = { lastPayload: null };

import { POST } from "@/app/api/admin/refund-incidents/[id]/resolve/route";

const INCIDENT_ID = "incident-uuid-1";
const ADMIN_ID = "admin-uuid-1";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/refund-incidents/x/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BEFORE_PENDING = {
  id: INCIDENT_ID,
  order_id: "order-uuid-1",
  status: "pending",
  order: { code_commande: "TRR-ABC", montant_total: "42.50" },
};

beforeEach(() => {
  sessionUser = {
    id: ADMIN_ID,
    email: "admin@example.com",
    roles: [],
    isAdmin: true,
  };
  mockSelect.mockReset().mockResolvedValue({ data: BEFORE_PENDING, error: null });
  mockUpdate.mockReset().mockResolvedValue({ error: null });
  mockLog.mockReset().mockResolvedValue(undefined);
  mockRevalidate.mockReset();
  mockUpdateCapture.lastPayload = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/admin/refund-incidents/[id]/resolve — auth", () => {
  it("403 si pas de session", async () => {
    sessionUser = null;
    const res = await POST(makeRequest({ note: "test resolution ok" }), {
      params: Promise.resolve({ id: INCIDENT_ID }),
    });
    expect(res.status).toBe(403);
  });

  it("403 si session sans isAdmin", async () => {
    sessionUser = {
      id: "user-1",
      email: "x@y.com",
      roles: [],
      isAdmin: false,
    };
    const res = await POST(makeRequest({ note: "test resolution ok" }), {
      params: Promise.resolve({ id: INCIDENT_ID }),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/refund-incidents/[id]/resolve — Zod body", () => {
  it("400 si body absent", async () => {
    const req = new Request("http://x/y", { method: "POST" });
    const res = await POST(req, {
      params: Promise.resolve({ id: INCIDENT_ID }),
    });
    expect(res.status).toBe(400);
  });

  it("400 si note manquante", async () => {
    const res = await POST(makeRequest({}), {
      params: Promise.resolve({ id: INCIDENT_ID }),
    });
    expect(res.status).toBe(400);
  });

  it("400 si note < 5 chars", async () => {
    const res = await POST(makeRequest({ note: "abc" }), {
      params: Promise.resolve({ id: INCIDENT_ID }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/refund-incidents/[id]/resolve — 404 / 409", () => {
  it("404 si incident introuvable", async () => {
    mockSelect.mockResolvedValue({ data: null, error: null });
    const res = await POST(makeRequest({ note: "note valide ici" }), {
      params: Promise.resolve({ id: "unknown-id" }),
    });
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("409 si status = succeeded (non actionnable)", async () => {
    mockSelect.mockResolvedValue({
      data: { ...BEFORE_PENDING, status: "succeeded" },
      error: null,
    });
    const res = await POST(makeRequest({ note: "note valide" }), {
      params: Promise.resolve({ id: INCIDENT_ID }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/non actionnable/i);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("409 si status = exhausted (non actionnable)", async () => {
    mockSelect.mockResolvedValue({
      data: { ...BEFORE_PENDING, status: "exhausted" },
      error: null,
    });
    const res = await POST(makeRequest({ note: "note valide" }), {
      params: Promise.resolve({ id: INCIDENT_ID }),
    });
    expect(res.status).toBe(409);
  });

  it("409 si status = manually_resolved (déjà résolu)", async () => {
    mockSelect.mockResolvedValue({
      data: { ...BEFORE_PENDING, status: "manually_resolved" },
      error: null,
    });
    const res = await POST(makeRequest({ note: "note valide" }), {
      params: Promise.resolve({ id: INCIDENT_ID }),
    });
    expect(res.status).toBe(409);
  });

  it("409 si status = aborted (non actionnable)", async () => {
    mockSelect.mockResolvedValue({
      data: { ...BEFORE_PENDING, status: "aborted" },
      error: null,
    });
    const res = await POST(makeRequest({ note: "note valide" }), {
      params: Promise.resolve({ id: INCIDENT_ID }),
    });
    expect(res.status).toBe(409);
  });
});

describe("POST /api/admin/refund-incidents/[id]/resolve — succès", () => {
  it("succès depuis status=pending → UPDATE + audit log + revalidate", async () => {
    const res = await POST(
      makeRequest({ note: "Virement bancaire effectué hors-Stripe" }),
      { params: Promise.resolve({ id: INCIDENT_ID }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: INCIDENT_ID, status: "manually_resolved" });

    // UPDATE payload check
    const payload = mockUpdateCapture.lastPayload as Record<string, unknown>;
    expect(payload.status).toBe("manually_resolved");
    expect(payload.resolution_note).toBe(
      "Virement bancaire effectué hors-Stripe",
    );
    expect(typeof payload.resolved_at).toBe("string");

    // Audit log
    expect(mockLog).toHaveBeenCalledOnce();
    expect(mockLog).toHaveBeenCalledWith({
      eventType: "refund_incident_resolved_manually",
      userId: ADMIN_ID,
      metadata: {
        incident_id: INCIDENT_ID,
        order_id: "order-uuid-1",
        order_code: "TRR-ABC",
        amount_cents: 4250,
        previous_status: "pending",
        note: "Virement bancaire effectué hors-Stripe",
      },
    });

    // Revalidate
    expect(mockRevalidate).toHaveBeenCalledWith("/refund-incidents");
    expect(mockRevalidate).toHaveBeenCalledWith(
      `/refund-incidents/${INCIDENT_ID}`,
    );
  });

  it("succès depuis status=retrying → audit log avec previous_status=retrying", async () => {
    mockSelect.mockResolvedValue({
      data: { ...BEFORE_PENDING, status: "retrying" },
      error: null,
    });
    const res = await POST(makeRequest({ note: "Décision admin tracée" }), {
      params: Promise.resolve({ id: INCIDENT_ID }),
    });
    expect(res.status).toBe(200);
    const logCall = mockLog.mock.calls[0]?.[0] as {
      metadata: Record<string, unknown>;
    };
    expect(logCall.metadata.previous_status).toBe("retrying");
  });

  it("jointure orders en array → orderCode/amount toujours extraits", async () => {
    mockSelect.mockResolvedValue({
      data: {
        ...BEFORE_PENDING,
        order: [{ code_commande: "TRR-DEF", montant_total: 12.99 }],
      },
      error: null,
    });
    const res = await POST(makeRequest({ note: "note ok" }), {
      params: Promise.resolve({ id: INCIDENT_ID }),
    });
    expect(res.status).toBe(200);
    const meta = (mockLog.mock.calls[0]?.[0] as {
      metadata: Record<string, unknown>;
    }).metadata;
    expect(meta.order_code).toBe("TRR-DEF");
    expect(meta.amount_cents).toBe(1299);
  });
});

describe("POST /api/admin/refund-incidents/[id]/resolve — erreurs DB", () => {
  it("500 si UPDATE error", async () => {
    mockUpdate.mockResolvedValue({ error: { message: "constraint failed" } });
    const res = await POST(makeRequest({ note: "note valide" }), {
      params: Promise.resolve({ id: INCIDENT_ID }),
    });
    expect(res.status).toBe(500);
    expect(mockLog).not.toHaveBeenCalled();
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it("500 si pre-SELECT error", async () => {
    mockSelect.mockResolvedValue({
      data: null,
      error: { message: "db connection lost" },
    });
    const res = await POST(makeRequest({ note: "note valide" }), {
      params: Promise.resolve({ id: INCIDENT_ID }),
    });
    expect(res.status).toBe(500);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
