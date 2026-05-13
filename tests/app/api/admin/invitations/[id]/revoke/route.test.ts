import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Tests POST /api/admin/invitations/[id]/revoke (chantier PR3
// feature/admin-new-surfaces — gap AUDIT_ADMIN § 6 P1 #6). Pattern mock
// aligné sur refund-incidents/resolve : mock session, builder Supabase
// chainable pour pre-SELECT + UPDATE, mock logAuthEvent + revalidatePath.

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

type SelectResp = { data?: unknown; error?: unknown };
type UpdateResp = { error?: unknown };

const { mockSelect, mockUpdate, mockLog, mockRevalidate } = vi.hoisted(() => ({
  mockSelect: vi.fn<() => Promise<SelectResp>>(),
  mockUpdate: vi.fn<() => Promise<UpdateResp>>(),
  mockLog: vi.fn(),
  mockRevalidate: vi.fn(),
}));

const mockUpdateCapture: { lastPayload: unknown } = { lastPayload: null };

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
          mockUpdateCapture.lastPayload = payload;
          return mockUpdate();
        },
      }),
    }),
  }),
}));

vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: mockLog,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidate,
}));

import { POST } from "@/app/api/admin/invitations/[id]/revoke/route";

const INVITATION_ID = "inv-uuid-1";
const ADMIN_ID = "admin-uuid-1";

function makeRequest(): Request {
  return new Request("http://localhost/api/admin/invitations/x/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

const BEFORE_PENDING = {
  id: INVITATION_ID,
  email: "producer@example.com",
  expires_at: "2026-05-20T00:00:00Z",
  used_at: null,
  revoked_at: null,
};

beforeEach(() => {
  sessionUser = {
    id: ADMIN_ID,
    email: "admin@example.com",
    roles: [],
    isAdmin: true,
  };
  mockSelect.mockReset().mockResolvedValue({
    data: BEFORE_PENDING,
    error: null,
  });
  mockUpdate.mockReset().mockResolvedValue({ error: null });
  mockLog.mockReset().mockResolvedValue(undefined);
  mockRevalidate.mockReset();
  mockUpdateCapture.lastPayload = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =========================================================================
// Auth gate
// =========================================================================

describe("POST /api/admin/invitations/[id]/revoke — auth", () => {
  it("session null → 403 sans audit ni update", async () => {
    sessionUser = null;
    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: INVITATION_ID }),
    });
    expect(res.status).toBe(403);
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("session non admin → 403", async () => {
    sessionUser = {
      id: "user-1",
      email: "u@example.com",
      roles: ["consumer"],
      isAdmin: false,
    };
    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: INVITATION_ID }),
    });
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });
});

// =========================================================================
// Lookup not found
// =========================================================================

describe("POST /api/admin/invitations/[id]/revoke — not found", () => {
  it("pre-SELECT data null → 404 sans update ni audit", async () => {
    mockSelect.mockResolvedValueOnce({ data: null, error: null });
    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });
});

// =========================================================================
// 409 si déjà consumed (CRITIQUE — défense en profondeur)
// =========================================================================

describe("POST /api/admin/invitations/[id]/revoke — already consumed", () => {
  it("used_at IS NOT NULL → 409 sans update ni audit", async () => {
    mockSelect.mockResolvedValueOnce({
      data: {
        ...BEFORE_PENDING,
        used_at: "2026-05-12T08:00:00Z",
      },
      error: null,
    });
    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: INVITATION_ID }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/déjà consommée/i);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
    expect(mockRevalidate).not.toHaveBeenCalled();
  });
});

// =========================================================================
// 200 noop si déjà révoquée (idempotent)
// =========================================================================

describe("POST /api/admin/invitations/[id]/revoke — already revoked (idempotent)", () => {
  it("revoked_at IS NOT NULL → 200 noop sans update ni audit", async () => {
    mockSelect.mockResolvedValueOnce({
      data: {
        ...BEFORE_PENDING,
        revoked_at: "2026-05-13T11:00:00Z",
      },
      error: null,
    });
    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: INVITATION_ID }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      revoked_at: string;
      noop: boolean;
    };
    expect(body.noop).toBe(true);
    expect(body.revoked_at).toBe("2026-05-13T11:00:00Z");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });
});

// =========================================================================
// Succès nominal
// =========================================================================

describe("POST /api/admin/invitations/[id]/revoke — success", () => {
  it("nominal : UPDATE revoked_at + audit log invitation_revoked + revalidate", async () => {
    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: INVITATION_ID }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      revoked_at: string;
    };
    expect(body.id).toBe(INVITATION_ID);
    expect(typeof body.revoked_at).toBe("string");

    // UPDATE payload contient revoked_at avec un timestamp ISO.
    expect(mockUpdateCapture.lastPayload).toMatchObject({
      revoked_at: expect.any(String),
    });

    // Audit log appelé avec eventType + userId admin + metadata enrichi.
    expect(mockLog).toHaveBeenCalledOnce();
    const logArg = mockLog.mock.calls[0]?.[0] as {
      eventType: string;
      userId: string;
      metadata: Record<string, unknown>;
    };
    expect(logArg.eventType).toBe("invitation_revoked");
    expect(logArg.userId).toBe(ADMIN_ID);
    expect(logArg.metadata).toMatchObject({
      invitation_id: INVITATION_ID,
      email: BEFORE_PENDING.email,
      expires_at: BEFORE_PENDING.expires_at,
    });

    expect(mockRevalidate).toHaveBeenCalledWith("/invitations");
  });
});

// =========================================================================
// UPDATE error
// =========================================================================

describe("POST /api/admin/invitations/[id]/revoke — update error", () => {
  it("update error → 500 (dbErrorResponse) sans audit ni revalidate", async () => {
    mockUpdate.mockResolvedValueOnce({
      error: { message: "boom", code: "23xxx" },
    });
    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: INVITATION_ID }),
    });
    expect(res.status).toBe(500);
    expect(mockLog).not.toHaveBeenCalled();
    expect(mockRevalidate).not.toHaveBeenCalled();
  });
});
