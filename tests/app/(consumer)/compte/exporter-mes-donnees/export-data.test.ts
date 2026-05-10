import { describe, it, expect, vi, beforeEach } from "vitest";

const sessionUserMock = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: () => sessionUserMock(),
}));

const consumeRateLimitMock = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: (...args: unknown[]) => consumeRateLimitMock(...args),
  getRgpdExportRateLimit: () => ({}),
}));

const logAuthEventMock = vi.fn();
vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: (...args: unknown[]) => logAuthEventMock(...args),
}));

const buildExportPayloadMock = vi.fn();
const buildExportZipMock = vi.fn();
const buildExportFilenameMock = vi.fn();
vi.mock("@/lib/rgpd/export-user-data", () => ({
  buildExportPayload: (...args: unknown[]) => buildExportPayloadMock(...args),
  buildExportZip: (...args: unknown[]) => buildExportZipMock(...args),
  buildExportFilename: (...args: unknown[]) => buildExportFilenameMock(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({}),
}));

import { exportMyDataAction } from "@/app/(consumer)/compte/exporter-mes-donnees/_actions/export-data";

beforeEach(() => {
  sessionUserMock.mockReset();
  consumeRateLimitMock.mockReset();
  logAuthEventMock.mockReset();
  buildExportPayloadMock.mockReset();
  buildExportZipMock.mockReset();
  buildExportFilenameMock.mockReset();

  // Default happy-path setup
  sessionUserMock.mockResolvedValue({
    id: "user-42",
    email: "user@example.com",
    roles: [],
    isAdmin: false,
  });
  consumeRateLimitMock.mockResolvedValue({
    success: true,
    limit: 5,
    remaining: 4,
    reset: 0,
  });
  buildExportPayloadMock.mockResolvedValue({
    meta: {
      user_id: "user-42",
      generated_at: "2026-05-10T12:00:00Z",
      notifications_window_days: 90,
      format_version: "1.0",
    },
    profil: { email: "user@example.com" },
    commandes: [],
    articles_commandes: [],
    avis: [],
    notifications: [],
    interets_producteurs: [],
  });
  buildExportZipMock.mockResolvedValue(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
  buildExportFilenameMock.mockReturnValue("terroir-export-user-42-2026-05-10.zip");
});

describe("exportMyDataAction", () => {
  it("retourne unauthorized si pas de session", async () => {
    sessionUserMock.mockResolvedValue(null);
    const result = await exportMyDataAction();
    expect(result).toEqual({ ok: false, error: "unauthorized" });
    expect(buildExportPayloadMock).not.toHaveBeenCalled();
  });

  it("respecte le rate-limit (5/24h userId) et émet audit log", async () => {
    consumeRateLimitMock.mockResolvedValue({
      success: false,
      limit: 5,
      remaining: 0,
      reset: Date.now() + 3600 * 1000,
    });
    const result = await exportMyDataAction();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("rate_limited");
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    }
    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "rate_limit_exceeded",
        userId: "user-42",
        metadata: expect.objectContaining({ route: "exporter_mes_donnees" }),
      }),
    );
    expect(buildExportPayloadMock).not.toHaveBeenCalled();
  });

  it("happy-path : émet user_data_exported avec counts + retourne base64", async () => {
    buildExportPayloadMock.mockResolvedValue({
      meta: {
        user_id: "user-42",
        generated_at: "2026-05-10T12:00:00Z",
        notifications_window_days: 90,
        format_version: "1.0",
      },
      profil: { email: "user@example.com" },
      commandes: [{ id: "o1" }, { id: "o2" }],
      articles_commandes: [{}, {}, {}],
      avis: [{}],
      notifications: [{}, {}],
      interets_producteurs: [],
    });

    const result = await exportMyDataAction();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filename).toBe("terroir-export-user-42-2026-05-10.zip");
      expect(typeof result.base64).toBe("string");
      expect(result.base64.length).toBeGreaterThan(0);
    }

    expect(logAuthEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "user_data_exported",
        userId: "user-42",
        metadata: expect.objectContaining({
          commandes_count: 2,
          articles_count: 3,
          avis_count: 1,
          notifications_count: 2,
          interets_producteurs_count: 0,
          zip_bytes: 4,
        }),
      }),
    );
  });

  it("appelle buildExportPayload avec session.id (jamais d'arg user_id du client)", async () => {
    await exportMyDataAction();
    expect(buildExportPayloadMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-42",
    );
    // Vérifie qu'aucun 3e arg type "userIdFromClient" ne contamine l'API.
    const callArgs = buildExportPayloadMock.mock.calls[0];
    expect(callArgs.length).toBeLessThanOrEqual(2);
  });

  it("retourne error technical si buildExportZip throw", async () => {
    buildExportZipMock.mockRejectedValue(new Error("zip lib down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await exportMyDataAction();
    expect(result).toEqual({ ok: false, error: "technical" });
  });
});
