import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { User } from "@supabase/supabase-js";

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

const fakeProducerLite = {
  id: "producer-1",
  slug: "ferme-x",
  nom_exploitation: "Ferme X",
  statut: "public",
};

describe("getInitialUserPayload", () => {
  it("retourne payload anonyme avec producerLite=null pour un visiteur non authentifié", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null });

    const res = await getInitialUserPayload();

    expect(res).toEqual({
      user: null,
      isAdmin: false,
      isProducer: false,
      producerLite: null,
    });
    // Pas de lookup si pas de user → court-circuit avant Promise.all.
    expect(adminMaybeSingleMock).not.toHaveBeenCalled();
    expect(producerMaybeSingleMock).not.toHaveBeenCalled();
  });

  it("retourne isAdmin=false isProducer=false producerLite=null pour un consumer pur", async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });
    adminMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    producerMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const res = await getInitialUserPayload();

    expect(res).toEqual({
      user: fakeUser,
      isAdmin: false,
      isProducer: false,
      producerLite: null,
    });
  });

  it("retourne isAdmin=true isProducer=false producerLite=null pour un user admin", async () => {
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

    expect(res).toEqual({
      user: fakeUser,
      isAdmin: true,
      isProducer: false,
      producerLite: null,
    });
  });

  it("retourne producerLite complet et isProducer=true pour un user producer non-admin", async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });
    adminMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    producerMaybeSingleMock.mockResolvedValue({
      data: fakeProducerLite,
      error: null,
    });

    const res = await getInitialUserPayload();

    expect(res).toEqual({
      user: fakeUser,
      isAdmin: false,
      isProducer: true,
      producerLite: fakeProducerLite,
    });
  });

  it("fail-safe granulaire : si admin lookup throw, producerLite reste correct", async () => {
    // Validation cruciale du pattern fail-safe PAR lookup (vs global) :
    // un throw côté admin ne doit pas masquer le résultat producer.
    authGetUserMock.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });
    adminMaybeSingleMock.mockRejectedValue(new Error("admin network fail"));
    producerMaybeSingleMock.mockResolvedValue({
      data: fakeProducerLite,
      error: null,
    });

    const res = await getInitialUserPayload();

    expect(res).toEqual({
      user: fakeUser,
      isAdmin: false,
      isProducer: true,
      producerLite: fakeProducerLite,
    });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const logged = String(consoleErrorSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("GET_INITIAL_USER_PAYLOAD_WARN");
    expect(logged).toContain("admin lookup failed");
  });

  it("fail-safe granulaire : si producer lookup throw, isAdmin reste correct et producerLite=null", async () => {
    // Invariant fusion : un throw producer doit rendre isProducer=false ET
    // producerLite=null cohérents (les deux dérivent du même lookup).
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

    expect(res).toEqual({
      user: fakeUser,
      isAdmin: true,
      isProducer: false,
      producerLite: null,
    });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const logged = String(consoleErrorSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("GET_INITIAL_USER_PAYLOAD_WARN");
    expect(logged).toContain("producerLite lookup failed");
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

    expect(res).toEqual({
      user: fakeUser,
      isAdmin: false,
      isProducer: false,
      producerLite: null,
    });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("fail-safe : si producers renvoie une error Supabase, fallback isProducer=false producerLite=null", async () => {
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

    expect(res).toEqual({
      user: fakeUser,
      isAdmin: false,
      isProducer: false,
      producerLite: null,
    });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});
