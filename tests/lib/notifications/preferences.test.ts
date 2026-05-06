// Tests vitest pour lib/notifications/preferences.ts.
//
// Stratégie : mock createSupabaseAdminClient pour intercepter les calls
// à user_notification_preferences sans toucher la prod. On vérifie :
//   - getUserNotificationPreferences retourne defaults si row absente
//   - getUserNotificationPreferences retourne valeurs DB si row présente
//   - getUserNotificationPreferences retourne defaults + warn si erreur
//   - shouldSendEmail répercute la pref correspondante
//   - upsertUserNotificationPreference fait un upsert avec conflict user_id

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "test-service-role-key";
});

const { mockMaybeSingle, mockUpsert, mockEq, mockSelect, mockFrom } =
  vi.hoisted(() => ({
    mockMaybeSingle: vi.fn(),
    mockUpsert: vi.fn(),
    mockEq: vi.fn(),
    mockSelect: vi.fn(),
    mockFrom: vi.fn(),
  }));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: mockFrom }),
}));

import {
  getUserNotificationPreferences,
  shouldSendEmail,
  upsertUserNotificationPreference,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from "@/lib/notifications/preferences";

beforeEach(() => {
  mockMaybeSingle.mockReset();
  mockUpsert.mockReset();
  mockEq.mockReset();
  mockSelect.mockReset();
  mockFrom.mockReset();

  // SELECT chain par défaut: from().select().eq().maybeSingle()
  mockEq.mockReturnValue({ maybeSingle: mockMaybeSingle });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockUpsert.mockReturnValue(Promise.resolve({ error: null }));
  mockFrom.mockReturnValue({ select: mockSelect, upsert: mockUpsert });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getUserNotificationPreferences", () => {
  it("retourne les defaults si aucune row", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const prefs = await getUserNotificationPreferences("user-1");

    expect(prefs).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(mockFrom).toHaveBeenCalledWith("user_notification_preferences");
    expect(mockSelect).toHaveBeenCalledWith("email_review_response");
    expect(mockEq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("retourne les valeurs DB si row présente", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { email_review_response: false },
      error: null,
    });

    const prefs = await getUserNotificationPreferences("user-2");

    expect(prefs).toEqual({ email_review_response: false });
  });

  it("fail-safe : retourne defaults + warn si erreur DB", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "connection refused" },
    });

    const prefs = await getUserNotificationPreferences("user-3");

    expect(prefs).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[NOTIF_PREFS_READ_WARN]"),
    );
    warnSpy.mockRestore();
  });
});

describe("shouldSendEmail", () => {
  it("renvoie true si pref active (default)", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const result = await shouldSendEmail("user-1", "email_review_response");

    expect(result).toBe(true);
  });

  it("renvoie false si pref désactivée par l'utilisateur", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { email_review_response: false },
      error: null,
    });

    const result = await shouldSendEmail("user-1", "email_review_response");

    expect(result).toBe(false);
  });
});

describe("upsertUserNotificationPreference", () => {
  it("fait un upsert sur conflict user_id avec la valeur fournie", async () => {
    mockUpsert.mockReturnValueOnce(Promise.resolve({ error: null }));

    const result = await upsertUserNotificationPreference(
      "user-1",
      "email_review_response",
      false,
    );

    expect(result).toEqual({ ok: true });
    expect(mockUpsert).toHaveBeenCalledWith(
      { user_id: "user-1", email_review_response: false },
      { onConflict: "user_id" },
    );
  });

  it("renvoie ok=false avec message si erreur DB", async () => {
    mockUpsert.mockReturnValueOnce(
      Promise.resolve({ error: { message: "permission denied" } }),
    );

    const result = await upsertUserNotificationPreference(
      "user-1",
      "email_review_response",
      true,
    );

    expect(result).toEqual({ ok: false, error: "permission denied" });
  });
});
