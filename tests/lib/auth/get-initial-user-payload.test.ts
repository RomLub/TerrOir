import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { User } from "@supabase/supabase-js";

// `lib/auth/session.ts` importe 'server-only' (module virtuel Next.js, non
// résolvable hors build webpack) → stub no-op pour vitest.
vi.mock("server-only", () => ({}));

// Mock du client server : on contrôle le retour de auth.getUser() et de la
// chaîne .from('admin_users').select(...).eq(...).maybeSingle() à la demande.
const authGetUserMock = vi.fn();
const adminMaybeSingleMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    auth: {
      getUser: authGetUserMock,
    },
    from: (table: string) => {
      if (table !== "admin_users") {
        throw new Error(`unexpected from(${table})`);
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: adminMaybeSingleMock,
          }),
        }),
      };
    },
  }),
}));

// Stub admin client (importé par session.ts mais non utilisé ici).
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

import { getInitialUserPayload } from "@/lib/auth/session";

const fakeUser = {
  id: "user-1",
  email: "alice@example.com",
} as unknown as User;

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  authGetUserMock.mockReset();
  adminMaybeSingleMock.mockReset();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("getInitialUserPayload", () => {
  it("retourne { user: null, isAdmin: false } pour un visiteur anonyme", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null });

    const res = await getInitialUserPayload();

    expect(res).toEqual({ user: null, isAdmin: false });
    // Pas de lookup admin_users si pas de user → court-circuit.
    expect(adminMaybeSingleMock).not.toHaveBeenCalled();
  });

  it("retourne isAdmin=false pour un user authentifié non-admin", async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });
    adminMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const res = await getInitialUserPayload();

    expect(res).toEqual({ user: fakeUser, isAdmin: false });
  });

  it("retourne isAdmin=true pour un user authentifié admin", async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });
    adminMaybeSingleMock.mockResolvedValue({
      data: { id: "user-1" },
      error: null,
    });

    const res = await getInitialUserPayload();

    expect(res).toEqual({ user: fakeUser, isAdmin: true });
  });

  it("fail-safe : si le lookup admin_users throw, fallback isAdmin=false + log warn", async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });
    adminMaybeSingleMock.mockRejectedValue(new Error("network unreachable"));

    const res = await getInitialUserPayload();

    expect(res).toEqual({ user: fakeUser, isAdmin: false });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const logged = String(consoleErrorSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("GET_INITIAL_USER_PAYLOAD_WARN");
  });

  it("fail-safe : si admin_users renvoie une error Supabase, fallback isAdmin=false", async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });
    adminMaybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: "rls denied" },
    });

    const res = await getInitialUserPayload();

    expect(res).toEqual({ user: fakeUser, isAdmin: false });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});
