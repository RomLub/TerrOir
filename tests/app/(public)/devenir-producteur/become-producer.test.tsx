import { describe, it, expect, vi, beforeEach } from "vitest";

// becomeProducerAction : rattache l'activité producteur à un compte EXISTANT
// (consommateur connecté). Pas de création de compte. Mocks I/O ; on vérifie
// la sécurité (id/email de la session), l'idempotence et la compensation.

vi.mock("@/lib/env/urls", () => ({
  NEXT_PUBLIC_APP_URL: "https://www.test.fr",
  NEXT_PUBLIC_PRODUCER_URL: "https://pro.test.fr",
}));
vi.mock("next/headers", () => ({
  headers: async () => new Map(),
  cookies: async () => ({ set: () => {} }),
}));
vi.mock("@/lib/producers/slug-from-email", () => ({
  slugFromEmail: (e: string) => `slug-${e}`,
}));

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  maybeSingle: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  consume: vi.fn(),
  upsert: vi.fn(),
  send: vi.fn(),
  optOut: vi.fn(),
  logAuth: vi.fn(),
  clearSnapshot: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSessionUser: h.getSession }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: () => h.maybeSingle(table) }) }),
      insert: (payload: unknown) => Promise.resolve(h.insert(table, payload)),
      update: (payload: unknown) => ({
        eq: () => Promise.resolve(h.update(table, payload)),
      }),
    }),
  }),
}));
vi.mock("@/lib/rate-limit", () => ({
  getProducerSignupRateLimit: () => ({}),
  consumeRateLimit: () => h.consume(),
}));
vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  extractRequestContext: () => ({ ipAddress: "1.2.3.4" }),
  logAuthEvent: h.logAuth,
}));
vi.mock("@/lib/producer-interests/upsert-interest", () => ({
  upsertProducerInterest: h.upsert,
}));
vi.mock("@/lib/auth/role-snapshot-cookie", () => ({
  clearRoleSnapshotOnStore: h.clearSnapshot,
}));
vi.mock("@/lib/resend/send", () => ({ sendTemplate: h.send }));
vi.mock("@/lib/rgpd/opt-out-token", () => ({ generateOptOutToken: h.optOut }));

import { becomeProducerAction } from "@/app/(public)/devenir-producteur/_actions/become-producer";

const CONSUMER = {
  id: "user-1",
  email: "jean@ferme.fr",
  roles: ["consumer"],
  isAdmin: false,
  isSuperAdmin: false,
};

function fd(overrides: Record<string, string | string[]> = {}): FormData {
  const f = new FormData();
  const base: Record<string, string> = {
    prenom: "Jean",
    nom: "Dupont",
    telephone: "0600000000",
    nom_exploitation: "Ferme du Test",
    commune: "Le Mans",
    code_postal: "72000",
    message: "",
    cgu_accepted: "on",
    website: "",
  };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  for (const [k, v] of Object.entries(overrides)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getSession.mockResolvedValue(CONSUMER);
  h.maybeSingle.mockResolvedValue({ data: null, error: null }); // pas de producer
  h.insert.mockReturnValue({ error: null });
  h.update.mockReturnValue({ error: null });
  h.consume.mockResolvedValue({ success: true });
  h.optOut.mockReturnValue({ token: "opt" });
  h.send.mockResolvedValue(undefined);
});

describe("becomeProducerAction", () => {
  it("non connecté → erreur, aucune écriture", async () => {
    h.getSession.mockResolvedValueOnce(null);
    const res = await becomeProducerAction({}, fd());
    expect(res.error).toBeTruthy();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("compte admin → erreur, aucune écriture", async () => {
    h.getSession.mockResolvedValueOnce({ ...CONSUMER, isAdmin: true });
    const res = await becomeProducerAction({}, fd());
    expect(res.error).toBeTruthy();
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("déjà producteur (fiche existante) → succès idempotent sans réécriture", async () => {
    h.maybeSingle.mockResolvedValueOnce({ data: { id: "prod-1" }, error: null });
    const res = await becomeProducerAction({}, fd());
    expect(res.success).toBe(true);
    expect(res.redirectTo).toContain("pro.test.fr");
    expect(h.update).not.toHaveBeenCalled();
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("cas nominal : ajoute le rôle producteur + crée la fiche draft", async () => {
    const res = await becomeProducerAction({}, fd());
    expect(res.success).toBe(true);
    expect(res.redirectTo).toBe("https://pro.test.fr/ma-page");

    // roles update sur l'id de session, avec producer ajouté.
    const [updTable, updPayload] = h.update.mock.calls[0]!;
    expect(updTable).toBe("users");
    expect((updPayload as { roles: string[] }).roles).toEqual(
      expect.arrayContaining(["consumer", "producer"]),
    );

    // fiche producteur : user_id = session.id, slug dérivé de l'email session.
    const [insTable, insPayload] = h.insert.mock.calls[0]!;
    expect(insTable).toBe("producers");
    const p = insPayload as Record<string, unknown>;
    expect(p.user_id).toBe("user-1");
    expect(p.slug).toBe("slug-jean@ferme.fr");
    expect(p.statut).toBe("draft");

    // cache de rôle vidé.
    expect(h.clearSnapshot).toHaveBeenCalled();
  });

  it("SÉCURITÉ : l'email/id du client sont ignorés (session autoritaire)", async () => {
    const res = await becomeProducerAction(
      {},
      fd({ email: "pirate@evil.fr", user_id: "autre", roles: "admin" }),
    );
    expect(res.success).toBe(true);
    const [, insPayload] = h.insert.mock.calls[0]!;
    expect((insPayload as { user_id: string }).user_id).toBe("user-1");
    expect((insPayload as { slug: string }).slug).toBe("slug-jean@ferme.fr");
  });

  it("nom d'exploitation manquant → erreur de validation, aucune écriture", async () => {
    const res = await becomeProducerAction({}, fd({ nom_exploitation: "" }));
    expect(res.error).toBeTruthy();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("honeypot rempli → succès neutre, aucune écriture", async () => {
    const res = await becomeProducerAction({}, fd({ website: "bot" }));
    expect(res.success).toBe(true);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("échec création fiche → compensation (rôle producteur retiré) + erreur", async () => {
    h.insert.mockReturnValueOnce({ error: { message: "boom" } });
    const res = await becomeProducerAction({}, fd());
    expect(res.error).toBeTruthy();
    // 2 updates users : ajout du rôle puis rollback vers les rôles d'origine.
    expect(h.update).toHaveBeenCalledTimes(2);
    const [, revertPayload] = h.update.mock.calls[1]!;
    expect((revertPayload as { roles: string[] }).roles).toEqual(["consumer"]);
  });
});
