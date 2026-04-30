// Vitest pour processWeeklyPayouts (cron weekly-payout).
//
// Couverture T-414 (drift double-payout) :
//   - Path nominal : INSERT 'processing' AVANT transfer Stripe + idempotencyKey
//   - Skip 'paid' (cas (d) déjà fini)
//   - Resume 'processing' (cas (b) crash avant transfer / cas (c) crash avant UPDATE)
//   - Skip 'failed' (défensif Bundle 3 TB)
//   - Skip 'pending' legacy (T-424 reflag migration one-shot)
//   - Producer not_ready (R1 : pas d'INSERT fantôme)
//   - Crash transfer.create → compensation A2 (UPDATE 'failed' + audit + Resend
//     + notification, alignée handle-payout-failed.tsx Bundle 3 TB)
//   - Crash UPDATE 'paid' → row reste 'processing'
//   - Anti-régression T-414 : ordre INSERT-before-transfer vérifié via invocationCallOrder
//   - idempotencyKey forme exacte `transfer_${producerId}_${periodeDebut}`
//
// Pattern aligné tests/lib/stripe/retry-failed-refund.test.ts (vi.mock @/lib/stripe/server).
// Mock createSupabaseAdminClient retourne un builder chaînable avec queues
// par table+opération.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `lib/stripe/payouts.tsx` importe 'server-only' (virtuel Next) — stub.
vi.mock("server-only", () => ({}));

const {
  mockTransferCreate,
  mockCreateAdminClient,
  mockLogPaymentEvent,
  mockSendTemplate,
  mockWaitUntil,
} = vi.hoisted(() => ({
  mockTransferCreate: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockLogPaymentEvent: vi.fn(),
  mockSendTemplate: vi.fn(),
  mockWaitUntil: vi.fn(),
}));

vi.mock("@/lib/stripe/server", () => ({
  stripe: {
    transfers: { create: mockTransferCreate },
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/audit-logs/log-payment-event", () => ({
  logPaymentEvent: mockLogPaymentEvent,
}));

vi.mock("@/lib/resend/send", () => ({
  sendTemplate: mockSendTemplate,
}));

vi.mock("@/lib/env/support-email", () => ({
  SUPPORT_EMAIL: "admin@terroir-test.fr",
}));

// Le template JSX consomme @react-email/* lors du render. On le remplace
// par une factory minimale — `processWeeklyPayouts` ne fait que passer la
// référence à `sendTemplate` (qui est aussi mocké).
vi.mock("@/lib/resend/templates/admin-transfer-failed", () => ({
  default: (props: unknown) => ({ __template: "admin_transfer_failed", props }),
  subject: (p: { exploitation: string | null }) =>
    `[TerrOir Admin] Transfer Stripe échoué — ${p.exploitation ?? "producteur inconnu"}`,
}));

// waitUntil : exécute le callback immédiatement et attend sa résolution dans
// le test pour stabilité des assertions (pas de fire-and-forget en test).
vi.mock("@vercel/functions", () => ({
  waitUntil: mockWaitUntil,
}));

import { processWeeklyPayouts } from "@/lib/stripe/payouts";

// --- Supabase admin client mock ------------------------------------------

type Resp = { data?: unknown; error?: unknown };
type Op = "select" | "insert" | "update";

type Captured = {
  fromCalls: string[];
  inserts: Array<{ table: string; payload: unknown }>;
  updates: Array<{ table: string; payload: unknown }>;
};

let captured: Captured;
let responses: Record<string, Partial<Record<Op, Resp[]>>>;

function consume(table: string, op: Op): Resp {
  const queue = responses[table]?.[op];
  if (queue && queue.length > 0) return queue.shift()!;
  return { data: null, error: null };
}

function makeAdminClient() {
  return {
    from(table: string) {
      captured.fromCalls.push(table);
      // Op tracking : la 1re méthode terminale (select/insert/update) fixe
      // le type de réponse à consommer. consume() ne s'exécute qu'au
      // terminal (then/maybeSingle/single) pour éviter le double-consume
      // sur les chaînes select().eq().gte().lte() ou insert().select().single().
      let pendingOp: Op = "select";

      const setOp = (op: Op) => {
        // Conserve la 1re op rencontrée (insert avant le .select() de
        // returning rest API). Update et select sont terminaux.
        if (pendingOp === "select") pendingOp = op;
      };

      const builder: any = {
        select(_cols: string) {
          return builder;
        },
        insert(payload: unknown) {
          captured.inserts.push({ table, payload });
          setOp("insert");
          return builder;
        },
        update(payload: unknown) {
          captured.updates.push({ table, payload });
          setOp("update");
          return builder;
        },
        eq(_col: string, _val: unknown) {
          return builder;
        },
        gte(_col: string, _val: unknown) {
          return builder;
        },
        lte(_col: string, _val: unknown) {
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(consume(table, pendingOp));
        },
        single() {
          return Promise.resolve(consume(table, pendingOp));
        },
        then(onFulfilled: (r: Resp) => unknown) {
          return Promise.resolve(consume(table, pendingOp)).then(onFulfilled);
        },
      };
      return builder;
    },
  };
}

// --- Helpers commande / fixtures -----------------------------------------

const PRODUCER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";

function defaultOrder() {
  return {
    id: ORDER_ID,
    code_commande: "ABC123",
    date_retrait: "2026-04-25",
    producer_id: PRODUCER_ID,
    montant_total: 100,
    commission_terroir: 6,
    montant_net_producteur: 94,
  };
}

// `previousWeekRange` retourne lundi N-1 → dimanche N-1 23:59.
// On capture la date à laquelle le test tourne pour reproduire le periodeDebut.
function expectedPeriodeDebut(): string {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const thisMonday = new Date(now);
  thisMonday.setUTCDate(now.getUTCDate() - daysSinceMonday);
  thisMonday.setUTCHours(0, 0, 0, 0);
  const start = new Date(thisMonday);
  start.setUTCDate(thisMonday.getUTCDate() - 7);
  return start.toISOString().slice(0, 10);
}

function expectedIdempotencyKey(): string {
  return `transfer_${PRODUCER_ID}_${expectedPeriodeDebut()}`;
}

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = { fromCalls: [], inserts: [], updates: [] };
  responses = {};
  mockTransferCreate.mockReset();
  mockCreateAdminClient.mockReset().mockImplementation(() => makeAdminClient());
  mockLogPaymentEvent.mockReset().mockResolvedValue(undefined);
  mockSendTemplate.mockReset().mockResolvedValue({ ok: true, id: "email_test" });
  // waitUntil : on exécute le callback immédiatement (Vercel-side réel
  // détache le promise), et on capture l'argument pour assertion.
  mockWaitUntil.mockReset().mockImplementation((p: Promise<unknown>) => p);
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  consoleWarnSpy.mockRestore();
});

// =============================================================================
// 1. Path nominal — 0 existing row → INSERT 'processing' → transfer → UPDATE 'paid'
// =============================================================================
describe("processWeeklyPayouts — path nominal (0 existing row)", () => {
  it("INSERT 'processing' AVANT transfer + idempotencyKey + UPDATE 'paid' après", async () => {
    responses = {
      orders: { select: [{ data: [defaultOrder()], error: null }] },
      payouts: {
        select: [{ data: null, error: null }], // existing check → no row
        insert: [{ data: { id: "payout-new-1" }, error: null }],
        update: [{ data: null, error: null }],
      },
      producers: {
        select: [
          {
            data: {
              stripe_account_id: "acct_test",
              stripe_payouts_enabled: true,
            },
            error: null,
          },
        ],
      },
    };

    mockTransferCreate.mockResolvedValue({ id: "tr_new_1" } as never);

    const { results } = await processWeeklyPayouts();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      producer_id: PRODUCER_ID,
      payout_id: "payout-new-1",
      stripe_transfer_id: "tr_new_1",
      montantNet: 94,
    });
    expect(results[0].error).toBeUndefined();
    expect(results[0].skipped).toBeUndefined();
    expect(results[0].resumed).toBeUndefined();

    // INSERT a posé statut='processing' avec stripe_transfer_id=null.
    expect(captured.inserts).toEqual([
      {
        table: "payouts",
        payload: expect.objectContaining({
          producer_id: PRODUCER_ID,
          statut: "processing",
          stripe_transfer_id: null,
          montant_brut: 100,
          commission: 6,
          montant_net: 94,
        }),
      },
    ]);

    // UPDATE final = statut='paid' + stripe_transfer_id renseigné.
    expect(captured.updates).toEqual([
      {
        table: "payouts",
        payload: { statut: "paid", stripe_transfer_id: "tr_new_1" },
      },
    ]);

    // idempotencyKey passée en 2e arg de transfers.create.
    expect(mockTransferCreate).toHaveBeenCalledTimes(1);
    expect(mockTransferCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 9400,
        currency: "eur",
        destination: "acct_test",
        metadata: expect.objectContaining({ producer_id: PRODUCER_ID }),
      }),
      { idempotencyKey: expectedIdempotencyKey() },
    );

    // T-416 audit log forensique posé après UPDATE 'paid' succès.
    // userId=null, format cents, resumed=false sur path nominal.
    expect(mockLogPaymentEvent).toHaveBeenCalledTimes(1);
    expect(mockLogPaymentEvent).toHaveBeenCalledWith({
      eventType: "stripe_transfer_initiated",
      userId: null,
      metadata: {
        payout_id: "payout-new-1",
        stripe_transfer_id: "tr_new_1",
        producer_id: PRODUCER_ID,
        periode_debut: expect.any(String),
        periode_fin: expect.any(String),
        montant_brut_cents: 10000,
        commission_cents: 600,
        montant_net_cents: 9400,
        currency: "eur",
        orders_count: 1,
        resumed: false,
      },
    });
  });

  it("anti-régression T-414 : INSERT 'processing' invocation order < transfer.create order", async () => {
    // Avant le fix T-414, la séquence était transfer-then-INSERT. Si le
    // transfer réussissait mais INSERT échouait, le run suivant ne trouvait
    // pas le row et relançait le transfer → DOUBLE PAYOUT. Ce test fige
    // l'ordre INSERT-before-transfer via invocationCallOrder (vitest API).
    responses = {
      orders: { select: [{ data: [defaultOrder()], error: null }] },
      payouts: {
        select: [{ data: null, error: null }],
        insert: [{ data: { id: "payout-order-1" }, error: null }],
        update: [{ data: null, error: null }],
      },
      producers: {
        select: [
          {
            data: {
              stripe_account_id: "acct_test",
              stripe_payouts_enabled: true,
            },
            error: null,
          },
        ],
      },
    };

    let insertCallOrder = 0;
    let transferCallOrder = 0;
    let counter = 0;

    mockCreateAdminClient.mockImplementation(() => {
      const realClient = makeAdminClient();
      return {
        from(table: string) {
          const builder = realClient.from(table);
          const origInsert = builder.insert.bind(builder);
          builder.insert = (payload: unknown) => {
            if (table === "payouts") insertCallOrder = ++counter;
            return origInsert(payload);
          };
          return builder;
        },
      };
    });

    mockTransferCreate.mockImplementation(async () => {
      transferCallOrder = ++counter;
      return { id: "tr_order_check" } as never;
    });

    await processWeeklyPayouts();

    expect(insertCallOrder).toBeGreaterThan(0);
    expect(transferCallOrder).toBeGreaterThan(0);
    expect(insertCallOrder).toBeLessThan(transferCallOrder);
  });
});

// =============================================================================
// 2. Skip — existing 'paid' (cas (d))
// =============================================================================
describe("processWeeklyPayouts — skip existing 'paid'", () => {
  it("results push skipped='already_exists', pas d'appel Stripe", async () => {
    responses = {
      orders: { select: [{ data: [defaultOrder()], error: null }] },
      payouts: {
        select: [
          {
            data: {
              id: "payout-paid-1",
              statut: "paid",
              stripe_transfer_id: "tr_existing",
              montant_net: 94,
            },
            error: null,
          },
        ],
      },
    };

    const { results } = await processWeeklyPayouts();

    expect(results).toHaveLength(1);
    expect(results[0].skipped).toBe("already_exists");
    expect(results[0].payout_id).toBe("payout-paid-1");
    expect(results[0].stripe_transfer_id).toBe("tr_existing");
    expect(mockTransferCreate).not.toHaveBeenCalled();
    expect(captured.inserts).toEqual([]);
    expect(captured.updates).toEqual([]);
    // T-416 : skip 'paid' (cas d) → audit_log non posé.
    expect(mockLogPaymentEvent).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 3. Resume — existing 'processing' cas (b) : crash avant transfer
// =============================================================================
describe("processWeeklyPayouts — resume existing 'processing' (cas b)", () => {
  it("retente transfer + UPDATE 'paid' + resumed=true", async () => {
    responses = {
      orders: { select: [{ data: [defaultOrder()], error: null }] },
      payouts: {
        select: [
          {
            data: {
              id: "payout-resume-1",
              statut: "processing",
              stripe_transfer_id: null,
              montant_net: 94,
              montant_brut: 100,
              commission: 6,
            },
            error: null,
          },
        ],
        update: [{ data: null, error: null }],
      },
      producers: {
        select: [
          {
            data: {
              stripe_account_id: "acct_test",
              stripe_payouts_enabled: true,
            },
            error: null,
          },
        ],
      },
    };

    mockTransferCreate.mockResolvedValue({ id: "tr_resume_b" } as never);

    const { results } = await processWeeklyPayouts();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      payout_id: "payout-resume-1",
      stripe_transfer_id: "tr_resume_b",
      resumed: true,
    });
    expect(results[0].error).toBeUndefined();

    // Pas d'INSERT (le row existait déjà).
    expect(captured.inserts).toEqual([]);
    // UPDATE statut='paid' + transfer.id.
    expect(captured.updates).toEqual([
      {
        table: "payouts",
        payload: { statut: "paid", stripe_transfer_id: "tr_resume_b" },
      },
    ]);
    // idempotencyKey passée.
    expect(mockTransferCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 9400, destination: "acct_test" }),
      { idempotencyKey: expectedIdempotencyKey() },
    );

    // T-416 audit log forensique posé après UPDATE 'paid' resume.
    // resumed=true, montants depuis existing row (source of truth DB).
    expect(mockLogPaymentEvent).toHaveBeenCalledTimes(1);
    expect(mockLogPaymentEvent).toHaveBeenCalledWith({
      eventType: "stripe_transfer_initiated",
      userId: null,
      metadata: {
        payout_id: "payout-resume-1",
        stripe_transfer_id: "tr_resume_b",
        producer_id: PRODUCER_ID,
        periode_debut: expect.any(String),
        periode_fin: expect.any(String),
        montant_brut_cents: 10000,
        commission_cents: 600,
        montant_net_cents: 9400,
        currency: "eur",
        orders_count: 1,
        resumed: true,
      },
    });
  });

  it("cas (c) : Stripe renvoie le Transfer existant via idempotency cache → UPDATE 'paid' OK", async () => {
    // En cas (c), Stripe a déjà reçu et exécuté le transfer la 1re fois.
    // La même idempotencyKey renvoie le MÊME Transfer (pas de double).
    responses = {
      orders: { select: [{ data: [defaultOrder()], error: null }] },
      payouts: {
        select: [
          {
            data: {
              id: "payout-resume-c",
              statut: "processing",
              stripe_transfer_id: null,
              montant_net: 94,
              montant_brut: 100,
              commission: 6,
            },
            error: null,
          },
        ],
        update: [{ data: null, error: null }],
      },
      producers: {
        select: [
          {
            data: {
              stripe_account_id: "acct_test",
              stripe_payouts_enabled: true,
            },
            error: null,
          },
        ],
      },
    };

    // Stripe renvoie l'id du Transfer original (idempotency).
    mockTransferCreate.mockResolvedValue({ id: "tr_original_from_cache" } as never);

    const { results } = await processWeeklyPayouts();

    expect(results[0].stripe_transfer_id).toBe("tr_original_from_cache");
    expect(results[0].resumed).toBe(true);
    expect(captured.updates[0]).toEqual({
      table: "payouts",
      payload: { statut: "paid", stripe_transfer_id: "tr_original_from_cache" },
    });

    // T-416 : cas (c) idempotency cache → audit log identique resume cas (b).
    expect(mockLogPaymentEvent).toHaveBeenCalledTimes(1);
    expect(mockLogPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "stripe_transfer_initiated",
        userId: null,
        metadata: expect.objectContaining({
          payout_id: "payout-resume-c",
          stripe_transfer_id: "tr_original_from_cache",
          resumed: true,
        }),
      }),
    );
  });
});

// =============================================================================
// 4. Skip — existing 'failed' (défensif Bundle 3 TB)
// =============================================================================
describe("processWeeklyPayouts — skip existing 'failed' (défensif)", () => {
  it("results push error='previously failed', pas d'appel Stripe", async () => {
    responses = {
      orders: { select: [{ data: [defaultOrder()], error: null }] },
      payouts: {
        select: [
          {
            data: {
              id: "payout-failed-1",
              statut: "failed",
              stripe_transfer_id: null,
              montant_net: 94,
            },
            error: null,
          },
        ],
      },
    };

    const { results } = await processWeeklyPayouts();

    expect(results[0].error).toContain("previously failed");
    expect(results[0].payout_id).toBe("payout-failed-1");
    expect(mockTransferCreate).not.toHaveBeenCalled();
    expect(captured.inserts).toEqual([]);
    expect(captured.updates).toEqual([]);
    // T-416 : skip 'failed' → audit_log non posé.
    expect(mockLogPaymentEvent).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 5. Skip — existing 'pending' legacy (T-424 reflag)
// =============================================================================
describe("processWeeklyPayouts — skip 'pending' legacy (T-424)", () => {
  it("results push error='legacy pending row', pas d'appel Stripe", async () => {
    responses = {
      orders: { select: [{ data: [defaultOrder()], error: null }] },
      payouts: {
        select: [
          {
            data: {
              id: "payout-legacy-1",
              statut: "pending",
              stripe_transfer_id: null,
              montant_net: 94,
            },
            error: null,
          },
        ],
      },
    };

    const { results } = await processWeeklyPayouts();

    expect(results[0].error).toContain("legacy pending");
    expect(results[0].error).toContain("T-424");
    expect(mockTransferCreate).not.toHaveBeenCalled();
    expect(captured.inserts).toEqual([]);
    // T-416 : skip 'pending' legacy (T-424) → audit_log non posé.
    expect(mockLogPaymentEvent).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 6. Producer not_ready (R1 : pas d'INSERT fantôme)
// =============================================================================
describe("processWeeklyPayouts — producer not_ready (R1)", () => {
  it("aucun INSERT 'processing' si stripe_account_id absent", async () => {
    responses = {
      orders: { select: [{ data: [defaultOrder()], error: null }] },
      payouts: { select: [{ data: null, error: null }] },
      producers: {
        select: [
          {
            data: { stripe_account_id: null, stripe_payouts_enabled: false },
            error: null,
          },
        ],
      },
    };

    const { results } = await processWeeklyPayouts();

    expect(results[0].error).toContain("no stripe_account_id");
    expect(captured.inserts).toEqual([]);
    expect(mockTransferCreate).not.toHaveBeenCalled();
    // T-416 : producer not_ready → audit_log non posé.
    expect(mockLogPaymentEvent).not.toHaveBeenCalled();
  });

  it("aucun INSERT 'processing' si stripe_payouts_enabled=false + log [PAYOUT_SKIP_NOT_READY]", async () => {
    responses = {
      orders: { select: [{ data: [defaultOrder()], error: null }] },
      payouts: { select: [{ data: null, error: null }] },
      producers: {
        select: [
          {
            data: {
              stripe_account_id: "acct_kyc_pending",
              stripe_payouts_enabled: false,
            },
            error: null,
          },
        ],
      },
    };

    const { results } = await processWeeklyPayouts();

    expect(results[0].error).toContain("not ready for payouts");
    expect(captured.inserts).toEqual([]);
    expect(mockTransferCreate).not.toHaveBeenCalled();

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "[PAYOUT_SKIP_NOT_READY]",
    );
    // T-416 : producer payouts_enabled=false → audit_log non posé.
    expect(mockLogPaymentEvent).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 7. Crash transfer.create — compensation A2 (UPDATE 'failed' + audit + Resend
//    + notification placeholder, aligné handle-payout-failed.tsx Bundle 3 TB)
// =============================================================================
describe("processWeeklyPayouts — crash transfer.create (compensation A2)", () => {
  it("transfer throw → UPDATE 'failed' + audit log stripe_transfer_failed + Resend admin + notification placeholder", async () => {
    responses = {
      orders: { select: [{ data: [defaultOrder()], error: null }] },
      payouts: {
        select: [{ data: null, error: null }],
        insert: [{ data: { id: "payout-crash-transfer" }, error: null }],
        update: [{ data: null, error: null }], // UPDATE 'failed' OK
      },
      producers: {
        select: [
          // 1er select : check stripe_account_id + payouts_enabled
          {
            data: {
              stripe_account_id: "acct_test",
              stripe_payouts_enabled: true,
            },
            error: null,
          },
          // 2e select : lookup nom_exploitation pour subject email
          {
            data: { nom_exploitation: "Ferme du Test" },
            error: null,
          },
        ],
      },
      notifications: {
        insert: [{ data: null, error: null }],
      },
    };

    mockTransferCreate.mockRejectedValue(
      new Error("Connect not authorized for this destination"),
    );

    const { results } = await processWeeklyPayouts();

    // Result : payout_id présent (row inséré), stripe_transfer_id null, error propagé.
    expect(results[0].payout_id).toBe("payout-crash-transfer");
    expect(results[0].stripe_transfer_id).toBeNull();
    expect(results[0].error).toContain("Transfer failed");
    expect(results[0].error).toContain("Connect not authorized");

    // 1. INSERT 'processing' fait (anti-régression T-414).
    expect(captured.inserts).toContainEqual({
      table: "payouts",
      payload: expect.objectContaining({ statut: "processing" }),
    });

    // 2. UPDATE 'failed' + error_msg posés sur la row (compensation A2).
    //    error_msg = column dénormalisée T-426, dérivé du throw message.
    expect(captured.updates).toContainEqual({
      table: "payouts",
      payload: {
        statut: "failed",
        error_msg: "Connect not authorized for this destination",
      },
    });

    // 3. Audit log forensique stripe_transfer_failed avec metadata complète.
    expect(mockLogPaymentEvent).toHaveBeenCalledTimes(1);
    expect(mockLogPaymentEvent).toHaveBeenCalledWith({
      eventType: "stripe_transfer_failed",
      metadata: expect.objectContaining({
        payout_id: "payout-crash-transfer",
        producer_id: PRODUCER_ID,
        montant_net_cents: 9400,
        currency: "eur",
        error_message: "Connect not authorized for this destination",
        source: "sync_transfer_create",
      }),
    });

    // 4. Notification placeholder DB (type='email', template='admin_transfer_failed').
    expect(captured.inserts).toContainEqual({
      table: "notifications",
      payload: expect.objectContaining({
        type: "email",
        template: "admin_transfer_failed",
        statut: "sent",
        metadata: expect.objectContaining({
          payout_id: "payout-crash-transfer",
          producer_id: PRODUCER_ID,
          error_message: "Connect not authorized for this destination",
        }),
      }),
    });

    // 5. Email réel admin via sendTemplate, fire-and-forget waitUntil.
    expect(mockWaitUntil).toHaveBeenCalledTimes(1);
    expect(mockSendTemplate).toHaveBeenCalledTimes(1);
    expect(mockSendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@terroir-test.fr",
        template: "admin_transfer_failed",
        userId: null,
        subject: expect.stringContaining("Ferme du Test"),
        metadata: expect.objectContaining({
          payout_id: "payout-crash-transfer",
          producer_id: PRODUCER_ID,
        }),
      }),
    );

    // 6. Log greppable [STRIPE_TRANSFER_FAILED_SYNC] posé.
    const warnedFirst = String(consoleWarnSpy.mock.calls[0]?.[0] ?? "");
    expect(warnedFirst).toContain("[STRIPE_TRANSFER_FAILED_SYNC]");
    expect(warnedFirst).toContain("payout=payout-crash-transfer");

    // T-416 : path 7 catch synchrone → stripe_transfer_initiated NON posé
    // (le path return early avant l'audit log success post-UPDATE 'paid').
    const initiatedCalls = mockLogPaymentEvent.mock.calls.filter(
      (c) => (c[0] as { eventType: string }).eventType === "stripe_transfer_initiated",
    );
    expect(initiatedCalls).toHaveLength(0);
  });

  it("cas pathologique : UPDATE 'failed' échoue → log [WEEKLY_PAYOUT_FAILED_UPDATE_FAILED] + alerte admin quand même", async () => {
    responses = {
      orders: { select: [{ data: [defaultOrder()], error: null }] },
      payouts: {
        select: [{ data: null, error: null }],
        insert: [{ data: { id: "payout-update-failed-fail" }, error: null }],
        update: [{ data: null, error: { message: "RLS denied" } }], // UPDATE 'failed' KO
      },
      producers: {
        select: [
          {
            data: {
              stripe_account_id: "acct_test",
              stripe_payouts_enabled: true,
            },
            error: null,
          },
          { data: { nom_exploitation: "Ferme Edge" }, error: null },
        ],
      },
      notifications: { insert: [{ data: null, error: null }] },
    };

    mockTransferCreate.mockRejectedValue(new Error("Network timeout"));

    await processWeeklyPayouts();

    // Le row reste 'processing' (UPDATE 'failed' a échoué) — flag greppable
    // pour intervention admin.
    const warnedAll = consoleWarnSpy.mock.calls
      .map((c: unknown[]) => String(c[0] ?? ""))
      .join("\n");
    expect(warnedAll).toContain("[STRIPE_TRANSFER_FAILED_SYNC]");
    expect(warnedAll).toContain("[WEEKLY_PAYOUT_FAILED_UPDATE_FAILED]");
    expect(warnedAll).toContain("RLS denied");

    // Audit + Resend posés malgré l'échec UPDATE — l'alerte admin est
    // INDÉPENDANTE de la persistence du statut, c'est l'observabilité de
    // dernier recours.
    expect(mockLogPaymentEvent).toHaveBeenCalledTimes(1);
    expect(mockSendTemplate).toHaveBeenCalledTimes(1);
    // T-416 : seul stripe_transfer_failed posé (pas stripe_transfer_initiated
    // qui n'est posé qu'après UPDATE 'paid' succès).
    const initiatedCalls = mockLogPaymentEvent.mock.calls.filter(
      (c) => (c[0] as { eventType: string }).eventType === "stripe_transfer_initiated",
    );
    expect(initiatedCalls).toHaveLength(0);
  });
});

// =============================================================================
// 8. Crash UPDATE 'paid' → row reste 'processing' (resume next run)
// =============================================================================
describe("processWeeklyPayouts — crash UPDATE 'paid' (path nominal)", () => {
  it("transfer OK + UPDATE échoue → row reste 'processing', stripe_transfer_id retourné", async () => {
    responses = {
      orders: { select: [{ data: [defaultOrder()], error: null }] },
      payouts: {
        select: [{ data: null, error: null }],
        insert: [{ data: { id: "payout-update-fail" }, error: null }],
        update: [{ data: null, error: { message: "connection lost" } }],
      },
      producers: {
        select: [
          {
            data: {
              stripe_account_id: "acct_test",
              stripe_payouts_enabled: true,
            },
            error: null,
          },
        ],
      },
    };

    mockTransferCreate.mockResolvedValue({ id: "tr_update_fail" } as never);

    const { results } = await processWeeklyPayouts();

    expect(results[0].stripe_transfer_id).toBe("tr_update_fail");
    expect(results[0].error).toContain("connection lost");
    expect(results[0].error).toContain("will resume");

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[WEEKLY_PAYOUT_UPDATE_FAILED]"),
    );
    // T-416 : crash UPDATE 'paid' → audit_log non posé (placement post-UPDATE
    // succès, le path return early avec error 'will resume'). Trade-off
    // documenté : récupération via Stripe API + log [WEEKLY_PAYOUT_UPDATE_FAILED].
    expect(mockLogPaymentEvent).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 9. T-415-suite — précision aggregations sumCents (anti-drift IEEE 754)
// =============================================================================
describe("processWeeklyPayouts — T-415-suite précision aggregations sumCents", () => {
  it("100 orders cent-aligned → transfer.amount = 2800 cents exact + audit metadata cents exacts", async () => {
    // Documentation/expressivité : sumCents convertit chaque item via
    // eurosToCents (Math.round per-item) AVANT de sommer. Sur des valeurs
    // cent-alignées (0.30 = 30 cents pile), sumCents et l'ancien
    // Math.round(reduce * 100) donnent strictement le même résultat.
    //
    // Sur des valeurs sub-cent (ex. 0.282 = 28.2 cents), sumCents arrondit
    // PAR item (28 cents/item × 100 = 2800) tandis que l'ancien code
    // accumulait avant d'arrondir (28.2 × 100 = 2820). Différence sémantique
    // assumée : Stripe n'accepte que des integer cents, le coût de
    // l'arrondi per-item est borné à 1 cent/item et plus prévisible que
    // l'accumulation float drift sur N items.
    //
    // Fixture cent-alignée pour démontrer la précision préservée :
    //   - montant_total = 0.30 (30 cents)
    //   - commission_terroir = 0.02 (2 cents, ~6.7% de 0.30)
    //   - montant_net_producteur = 0.28 (28 cents)
    const orders100 = Array.from({ length: 100 }, (_, i) => ({
      ...defaultOrder(),
      id: `order-${i}`,
      code_commande: `ABC${i}`,
      montant_total: 0.3,
      commission_terroir: 0.02,
      montant_net_producteur: 0.28,
    }));

    responses = {
      orders: { select: [{ data: orders100, error: null }] },
      payouts: {
        select: [{ data: null, error: null }],
        insert: [{ data: { id: "payout-100" }, error: null }],
        update: [{ data: null, error: null }],
      },
      producers: {
        select: [
          {
            data: {
              stripe_account_id: "acct_test",
              stripe_payouts_enabled: true,
            },
            error: null,
          },
        ],
      },
    };

    mockTransferCreate.mockResolvedValue({ id: "tr_100" } as never);

    await processWeeklyPayouts();

    // Aggregation cent-alignée : 100 × 28 cents = 2800 cents exact.
    expect(mockTransferCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2800 }),
      expect.any(Object),
    );

    // Audit log T-416 metadata cents = sumCents direct (pas de re-conversion).
    expect(mockLogPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "stripe_transfer_initiated",
        metadata: expect.objectContaining({
          montant_brut_cents: 3000, // 100 × 30 cents
          commission_cents: 200, // 100 × 2 cents
          montant_net_cents: 2800, // 100 × 28 cents
          orders_count: 100,
          resumed: false,
        }),
      }),
    );
  });
});
