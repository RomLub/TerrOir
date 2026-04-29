import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `lib/audit-logs/log-auth-event.ts` importe 'server-only' (virtuel
// Next.js, non résolvable hors build webpack) → stub no-op.
vi.mock("server-only", () => ({}));

// `next/headers` n'est dispo qu'en runtime serveur Next.js. On expose un
// mock contrôlable depuis chaque test pour simuler "headers présents",
// "headers absents (throws)", etc.
const headersMock = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

// Capture des inserts pour assertions. `insertSpy` est réassigné par chaque
// test selon le scénario (succès, error Supabase, throw).
type InsertSpy = ((table: string, payload: unknown) => Promise<unknown>) & {
  mock: { calls: unknown[][] };
};
let insertSpy: InsertSpy;
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => ({
      insert: (payload: unknown) => insertSpy(table, payload),
    }),
  }),
}));

import {
  logAuthEvent,
  extractRequestContext,
} from "@/lib/audit-logs/log-auth-event";

beforeEach(() => {
  insertSpy = vi.fn().mockResolvedValue({ error: null }) as unknown as InsertSpy;
  headersMock.mockReset();
  // Par défaut : headers() throws (hors scope server) → fallback null.
  headersMock.mockImplementation(() => {
    throw new Error("headers() called outside of server context");
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logAuthEvent", () => {
  it("insère un event avec userId, eventType et metadata", async () => {
    await logAuthEvent({
      eventType: "account_login_password",
      userId: "user-42",
      metadata: { source: "web" },
    });

    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledWith("audit_logs", {
      user_id: "user-42",
      event_type: "account_login_password",
      metadata: { source: "web" },
      ip_address: null,
      user_agent: null,
    });
  });

  it("accepte userId null (event pré-identification, ex: magic_link)", async () => {
    await logAuthEvent({
      eventType: "account_login_magic_link",
      userId: null,
      metadata: { email: "user@example.com" },
    });

    expect(insertSpy).toHaveBeenCalledWith("audit_logs", {
      user_id: null,
      event_type: "account_login_magic_link",
      metadata: { email: "user@example.com" },
      ip_address: null,
      user_agent: null,
    });
  });

  it("metadata par défaut = {} si non fourni", async () => {
    await logAuthEvent({ eventType: "account_logout", userId: "user-1" });

    expect(insertSpy).toHaveBeenCalledWith(
      "audit_logs",
      expect.objectContaining({ metadata: {} }),
    );
  });

  it("ipAddress + userAgent explicites passés tels quels", async () => {
    await logAuthEvent({
      eventType: "password_changed",
      userId: "user-7",
      ipAddress: "203.0.113.42",
      userAgent: "Mozilla/5.0",
    });

    expect(insertSpy).toHaveBeenCalledWith(
      "audit_logs",
      expect.objectContaining({
        ip_address: "203.0.113.42",
        user_agent: "Mozilla/5.0",
      }),
    );
  });

  it("auto-extrait IP + UA via next/headers() quand non fournis", async () => {
    headersMock.mockReturnValue(
      new Headers({
        "x-forwarded-for": "198.51.100.7, 10.0.0.1",
        "user-agent": "TestAgent/1.0",
      }),
    );

    await logAuthEvent({
      eventType: "account_login_password",
      userId: "user-1",
    });

    expect(insertSpy).toHaveBeenCalledWith(
      "audit_logs",
      expect.objectContaining({
        ip_address: "198.51.100.7",
        user_agent: "TestAgent/1.0",
      }),
    );
  });

  it("ne re-throw pas si Supabase renvoie une error (fail-safe)", async () => {
    insertSpy = vi
      .fn()
      .mockResolvedValue({ error: { message: "table not found" } }) as unknown as InsertSpy;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      logAuthEvent({
        eventType: "account_login_password",
        userId: "user-1",
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("AUDIT_LOG_INSERT_WARN"),
    );
  });

  it("ne re-throw pas si l'admin client throw (DB indispo)", async () => {
    insertSpy = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as InsertSpy;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      logAuthEvent({
        eventType: "password_changed",
        userId: "user-9",
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("AUDIT_LOG_WRITE_WARN"),
    );
  });

  it("userId omis → user_id = null", async () => {
    await logAuthEvent({ eventType: "password_reset_request" });

    expect(insertSpy).toHaveBeenCalledWith(
      "audit_logs",
      expect.objectContaining({ user_id: null }),
    );
  });

  // Phase 3 multi-events (T-081 PR-A) + T-307 — smoke test type-check :
  // confirme que les nouveaux event types sont acceptés par l'union
  // AuthEventType et écrits tels quels dans audit_logs.
  it.each([
    "account_signup",
    "account_deleted",
    "email_change",
    "admin_login",
    "role_changed",
    "invitation_consumed_race_lost",
  ] as const)("Phase 3 event %s : insert event_type tel quel", async (eventType) => {
    await logAuthEvent({ eventType, userId: "user-1" });

    expect(insertSpy).toHaveBeenCalledWith(
      "audit_logs",
      expect.objectContaining({ event_type: eventType, user_id: "user-1" }),
    );
  });
});

describe("extractRequestContext", () => {
  it("extrait la 1re IP de x-forwarded-for (CSV Vercel)", () => {
    const h = new Headers({
      "x-forwarded-for": "198.51.100.7, 10.0.0.1, 192.168.1.1",
      "user-agent": "Mozilla/5.0",
    });
    expect(extractRequestContext(h)).toEqual({
      ipAddress: "198.51.100.7",
      userAgent: "Mozilla/5.0",
    });
  });

  it("fallback sur x-real-ip si x-forwarded-for absent", () => {
    const h = new Headers({
      "x-real-ip": "203.0.113.5",
      "user-agent": "Bot/2.0",
    });
    expect(extractRequestContext(h)).toEqual({
      ipAddress: "203.0.113.5",
      userAgent: "Bot/2.0",
    });
  });

  it("retourne null sur les deux champs si headers vides", () => {
    const h = new Headers();
    expect(extractRequestContext(h)).toEqual({
      ipAddress: null,
      userAgent: null,
    });
  });
});
