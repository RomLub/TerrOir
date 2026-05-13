// T-110 — Tests focalisés casse email pour les server actions desabonnement.
// unsubscribeAction (DELETE producer_interests) et requestNewOptOutLinkAction
// (SELECT producer_interests). Les deux doivent matcher case-insensitive.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Hoisted env stubs (lib/env/urls + opt-out-token) ---------------------
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
  process.env.OPT_OUT_TOKEN_SECRET =
    process.env.OPT_OUT_TOKEN_SECRET ?? "test-opt-out-secret";
});

type Resp = { data?: unknown; error?: unknown };

let captured: {
  fromCalls: string[];
  deletes: number;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
  ilikeCalls: Array<{ table: string; col: string; val: unknown }>;
};
let responses: Record<string, Resp[]>;

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      captured.fromCalls.push(table);
      const resp = responses[table]?.shift() ?? { data: null, error: null };
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.delete = () => {
        captured.deletes += 1;
        return builder;
      };
      builder.eq = (col: string, val: unknown) => {
        captured.eqCalls.push({ table, col, val });
        return builder;
      };
      builder.ilike = (col: string, val: unknown) => {
        captured.ilikeCalls.push({ table, col, val });
        return builder;
      };
      // Le builder est awaitable (resolves resp) ET expose maybeSingle pour
      // les chains .from().select().ilike().maybeSingle().
      builder.maybeSingle = () => Promise.resolve(resp);
      builder.then = (onFulfilled: (r: Resp) => unknown) => onFulfilled(resp);
      return builder;
    },
  }),
}));

// generateOptOutToken / verifyOptOutToken — on stubbe la vérif pour passer
// en happy path sans avoir à signer un token réel. F-027 : la signature
// retourne maintenant des objets ({ valid, email, expiresAt } /
// { token, expiresAt }).
vi.mock("@/lib/rgpd/opt-out-token", () => ({
  verifyOptOutToken: () => ({
    valid: true,
    email: "user@example.com",
    expiresAt: new Date("2099-01-01T00:00:00Z"),
  }),
  generateOptOutToken: () => ({
    token: "stub-token",
    expiresAt: new Date("2099-01-01T00:00:00Z"),
  }),
}));

// F-027 : audit log forensique opt_out_unsubscribed. Stub la fonction pour
// vérifier qu'elle est appelée avec event_type correct.
const logAuthEventMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: logAuthEventMock,
}));

// sendTemplate : on n'a pas besoin de l'évaluer dans ces tests T-110.
const sendTemplateMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("@/lib/resend/send", () => ({
  sendTemplate: sendTemplateMock,
}));
vi.mock("@/lib/resend/templates/opt-out-link", () => ({
  default: () => null,
  subject: () => "Désabonnement",
}));

import { unsubscribeAction } from "@/app/(public)/desabonnement/unsubscribe-action";
import { requestNewOptOutLinkAction } from "@/app/(public)/desabonnement/request-new-link-action";

beforeEach(() => {
  captured = {
    fromCalls: [],
    deletes: 0,
    eqCalls: [],
    ilikeCalls: [],
  };
  responses = {};
  sendTemplateMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("unsubscribeAction (T-110 — match email .ilike)", () => {
  it("DELETE producer_interests via .ilike sur email (case-insensitive)", async () => {
    responses.producer_interests = [{ data: [{ id: "row-1" }], error: null }];
    const fd = new FormData();
    // Email saisi en mixed-case côté formulaire ; après .toLowerCase()
    // côté action, le match .ilike doit toujours fonctionner contre une
    // row stockée historiquement en majuscules (defense-in-depth).
    fd.set("email", "User@Example.COM");
    fd.set("token", "stub-token");

    const res = await unsubscribeAction(fd);

    expect(res).toEqual({ success: true });
    expect(captured.deletes).toBe(1);
    expect(captured.ilikeCalls).toContainEqual({
      table: "producer_interests",
      col: "email",
      val: "user@example.com",
    });
    // Garde-fou T-110 : pas de .eq sur email (sensible à la casse).
    expect(
      captured.eqCalls.find(
        (c) => c.table === "producer_interests" && c.col === "email",
      ),
    ).toBeUndefined();
    // F-027 : audit log opt_out_unsubscribed émis avec event_type correct
    expect(logAuthEventMock).toHaveBeenCalledOnce();
    // Cast nécessaire : vi.fn(async () => {}) sans signature explicite type
    // mock.calls comme [][]. Le double cast `unknown[]` puis `[0] as T`
    // récupère l'argument typé sans perdre la sécurité (vs `any`).
    const eventArg = (logAuthEventMock.mock.calls[0] as unknown[])[0] as {
      eventType: string;
      metadata?: { email_masked?: string; rows_deleted?: number };
    };
    expect(eventArg.eventType).toBe("opt_out_unsubscribed");
    expect(eventArg.metadata?.email_masked).toContain("***@example.com");
    expect(eventArg.metadata?.rows_deleted).toBe(1);
  });
});

describe("requestNewOptOutLinkAction (T-110 — match email .ilike)", () => {
  it("SELECT producer_interests via .ilike sur email (case-insensitive)", async () => {
    responses.producer_interests = [
      { data: { email: "user@example.com" }, error: null },
    ];
    const fd = new FormData();
    // L'utilisateur ressaisit son email avec une casse différente : le
    // SELECT doit le retrouver pour déclencher le renvoi du lien.
    fd.set("email", "User@Example.COM");

    const res = await requestNewOptOutLinkAction(fd);

    expect(res.success).toBe(true);
    // Le schema z.string().toLowerCase() normalise côté input ; la WHERE
    // .ilike garantit en plus le match contre la base (défense en profondeur).
    expect(captured.ilikeCalls).toContainEqual({
      table: "producer_interests",
      col: "email",
      val: "user@example.com",
    });
    expect(
      captured.eqCalls.find(
        (c) => c.table === "producer_interests" && c.col === "email",
      ),
    ).toBeUndefined();
    // sendTemplate a bien été déclenché (lead trouvé).
    expect(sendTemplateMock).toHaveBeenCalledOnce();
  });
});
