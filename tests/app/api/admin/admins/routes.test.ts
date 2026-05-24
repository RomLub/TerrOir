import { describe, it, expect, vi, beforeEach } from "vitest";

// Tests des routes admin lifecycle (chantier 6) : gate super_admin (défense
// en profondeur), validation, mapping erreur. La logique métier est dans
// operations (testée séparément) — ici on mocke les opérations.

const { sessionMock, opMocks } = vi.hoisted(() => {
  // Le route importe operations (importOriginal) → charge le client resend +
  // env urls. Stubs nécessaires pour le module-load (les ops réelles sont
  // mockées, le client n'est jamais appelé).
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.terroir-local.fr";
  process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? "re_test";
  process.env.RESEND_FROM_EMAIL =
    process.env.RESEND_FROM_EMAIL ?? "no-reply@terroir-local.fr";
  return {
    sessionMock: vi.fn(),
    opMocks: {
      promoteAdminByEmail: vi.fn(),
      suspendAdmin: vi.fn(),
    },
  };
});

vi.mock("@/lib/auth/session", () => ({ getSessionUser: sessionMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin/admins/operations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/admins/operations")>();
  return {
    ...actual,
    promoteAdminByEmail: opMocks.promoteAdminByEmail,
    suspendAdmin: opMocks.suspendAdmin,
  };
});

import { POST as promotePOST } from "@/app/api/admin/admins/promote/route";
import { POST as suspendPOST } from "@/app/api/admin/admins/[id]/suspend/route";

function req(body?: unknown): Request {
  return new Request("http://admin.local/api/admin/admins/x", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  sessionMock.mockReset();
  opMocks.promoteAdminByEmail.mockReset();
  opMocks.suspendAdmin.mockReset();
});

describe("POST /api/admin/admins/promote", () => {
  it("non-admin → 403", async () => {
    sessionMock.mockResolvedValue(null);
    const res = await promotePOST(req({ email: "x@y.fr" }));
    expect(res.status).toBe(403);
    expect(opMocks.promoteAdminByEmail).not.toHaveBeenCalled();
  });

  it("admin NON super → 403 (réservé super_admin)", async () => {
    sessionMock.mockResolvedValue({ id: "a1", isAdmin: true, isSuperAdmin: false });
    const res = await promotePOST(req({ email: "x@y.fr" }));
    expect(res.status).toBe(403);
    expect(opMocks.promoteAdminByEmail).not.toHaveBeenCalled();
  });

  it("super sans email → 400", async () => {
    sessionMock.mockResolvedValue({ id: "a1", isAdmin: true, isSuperAdmin: true });
    const res = await promotePOST(req({ email: "  " }));
    expect(res.status).toBe(400);
  });

  it("super + email valide → appelle l'op + 200", async () => {
    sessionMock.mockResolvedValue({ id: "a1", isAdmin: true, isSuperAdmin: true });
    opMocks.promoteAdminByEmail.mockResolvedValue({ ok: true });
    const res = await promotePOST(req({ email: "x@y.fr", privilege: "standard" }));
    expect(res.status).toBe(200);
    expect(opMocks.promoteAdminByEmail).toHaveBeenCalledWith("a1", "x@y.fr", "standard");
  });

  it("op refuse (no_account) → 400 + message FR", async () => {
    sessionMock.mockResolvedValue({ id: "a1", isAdmin: true, isSuperAdmin: true });
    opMocks.promoteAdminByEmail.mockResolvedValue({ ok: false, errorCode: "no_account" });
    const res = await promotePOST(req({ email: "x@y.fr" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/s'inscrire comme client/);
    expect(json.code).toBe("no_account");
  });
});

describe("POST /api/admin/admins/[id]/suspend", () => {
  const params = { params: Promise.resolve({ id: "t1" }) };

  it("admin NON super → 403", async () => {
    sessionMock.mockResolvedValue({ id: "a1", isAdmin: true, isSuperAdmin: false });
    const res = await suspendPOST(req(), params);
    expect(res.status).toBe(403);
    expect(opMocks.suspendAdmin).not.toHaveBeenCalled();
  });

  it("super → appelle suspendAdmin(actor, id) + 200", async () => {
    sessionMock.mockResolvedValue({ id: "a1", isAdmin: true, isSuperAdmin: true });
    opMocks.suspendAdmin.mockResolvedValue({ ok: true });
    const res = await suspendPOST(req(), params);
    expect(res.status).toBe(200);
    expect(opMocks.suspendAdmin).toHaveBeenCalledWith("a1", "t1");
  });

  it("op refuse (self_action) → 400 + message", async () => {
    sessionMock.mockResolvedValue({ id: "a1", isAdmin: true, isSuperAdmin: true });
    opMocks.suspendAdmin.mockResolvedValue({ ok: false, errorCode: "self_action" });
    const res = await suspendPOST(req(), params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/vous-même/);
  });
});
