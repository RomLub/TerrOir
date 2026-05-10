import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

// F-042 (audit pré-launch 2026-05-11) — la fonction lit désormais l'état
// précédent côté DB AVANT l'UPDATE pour détecter la transition
// `charges_enabled: true → false`. Le mock distingue les chaînes :
//   - SELECT : from('producers').select(...).eq('stripe_account_id', X).maybeSingle()
//   - UPDATE : from('producers').update({...}).eq('stripe_account_id', X).select('id')
//   - SELECT users : from('users').select('email').eq('id', X).maybeSingle()
//     (uniquement en cas de transition détectée, pour fetch email producer)

// Hoisted mocks pour ops alert + sendTemplate (Resend) + waitUntil.
const { mockSendOpsAlert, mockSendTemplate, mockWaitUntil } = vi.hoisted(() => ({
  mockSendOpsAlert: vi.fn(async () => undefined),
  mockSendTemplate: vi.fn(async () => ({ ok: true, id: "email_1" })),
  mockWaitUntil: vi.fn((p: Promise<unknown>) => {
    void p;
  }),
}));

vi.mock("@/lib/ops/alert", () => ({
  sendOpsAlert: mockSendOpsAlert,
}));

vi.mock("@/lib/resend/send", () => ({
  sendTemplate: mockSendTemplate,
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: mockWaitUntil,
}));

vi.mock("@/lib/env/urls", () => ({
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
}));

// Stub template (jamais rendu, mockSendTemplate intercepte).
vi.mock("@/lib/resend/templates/producer-kyc-blocked", () => ({
  default: () => null,
  subject: () => "[TerrOir] KYC blocked",
}));

import { syncStripeAccountFlags } from "@/lib/stripe/sync-account-flags";

type Resp = { data?: unknown; error?: unknown };

type Captured = {
  fromCalls: string[];
  updates: unknown[];
  // Filtres .eq sur la chaîne SELECT (producer prev) — tuple [col, val].
  selectEqs: Array<[string, unknown]>;
  // Filtres .eq sur la chaîne UPDATE — tuple [col, val].
  updateEqs: Array<[string, unknown]>;
  // .select args sur chaîne UPDATE (post-.eq).
  updateSelectCols: string[];
};

function makeSupabase(opts: {
  producerPrev?: Resp;
  userEmail?: Resp;
  updateResp?: Resp;
}): { client: SupabaseClient; captured: Captured } {
  const captured: Captured = {
    fromCalls: [],
    updates: [],
    selectEqs: [],
    updateEqs: [],
    updateSelectCols: [],
  };

  const producerPrev = opts.producerPrev ?? {
    data: { id: "producer-42", user_id: "user-42", nom_exploitation: "Ferme Test", stripe_charges_enabled: false },
    error: null,
  };
  const userEmail = opts.userEmail ?? {
    data: { email: "producer@example.com" },
    error: null,
  };
  const updateResp = opts.updateResp ?? {
    data: [{ id: "producer-42" }],
    error: null,
  };

  const client = {
    from: (table: string) => {
      captured.fromCalls.push(table);

      if (table === "producers") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const root: any = {};
        // SELECT path : select(...).eq(...).maybeSingle()
        root.select = () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sel: any = {};
          sel.eq = (col: string, val: unknown) => {
            captured.selectEqs.push([col, val]);
            return sel;
          };
          sel.maybeSingle = () => Promise.resolve(producerPrev);
          return sel;
        };
        // UPDATE path : update(...).eq(...).select('id') [thenable]
        root.update = (payload: unknown) => {
          captured.updates.push(payload);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const upd: any = {};
          upd.eq = (col: string, val: unknown) => {
            captured.updateEqs.push([col, val]);
            return upd;
          };
          upd.select = (cols: string) => {
            captured.updateSelectCols.push(cols);
            return upd;
          };
          upd.then = (onFulfilled: (r: Resp) => unknown) =>
            onFulfilled(updateResp);
          return upd;
        };
        return root;
      }

      if (table === "users") {
        // SELECT path users : select('email').eq('id', X).maybeSingle()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const root: any = {};
        root.select = () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve(userEmail),
          }),
        });
        return root;
      }

      // Fallback no-op.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fb: any = {};
      fb.select = () => fb;
      fb.eq = () => fb;
      fb.maybeSingle = () => Promise.resolve({ data: null, error: null });
      fb.update = () => fb;
      fb.then = (onFulfilled: (r: Resp) => unknown) =>
        onFulfilled({ data: null, error: null });
      return fb;
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

function makeAccount(opts: {
  id?: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirements?: {
    disabled_reason?: string | null;
    currently_due?: string[];
  };
}): Stripe.Account {
  return {
    id: opts.id ?? "acct_test",
    charges_enabled: opts.chargesEnabled,
    payouts_enabled: opts.payoutsEnabled,
    details_submitted: opts.detailsSubmitted,
    requirements: opts.requirements,
  } as unknown as Stripe.Account;
}

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  mockSendOpsAlert.mockClear();
  mockSendTemplate.mockClear();
  mockWaitUntil.mockClear();
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  consoleWarnSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

describe("syncStripeAccountFlags — account fully onboarded", () => {
  it("UPDATE les 3 flags à true et retourne updated=true + producerId", async () => {
    const { client, captured } = makeSupabase({});
    const account = makeAccount({
      id: "acct_full",
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    const result = await syncStripeAccountFlags(account, client);

    expect(result).toEqual({ updated: true, producerId: "producer-42" });
    // 1 SELECT (prev state) + 1 UPDATE — les deux ciblent 'producers'.
    expect(captured.fromCalls.filter((t) => t === "producers")).toHaveLength(2);
    expect(captured.updates).toEqual([
      {
        stripe_charges_enabled: true,
        stripe_payouts_enabled: true,
        stripe_details_submitted: true,
      },
    ]);
    expect(captured.updateEqs).toEqual([["stripe_account_id", "acct_full"]]);
    expect(captured.updateSelectCols).toEqual(["id"]);
  });

  it("émet le log [STRIPE_ACCOUNT_UPDATED] avec account.id et les 3 flags", async () => {
    const { client } = makeSupabase({});
    const account = makeAccount({
      id: "acct_full",
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    await syncStripeAccountFlags(account, client);

    expect(consoleLogSpy).toHaveBeenCalled();
    const logged = String(consoleLogSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("[STRIPE_ACCOUNT_UPDATED]");
    expect(logged).toContain("account=acct_full");
    expect(logged).toContain("charges=true");
    expect(logged).toContain("payouts=true");
    expect(logged).toContain("details=true");
  });
});

describe("syncStripeAccountFlags — account partial (KYC soumis mais charges KO)", () => {
  it("écrit les flags conformes aux valeurs Stripe, pas d'agrégat onboarding_completed", async () => {
    const { client, captured } = makeSupabase({});
    const account = makeAccount({
      id: "acct_partial",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: true,
    });

    const result = await syncStripeAccountFlags(account, client);

    expect(result.updated).toBe(true);
    expect(captured.updates).toEqual([
      {
        stripe_charges_enabled: false,
        stripe_payouts_enabled: false,
        stripe_details_submitted: true,
      },
    ]);
  });
});

describe("syncStripeAccountFlags — account réinitialisé (3 flags Stripe à false)", () => {
  it("UPDATE les 3 flags à false (cas reset Stripe ou compte créé sans onboarding)", async () => {
    const { client, captured } = makeSupabase({});
    const account = makeAccount({
      id: "acct_reset",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    });

    const result = await syncStripeAccountFlags(account, client);

    expect(result.updated).toBe(true);
    expect(captured.updates).toEqual([
      {
        stripe_charges_enabled: false,
        stripe_payouts_enabled: false,
        stripe_details_submitted: false,
      },
    ]);
  });
});

describe("syncStripeAccountFlags — coercion booléenne défensive", () => {
  it("traite undefined / null des champs Stripe.Account comme false (jamais NaN, jamais throw)", async () => {
    const { client, captured } = makeSupabase({});
    // Stripe SDK type ces 3 champs comme `boolean` mais le runtime peut
    // retourner undefined sur des comptes très neufs ou dans des états de
    // transition — la double-négation (!!) garantit qu'on n'écrit jamais
    // undefined/null sur des colonnes NOT NULL.
    const account = {
      id: "acct_minimal",
      // charges_enabled/payouts_enabled/details_submitted volontairement absents
    } as unknown as Stripe.Account;

    const result = await syncStripeAccountFlags(account, client);

    expect(result.updated).toBe(true);
    expect(captured.updates).toEqual([
      {
        stripe_charges_enabled: false,
        stripe_payouts_enabled: false,
        stripe_details_submitted: false,
      },
    ]);
  });
});

describe("syncStripeAccountFlags — producer absent (UPDATE 0 rows)", () => {
  it("retourne updated=false + producerId=null sans throw (cas orphelin / RGPD)", async () => {
    const { client, captured } = makeSupabase({
      producerPrev: { data: null, error: null },
      updateResp: { data: [], error: null },
    });
    const account = makeAccount({
      id: "acct_orphan",
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    const result = await syncStripeAccountFlags(account, client);

    expect(result).toEqual({ updated: false, producerId: null });
    expect(captured.updates).toHaveLength(1);
    expect(consoleWarnSpy).toHaveBeenCalled();
    const warned = String(consoleWarnSpy.mock.calls[0]?.[0] ?? "");
    expect(warned).toContain("[STRIPE_ACCOUNT_NOT_FOUND]");
    expect(warned).toContain("account=acct_orphan");
  });
});

describe("syncStripeAccountFlags — erreur PostgREST", () => {
  it("log [STRIPE_ACCOUNT_UPDATED_ERR] et retourne updated=false sans throw", async () => {
    const { client } = makeSupabase({
      updateResp: { data: null, error: { message: "RLS policy violation" } },
    });
    const account = makeAccount({
      id: "acct_rls_denied",
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    const result = await syncStripeAccountFlags(account, client);

    expect(result).toEqual({ updated: false, producerId: null });
    expect(consoleWarnSpy).toHaveBeenCalled();
    const warned = consoleWarnSpy.mock.calls
      .map((c: unknown[]) => String(c?.[0] ?? ""))
      .find((s: string) => s.includes("[STRIPE_ACCOUNT_UPDATED_ERR]"));
    expect(warned).toBeDefined();
    expect(warned).toContain("account=acct_rls_denied");
    expect(warned).toContain("RLS policy violation");
  });

  it("ne throw PAS même si error.message est absent (defensive)", async () => {
    const { client } = makeSupabase({
      updateResp: { data: null, error: {} as Record<string, unknown> },
    });
    const account = makeAccount({
      id: "acct_unknown_err",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    });

    await expect(
      syncStripeAccountFlags(account, client),
    ).resolves.toEqual({ updated: false, producerId: null });
    expect(consoleWarnSpy).toHaveBeenCalled();
  });
});

// =============================================================================
// F-042 (audit pré-launch 2026-05-11) — détection transition charges_enabled
// true → false : ops alert + email producer.
// =============================================================================

describe("syncStripeAccountFlags — F-042 transition charges_enabled true→false", () => {
  it("transition true→false → sendOpsAlert + sendTemplate(producer_kyc_blocked) déclenchés", async () => {
    const { client } = makeSupabase({
      producerPrev: {
        data: {
          id: "producer-42",
          user_id: "user-42",
          nom_exploitation: "Ferme Test",
          stripe_charges_enabled: true,
        },
        error: null,
      },
    });
    const account = makeAccount({
      id: "acct_blocked",
      chargesEnabled: false,
      payoutsEnabled: true,
      detailsSubmitted: true,
      requirements: {
        disabled_reason: "requirements.past_due",
        currently_due: ["individual.id_number", "tos_acceptance.date"],
      },
    });

    const result = await syncStripeAccountFlags(account, client);

    expect(result).toEqual({ updated: true, producerId: "producer-42" });
    // waitUntil appelé 2 fois (ops alert + email producer).
    expect(mockWaitUntil).toHaveBeenCalledTimes(2);
    expect(mockSendOpsAlert).toHaveBeenCalledTimes(1);
    const opsCall = mockSendOpsAlert.mock.calls[0] as unknown[];
    expect(opsCall?.[0]).toBe("[STRIPE_CHARGES_DISABLED]");
    expect(opsCall?.[2]).toMatchObject({
      producer_id: "producer-42",
      stripe_account_id: "acct_blocked",
      disabled_reason: "requirements.past_due",
      currently_due: ["individual.id_number", "tos_acceptance.date"],
    });
    expect(mockSendTemplate).toHaveBeenCalledTimes(1);
    expect(mockSendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "producer@example.com",
        template: "producer_kyc_blocked",
        userId: "user-42",
      }),
    );
  });

  it("transition false→true (déblocage) → AUCUN ops alert, AUCUN email", async () => {
    const { client } = makeSupabase({
      producerPrev: {
        data: {
          id: "producer-42",
          user_id: "user-42",
          nom_exploitation: "Ferme Test",
          stripe_charges_enabled: false,
        },
        error: null,
      },
    });
    const account = makeAccount({
      id: "acct_unblocked",
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    const result = await syncStripeAccountFlags(account, client);

    expect(result.updated).toBe(true);
    expect(mockSendOpsAlert).not.toHaveBeenCalled();
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("transition true→true (no-op) → AUCUN ops alert, AUCUN email", async () => {
    const { client } = makeSupabase({
      producerPrev: {
        data: {
          id: "producer-42",
          user_id: "user-42",
          nom_exploitation: "Ferme Test",
          stripe_charges_enabled: true,
        },
        error: null,
      },
    });
    const account = makeAccount({
      id: "acct_steady",
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    const result = await syncStripeAccountFlags(account, client);

    expect(result.updated).toBe(true);
    expect(mockSendOpsAlert).not.toHaveBeenCalled();
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("transition false→false (déjà bloqué) → AUCUN ops alert (anti-spam rejouage)", async () => {
    const { client } = makeSupabase({
      producerPrev: {
        data: {
          id: "producer-42",
          user_id: "user-42",
          nom_exploitation: "Ferme Test",
          stripe_charges_enabled: false,
        },
        error: null,
      },
    });
    const account = makeAccount({
      id: "acct_still_blocked",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: true,
      requirements: {
        disabled_reason: "requirements.past_due",
        currently_due: ["individual.id_number"],
      },
    });

    const result = await syncStripeAccountFlags(account, client);

    expect(result.updated).toBe(true);
    expect(mockSendOpsAlert).not.toHaveBeenCalled();
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("transition true→false avec producer.user_id null → ops alert posé, email skip + log", async () => {
    const { client } = makeSupabase({
      producerPrev: {
        data: {
          id: "producer-orphan",
          user_id: null,
          nom_exploitation: "Producteur legacy",
          stripe_charges_enabled: true,
        },
        error: null,
      },
    });
    const account = makeAccount({
      id: "acct_no_user",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: true,
      requirements: {
        disabled_reason: "rejected.fraud",
        currently_due: [],
      },
    });

    await syncStripeAccountFlags(account, client);

    expect(mockSendOpsAlert).toHaveBeenCalledTimes(1);
    // Email tentative déclenchée mais court-circuitée par user_id null.
    // sendTemplate ne doit pas être appelé.
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });
});
