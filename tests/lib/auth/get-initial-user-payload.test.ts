import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { User } from "@supabase/supabase-js";

// `lib/auth/session.ts` importe 'server-only' (module virtuel Next.js, non
// résolvable hors build webpack) → stub no-op pour vitest.
vi.mock("server-only", () => ({}));

// Mock du client server : dispatch sur from(table) entre admin_users et
// producers. Chaque table a son propre maybeSingle stubable indépendamment
// → permet de tester le fail-safe PAR lookup (un throw n'affecte pas l'autre).
const authGetUserMock = vi.fn();
const adminMaybeSingleMock = vi.fn();
const producerMaybeSingleMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    auth: {
      getUser: authGetUserMock,
    },
    from: (table: string) => {
      if (table === "admin_users") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: adminMaybeSingleMock }),
          }),
        };
      }
      if (table === "producers") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: producerMaybeSingleMock }),
          }),
        };
      }
      throw new Error(`unexpected from(${table})`);
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
  producerMaybeSingleMock.mockReset();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("getInitialUserPayload", () => {
  it("retourne { user: null, isAdmin: false, isProducer: false } pour un visiteur anonyme", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null });

    const res = await getInitialUserPayload();

    expect(res).toEqual({ user: null, isAdmin: false, isProducer: false });
    // Pas de lookup si pas de user → court-circuit avant Promise.all.
    expect(adminMaybeSingleMock).not.toHaveBeenCalled();
    expect(producerMaybeSingleMock).not.toHaveBeenCalled();
  });

  it("retourne isAdmin=false isProducer=false pour un user authentifié consumer pur", async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });
    adminMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    producerMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const res = await getInitialUserPayload();

    expect(res).toEqual({ user: fakeUser, isAdmin: false, isProducer: false });
  });

  it("retourne isAdmin=true isProducer=false pour un user admin", async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });
    adminMaybeSingleMock.mockResolvedValue({
      data: { id: "user-1" },
      error: null,
    });
    producerMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const res = await getInitialUserPayload();

    expect(res).toEqual({ user: fakeUser, isAdmin: true, isProducer: false });
  });

  it("retourne isProducer=true isAdmin=false pour un user producer non-admin", async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });
    adminMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    producerMaybeSingleMock.mockResolvedValue({
      data: { id: "producer-1" },
      error: null,
    });

    const res = await getInitialUserPayload();

    expect(res).toEqual({ user: fakeUser, isAdmin: false, isProducer: true });
  });

  it("fail-safe granulaire : si admin lookup throw, isProducer reste correct", async () => {
    // Validation cruciale du pattern fail-safe PAR lookup (vs global) :
    // un throw côté admin ne doit pas masquer le résultat producer.
    authGetUserMock.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });
    adminMaybeSingleMock.mockRejectedValue(new Error("admin network fail"));
    producerMaybeSingleMock.mockResolvedValue({
      data: { id: "producer-1" },
      error: null,
    });

    const res = await getInitialUserPayload();

    expect(res).toEqual({ user: fakeUser, isAdmin: false, isProducer: true });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const logged = String(consoleErrorSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("GET_INITIAL_USER_PAYLOAD_WARN");
    expect(logged).toContain("admin lookup failed");
  });

  it("fail-safe granulaire : si producer lookup throw, isAdmin reste correct", async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });
    adminMaybeSingleMock.mockResolvedValue({
      data: { id: "user-1" },
      error: null,
    });
    producerMaybeSingleMock.mockRejectedValue(
      new Error("producer network fail"),
    );

    const res = await getInitialUserPayload();

    expect(res).toEqual({ user: fakeUser, isAdmin: true, isProducer: false });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const logged = String(consoleErrorSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("GET_INITIAL_USER_PAYLOAD_WARN");
    expect(logged).toContain("producer lookup failed");
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
    producerMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const res = await getInitialUserPayload();

    expect(res).toEqual({ user: fakeUser, isAdmin: false, isProducer: false });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("fail-safe : si producers renvoie une error Supabase, fallback isProducer=false", async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });
    adminMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    producerMaybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: "rls denied" },
    });

    const res = await getInitialUserPayload();

    expect(res).toEqual({ user: fakeUser, isAdmin: false, isProducer: false });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});
