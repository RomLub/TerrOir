import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock de la primitive bas-niveau : on isole le helper et on vérifie qu'il
// transforme correctement chaque event vers la forme attendue par
// logAuthEvent (eventType + userId + metadata aplati).
vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: vi.fn().mockResolvedValue(undefined),
}));

import { logAuthEvent } from "@/lib/audit-logs/log-auth-event";
import { logAdminInviteEvent } from "@/lib/audit-logs/log-admin-invite-event";

beforeEach(() => {
  vi.mocked(logAuthEvent).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Helper de test : récupère la dernière payload passée à logAuthEvent. On
// veut comparer en strict equality (toEqual), pas en superset (toMatchObject),
// pour casser dès qu'un champ est ajouté/retiré silencieusement par le
// wrapper — c'est tout l'intérêt du helper typé : verrouiller le schéma.
function lastCall() {
  return vi.mocked(logAuthEvent).mock.calls.at(-1)?.[0];
}

describe("logAdminInviteEvent — sérialisation par event_type", () => {
  it("admin_invite_sent : eventType + userId + metadata { invitation_id, invitation_email, resend_id }", async () => {
    await logAdminInviteEvent("admin-1", {
      type: "admin_invite_sent",
      invitation_id: "inv-1",
      invitation_email: "prospect@example.com",
      resend_id: "res_abc",
    });
    expect(logAuthEvent).toHaveBeenCalledTimes(1);
    expect(lastCall()).toEqual({
      eventType: "admin_invite_sent",
      userId: "admin-1",
      metadata: {
        invitation_id: "inv-1",
        invitation_email: "prospect@example.com",
        resend_id: "res_abc",
      },
    });
  });

  it("admin_invite_draft_resend : même shape que sent (cohérence transport email)", async () => {
    await logAdminInviteEvent("admin-1", {
      type: "admin_invite_draft_resend",
      invitation_id: "inv-2",
      invitation_email: "draft@example.com",
      resend_id: "res_xyz",
    });
    expect(lastCall()).toEqual({
      eventType: "admin_invite_draft_resend",
      userId: "admin-1",
      metadata: {
        invitation_id: "inv-2",
        invitation_email: "draft@example.com",
        resend_id: "res_xyz",
      },
    });
  });

  it("admin_invite_blocked_admin : metadata { invitation_email } seul (pas de invitation_id, pas de statut)", async () => {
    await logAdminInviteEvent("admin-1", {
      type: "admin_invite_blocked_admin",
      invitation_email: "boss@example.com",
    });
    expect(lastCall()).toEqual({
      eventType: "admin_invite_blocked_admin",
      userId: "admin-1",
      metadata: { invitation_email: "boss@example.com" },
    });
  });

  it("admin_invite_blocked_producer : metadata { invitation_email, statut } — accepte statut string", async () => {
    await logAdminInviteEvent("admin-1", {
      type: "admin_invite_blocked_producer",
      invitation_email: "alice@example.com",
      statut: "active",
    });
    expect(lastCall()).toEqual({
      eventType: "admin_invite_blocked_producer",
      userId: "admin-1",
      metadata: {
        invitation_email: "alice@example.com",
        statut: "active",
      },
    });
  });

  it("admin_invite_blocked_producer : statut nullable (cas limite producer.statut undefined → null)", async () => {
    await logAdminInviteEvent("admin-1", {
      type: "admin_invite_blocked_producer",
      invitation_email: "alice@example.com",
      statut: null,
    });
    expect(lastCall()).toEqual({
      eventType: "admin_invite_blocked_producer",
      userId: "admin-1",
      metadata: {
        invitation_email: "alice@example.com",
        statut: null,
      },
    });
  });

  it.each([
    ["create_account"],
    ["login_and_upgrade"],
    ["accept_invitation"],
    ["complete_onboarding"],
  ] as const)(
    "admin_invite_expired surface=%s : metadata { invitation_id, token_prefix, surface } (4 sites alignés T-081)",
    async (surface) => {
      await logAdminInviteEvent(null, {
        type: "admin_invite_expired",
        invitation_id: "inv-9",
        token_prefix: "deadbeef",
        surface,
      });
      expect(lastCall()).toEqual({
        eventType: "admin_invite_expired",
        userId: null,
        metadata: {
          invitation_id: "inv-9",
          token_prefix: "deadbeef",
          surface,
        },
      });
    },
  );

  it("userId nullable : null transmis tel quel à logAuthEvent (pas de filtrage côté wrapper)", async () => {
    await logAdminInviteEvent(null, {
      type: "admin_invite_expired",
      invitation_id: "inv-1",
      token_prefix: "abcdef01",
      surface: "create_account",
    });
    const call = lastCall() as { userId: string | null };
    expect(call.userId).toBeNull();
  });

  it("garde-fou : le champ discriminant `type` n'apparaît PAS dans metadata (extraction propre, pas de duplication eventType)", async () => {
    await logAdminInviteEvent("admin-1", {
      type: "admin_invite_blocked_admin",
      invitation_email: "boss@example.com",
    });
    const call = lastCall() as { metadata: Record<string, unknown> };
    expect(call.metadata).not.toHaveProperty("type");
    // Garde-fou explicite : pas de pollution metadata avec le discriminator —
    // si un futur refacto du wrapper l'oubliait, le forensic embarquerait
    // deux représentations contradictoires de l'event_type.
    expect(Object.keys(call.metadata)).toEqual(["invitation_email"]);
  });
});
