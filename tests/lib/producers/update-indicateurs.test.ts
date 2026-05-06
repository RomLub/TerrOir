import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// T-232 — server action update-indicateurs (rectification post-onboarding).
// =============================================================================
// Couvre :
//   - validation amont (whitelist enums) — rejette valeur inconnue
//   - guard session (rejette si non loggé)
//   - guard "tous enums set + case décochée" (Zod amont aurait bloqué, on
//     vérifie defense-in-depth côté action)
//   - call pattern : RPC update_producer_indicateurs avec versions stampées
//   - audit log producer_indicateurs_updated écrit après succès
// =============================================================================

const rpcMock = vi.fn();
const auditInsertMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: rpcMock,
    from: () => ({
      insert: auditInsertMock,
    }),
  }),
}));

const sessionMock = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: () => sessionMock(),
}));

beforeEach(() => {
  rpcMock.mockReset();
  auditInsertMock.mockReset();
  sessionMock.mockReset();
  rpcMock.mockResolvedValue({ error: null });
  auditInsertMock.mockResolvedValue({ error: null });
});

describe("updateProducerIndicateursAction — guards", () => {
  it("rejette si pas de session", async () => {
    sessionMock.mockResolvedValue(null);
    const { updateProducerIndicateursAction } = await import(
      "@/lib/producers/update-indicateurs"
    );
    const res = await updateProducerIndicateursAction({
      mode_elevage: "plein_air",
      alimentation: "pature_dominante",
      densite_animale: "extensive",
      declaration_cochee: true,
    });
    expect(res).toEqual({ ok: false, error: "Session expirée" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejette si valeur d'enum inconnue (defense-in-depth)", async () => {
    sessionMock.mockResolvedValue({ id: "u1", email: "u@e.fr", roles: [], isAdmin: false });
    const { updateProducerIndicateursAction } = await import(
      "@/lib/producers/update-indicateurs"
    );
    // Cast pour passer le compilateur, simule un POST forgé.
    const res = await updateProducerIndicateursAction({
      mode_elevage: "lune" as never,
      alimentation: null,
      densite_animale: null,
      declaration_cochee: true,
    });
    expect(res).toEqual({ ok: false, error: "Valeur d'indicateur invalide" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejette si au moins un enum non-NULL et case décochée", async () => {
    sessionMock.mockResolvedValue({ id: "u1", email: "u@e.fr", roles: [], isAdmin: false });
    const { updateProducerIndicateursAction } = await import(
      "@/lib/producers/update-indicateurs"
    );
    const res = await updateProducerIndicateursAction({
      mode_elevage: "plein_air",
      alimentation: null,
      densite_animale: null,
      declaration_cochee: false,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/cocher la case/);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("autorise tous enums NULL + case décochée (vidange légitime)", async () => {
    sessionMock.mockResolvedValue({ id: "u1", email: "u@e.fr", roles: [], isAdmin: false });
    const { updateProducerIndicateursAction } = await import(
      "@/lib/producers/update-indicateurs"
    );
    const res = await updateProducerIndicateursAction({
      mode_elevage: null,
      alimentation: null,
      densite_animale: null,
      declaration_cochee: false,
    });
    expect(res).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});

describe("updateProducerIndicateursAction — happy path", () => {
  it("appelle update_producer_indicateurs avec versions wording + enums stampées", async () => {
    sessionMock.mockResolvedValue({ id: "u-42", email: "u@e.fr", roles: [], isAdmin: false });
    const { updateProducerIndicateursAction } = await import(
      "@/lib/producers/update-indicateurs"
    );
    const res = await updateProducerIndicateursAction({
      mode_elevage: "plein_air",
      alimentation: "pature_dominante",
      densite_animale: "extensive",
      declaration_cochee: true,
    });
    expect(res).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("update_producer_indicateurs", {
      p_user_id: "u-42",
      p_mode_elevage: "plein_air",
      p_alimentation: "pature_dominante",
      p_densite_animale: "extensive",
      p_declaration_cochee: true,
      p_wording_version: "v1.0",
      p_enums_version: "v1.0",
    });
  });

  it("écrit audit log producer_indicateurs_updated après succès", async () => {
    sessionMock.mockResolvedValue({ id: "u-42", email: "u@e.fr", roles: [], isAdmin: false });
    const { updateProducerIndicateursAction } = await import(
      "@/lib/producers/update-indicateurs"
    );
    await updateProducerIndicateursAction({
      mode_elevage: "plein_air",
      alimentation: "pature_dominante",
      densite_animale: "extensive",
      declaration_cochee: true,
    });
    expect(auditInsertMock).toHaveBeenCalledTimes(1);
    expect(auditInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "u-42",
        event_type: "producer_indicateurs_updated",
        metadata: expect.objectContaining({
          mode_elevage: "plein_air",
          alimentation: "pature_dominante",
          densite_animale: "extensive",
          declaration_cochee: true,
        }),
      }),
    );
  });

  it("propage l'erreur RPC sans écrire d'audit log", async () => {
    sessionMock.mockResolvedValue({ id: "u-42", email: "u@e.fr", roles: [], isAdmin: false });
    rpcMock.mockResolvedValue({ error: { message: "Producer non trouvé" } });
    const { updateProducerIndicateursAction } = await import(
      "@/lib/producers/update-indicateurs"
    );
    const res = await updateProducerIndicateursAction({
      mode_elevage: "plein_air",
      alimentation: null,
      densite_animale: null,
      declaration_cochee: true,
    });
    expect(res).toEqual({ ok: false, error: "Producer non trouvé" });
    expect(auditInsertMock).not.toHaveBeenCalled();
  });
});
