// Test minimal POST /api/cron/cleanup-test-residuals.
//
// 2 cas :
//   1. Auth manquante / invalide → 401, sweepE2EResiduals JAMAIS appelé.
//   2. Auth correcte (Bearer CRON_SECRET) → 200 + JSON shape attendu.
//
// Pattern aligné tests/app/api/stripe/webhook/route.test.tsx (hoisted env
// stubs + module-level vi.mock). On mock sweepE2EResiduals pour ne JAMAIS
// taper la prod depuis ce test (mode unit pur).

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted env stubs ---------------------------------------------------
// CRON_SECRET requis par lib/cron/auth.ts (assertCronAuth).
// SUPABASE env vars requis par lib/maintenance/sweep-e2e-residuals.ts au
// module-load (le getAdminClient inline les lit). Mockés mais stubbés ici
// pour éviter throw au top-level import.
vi.hoisted(() => {
  process.env.CRON_SECRET = process.env.CRON_SECRET ?? "test-cron-secret-12345";
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "test-service-role-key";
});

// --- Hoisted mock pour sweepE2EResiduals ---------------------------------
const { mockSweep } = vi.hoisted(() => ({
  mockSweep: vi.fn(),
}));

vi.mock("@/lib/maintenance/sweep-e2e-residuals", () => ({
  sweepE2EResiduals: mockSweep,
}));

// --- Import route AFTER vi.mock ------------------------------------------
import { POST } from "@/app/api/cron/cleanup-test-residuals/route";

beforeEach(() => {
  mockSweep.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("POST /api/cron/cleanup-test-residuals", () => {
  it("auth manquante → 401, sweep JAMAIS appelé", async () => {
    const req = new Request(
      "http://localhost/api/cron/cleanup-test-residuals",
      { method: "POST" },
    );
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it("auth correcte (Bearer CRON_SECRET) → 200 + JSON shape + sweep appelé avec minAgeHours=168", async () => {
    mockSweep.mockResolvedValue({
      authUsersDeleted: 3,
      testEmailsDeleted: 5,
      errors: [],
    });
    const req = new Request(
      "http://localhost/api/cron/cleanup-test-residuals",
      {
        method: "POST",
        headers: { Authorization: "Bearer test-cron-secret-12345" },
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      auth_users_deleted: 3,
      test_emails_deleted: 5,
      errors: [],
    });
    expect(mockSweep).toHaveBeenCalledTimes(1);
    expect(mockSweep).toHaveBeenCalledWith({ minAgeHours: 168 });
  });
});
