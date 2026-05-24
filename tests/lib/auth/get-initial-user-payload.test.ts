import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { User } from "@supabase/supabase-js";

// Mock du client server : dispatch sur from(table) entre admin_users, producers
// et users. Chaque table a son propre maybeSingle stubable indépendamment
// → permet de tester le fail-safe PAR lookup (un throw n'affecte pas les autres).
const authGetUserMock = vi.fn();
const adminMaybeSingleMock = vi.fn();
const producerMaybeSingleMock = vi.fn();
const usersMaybeSingleMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
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
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: usersMaybeSingleMock }),
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
  usersMaybeSingleMock.mockReset();
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
  it("retourne payload anonyme avec producerLite=null et roles=[] pour un visiteur non authentifié", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null });

    const res = await getInitialUserPayload();

    expect(res).toEqual({
      user: null,
      isAdmin: false,
      isProducer: false,
      producerLite: null,
      roles: [],
    });
    // Pas de lookup si pas de user → court-circuit avant Promise.all.
    expect(adminMaybeSingleMock).not.toHaveBeenCalled();
    expect(producerMaybeSingleMock).not.toHaveBeenCalled();
    expect(usersMaybeSingleMock).not.toHaveBeenCalled();
  });

  it("retourne isAdmin=false isProducer=false producerLite=null roles=['consumer'] pour un consumer pur", async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });
    adminMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    producerMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    usersMaybeSingleMock.mockResolvedValue({
      data: { roles: ["consumer"] },
      error: null,
    });

    const res = await getInitialUserPayload();

    expect(res).toEqual({
      user: fakeUser,
      isAdmin: false,
      isProducer: false,
      producerLite: null,
      roles: ["consumer"],
    });
  });

  it("retourne isAdmin=true isProducer=false producerLite=null roles=[] pour un user admin", async () => {
    // Triggers users_exclusive_with_admin / admin_users_exclusive_with_users
    // garantissent qu'un admin n'a PAS de ligne dans public.users → users
    // lookup retourne data:null, donc roles=[].
    authGetUserMock.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });
    adminMaybeSingleMock.mockResolvedValue({
      data: { id: "user-1" },
      error: null,
    });
    producerMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    usersMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const res = await getInitialUserPayload();

    expect(res).toEqual({
      user: fakeUser,
      isAdmin: true,
      isProducer: false,
      producerLite: null,
      roles: [],
    });
  });

  it("chantier 6 : admin SUSPENDU (suspended_at non null) → isAdmin=false", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: fakeUser }, error: null });
    adminMaybeSingleMock.mockResolvedValue({
      data: { id: "user-1", suspended_at: "2026-05-20T10:00:00Z" },
      error: null,
    });
    producerMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    usersMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const res = await getInitialUserPayload();
    expect(res.isAdmin).toBe(false);
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
    usersMaybeSingleMock.mockResolvedValue({
      data: { roles: ["consumer", "producer"] },
      error: null,
    });

    const res = await getInitialUserPayload();

    expect(res).toEqual({
      user: fakeUser,
      isAdmin: false,
      isProducer: true,
      producerLite: fakeProducerLite,
      roles: ["consumer", "producer"],
    });
  });

  it("fail-safe granulaire : si admin lookup throw, producerLite et roles restent corrects", async () => {
    // Validation cruciale du pattern fail-safe PAR lookup (vs global) :
    // un throw côté admin ne doit pas masquer les autres résultats.
    authGetUserMock.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });
    adminMaybeSingleMock.mockRejectedValue(new Error("admin network fail"));
    producerMaybeSingleMock.mockResolvedValue({
      data: fakeProducerLite,
      error: null,
    });
    usersMaybeSingleMock.mockResolvedValue({
      data: { roles: ["consumer", "producer"] },
      error: null,
    });

    const res = await getInitialUserPayload();

    expect(res).toEqual({
      user: fakeUser,
      isAdmin: false,
      isProducer: true,
      producerLite: fakeProducerLite,
      roles: ["consumer", "producer"],
    });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const logged = String(consoleErrorSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("GET_INITIAL_USER_PAYLOAD_WARN");
    expect(logged).toContain("admin lookup failed");
  });

  it("fail-safe granulaire : si producer lookup throw, isAdmin et roles restent corrects et producerLite=null", async () => {
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
    usersMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const res = await getInitialUserPayload();

    expect(res).toEqual({
      user: fakeUser,
      isAdmin: true,
      isProducer: false,
      producerLite: null,
      roles: [],
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
    usersMaybeSingleMock.mockResolvedValue({
      data: { roles: ["consumer"] },
      error: null,
    });

    const res = await getInitialUserPayload();

    expect(res).toEqual({
      user: fakeUser,
      isAdmin: false,
      isProducer: false,
      producerLite: null,
      roles: ["consumer"],
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
    usersMaybeSingleMock.mockResolvedValue({
      data: { roles: ["consumer"] },
      error: null,
    });

    const res = await getInitialUserPayload();

    expect(res).toEqual({
      user: fakeUser,
      isAdmin: false,
      isProducer: false,
      producerLite: null,
      roles: ["consumer"],
    });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  // T-012 — Couverture roles
  // ==========================================================================

  it("T-012 : retourne roles=['consumer', 'producer'] pour un user multi-rôle", async () => {
    // Cas central T-012 : 9 users sur 11 en prod (snapshot 02/05/2026) sont
    // dual-rôle. Le RoleToggle gating dépend de la présence simultanée des
    // deux rôles → critique pour qu'il s'affiche dès le SSR sans "pop".
    authGetUserMock.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });
    adminMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    producerMaybeSingleMock.mockResolvedValue({
      data: fakeProducerLite,
      error: null,
    });
    usersMaybeSingleMock.mockResolvedValue({
      data: { roles: ["consumer", "producer"] },
      error: null,
    });

    const res = await getInitialUserPayload();

    expect(res.roles).toEqual(["consumer", "producer"]);
  });

  it("T-012 fail-safe : roles=[] si lookup users renvoie une error Supabase", async () => {
    // Symétrique des fail-safes admin/producer existants : isolation
    // par lookup, console.error logué, autres branches intactes.
    authGetUserMock.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });
    adminMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    producerMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    usersMaybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: "rls denied" },
    });

    const res = await getInitialUserPayload();

    expect(res).toEqual({
      user: fakeUser,
      isAdmin: false,
      isProducer: false,
      producerLite: null,
      roles: [],
    });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const logged = String(consoleErrorSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("GET_INITIAL_USER_PAYLOAD_WARN");
    expect(logged).toContain("roles lookup failed");
  });

  it("T-012 fail-safe : roles=[] si lookup users throw (réseau/exception)", async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: fakeUser },
      error: null,
    });
    adminMaybeSingleMock.mockResolvedValue({
      data: { id: "user-1" },
      error: null,
    });
    producerMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    usersMaybeSingleMock.mockRejectedValue(new Error("users network fail"));

    const res = await getInitialUserPayload();

    // Isolation par lookup : un throw users ne masque pas isAdmin.
    expect(res).toEqual({
      user: fakeUser,
      isAdmin: true,
      isProducer: false,
      producerLite: null,
      roles: [],
    });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const logged = String(consoleErrorSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("GET_INITIAL_USER_PAYLOAD_WARN");
    expect(logged).toContain("roles lookup failed");
  });
});
