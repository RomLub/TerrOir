import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Mocks hoistés AVANT l'import de la route. SUPPORT_EMAIL doit être set
// avant l'import du template (qui throw au module-load sinon).
vi.hoisted(() => {
  process.env.SUPPORT_EMAIL = "admin@terroir-local.fr";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL = "http://localhost:3000";
});

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/resend/send", () => ({
  sendTemplate: vi.fn(),
}));

vi.mock("@/lib/twilio/sms", () => ({
  sendSms: vi.fn(),
}));

vi.mock("@/lib/audit-logs/log-payment-event", () => ({
  logPaymentEvent: vi.fn(),
}));

vi.mock("@/lib/resend/templates/admin-dispute-deadline-warning", () => ({
  default: () => null,
  subject: (p: { evidenceDueBy: string | null }) =>
    `subject-${p.evidenceDueBy ?? "null"}`,
}));

import { POST } from "@/app/api/cron/disputes-deadline-check/route";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendTemplate } from "@/lib/resend/send";
import { sendSms } from "@/lib/twilio/sms";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";

// =============================================================================
// Mock Supabase admin — chaque appel `from(table)` retourne un builder neuf.
// SELECT disputes : await direct (chain SELECT/eq/not/lte). SELECT orders :
// terminé par .maybeSingle().
// =============================================================================
type ChainResp = { data?: unknown; error?: unknown };

interface SupabaseControl {
  selectDisputes?: ChainResp;
  order?: ChainResp;
}

function makeSupabase(ctrl: SupabaseControl = {}): {
  client: SupabaseClient;
} {
  const buildBuilder = (table: string) => {
    const b: any = {};
    b.select = () => b;
    b.eq = () => b;
    b.not = () => b;
    b.lte = () => b;
    b.maybeSingle = () => {
      if (table === "orders") {
        return Promise.resolve(
          ctrl.order ?? {
            data: { code_commande: "CMD-TEST" },
            error: null,
          },
        );
      }
      return Promise.resolve({ data: null, error: null });
    };
    b.then = (onFulfilled: (r: ChainResp) => unknown) => {
      let resp: ChainResp;
      if (table === "disputes") {
        resp = ctrl.selectDisputes ?? { data: [], error: null };
      } else {
        resp = { data: null, error: null };
      }
      return onFulfilled(resp);
    };
    return b;
  };

  const client = {
    from: (table: string) => buildBuilder(table),
  } as unknown as SupabaseClient;

  return { client };
}

function makeRequest(opts: { auth?: string } = {}): Request {
  const headers = new Headers();
  if (opts.auth) headers.set("authorization", opts.auth);
  return new Request("http://localhost/api/cron/disputes-deadline-check", {
    method: "POST",
    headers,
  });
}

const FROZEN_NOW = new Date("2026-05-05T08:00:00.000Z");

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_TWILIO_PHONE = process.env.TWILIO_ADMIN_PHONE;

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  delete process.env.TWILIO_ADMIN_PHONE;

  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);

  vi.mocked(sendTemplate).mockReset();
  vi.mocked(sendTemplate).mockResolvedValue({ ok: true, id: "email_id" });

  vi.mocked(sendSms).mockReset();
  vi.mocked(sendSms).mockResolvedValue({ ok: true, sid: "sms_id" });

  vi.mocked(logPaymentEvent).mockReset();
  vi.mocked(logPaymentEvent).mockResolvedValue(undefined);

  vi.mocked(createSupabaseAdminClient).mockReset();

  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (ORIGINAL_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  if (ORIGINAL_TWILIO_PHONE === undefined) delete process.env.TWILIO_ADMIN_PHONE;
  else process.env.TWILIO_ADMIN_PHONE = ORIGINAL_TWILIO_PHONE;
});

// =============================================================================
// Auth — header missing
// =============================================================================
describe("POST /api/cron/disputes-deadline-check — auth", () => {
  it("returns 401 when authorization header is missing", async () => {
    const { client } = makeSupabase();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// No disputes
// =============================================================================
describe("POST /api/cron/disputes-deadline-check — no open disputes", () => {
  it("returns processed=0 when no disputes match cutoff", async () => {
    const { client } = makeSupabase({
      selectDisputes: { data: [], error: null },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { processed: number };
    expect(body.processed).toBe(0);
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();
    expect(vi.mocked(sendSms)).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Bucket "soon" — J-2
// =============================================================================
describe("POST /api/cron/disputes-deadline-check — bucket soon (J-2)", () => {
  it("sends 1 email but no SMS, audit warning", async () => {
    const dueBy = new Date(FROZEN_NOW.getTime() + 48 * 60 * 60 * 1000)
      .toISOString();
    const dispute = {
      id: "dispute-uuid",
      stripe_dispute_id: "dp_J2",
      order_id: "order-1",
      amount: 25.5,
      currency: "eur",
      reason: "fraudulent",
      evidence_due_by: dueBy,
      metadata: {},
    };
    const { client } = makeSupabase({
      selectDisputes: { data: [dispute], error: null },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      processed: number;
      items: Array<{ bucket: string; email_sent: boolean; sms_sent: boolean }>;
    };
    expect(body.processed).toBe(1);
    expect(body.items[0]?.bucket).toBe("soon");
    expect(body.items[0]?.email_sent).toBe(true);
    expect(body.items[0]?.sms_sent).toBe(false);

    expect(vi.mocked(sendTemplate)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendSms)).not.toHaveBeenCalled();
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "stripe_dispute_deadline_warning",
        metadata: expect.objectContaining({
          dispute_id: "dp_J2",
          urgency: "soon",
          email_sent: true,
          sms_sent: false,
        }),
      }),
    );
  });
});

// =============================================================================
// Bucket "urgent" — J-1 + SMS configuré
// =============================================================================
describe("POST /api/cron/disputes-deadline-check — bucket urgent (J-1)", () => {
  it("sends 1 email + 1 SMS when TWILIO_ADMIN_PHONE configured", async () => {
    process.env.TWILIO_ADMIN_PHONE = "+33600000000";

    const dueBy = new Date(FROZEN_NOW.getTime() + 12 * 60 * 60 * 1000)
      .toISOString();
    const dispute = {
      id: "dispute-uuid",
      stripe_dispute_id: "dp_J1",
      order_id: "order-1",
      amount: 99.99,
      currency: "eur",
      reason: "product_not_received",
      evidence_due_by: dueBy,
      metadata: {},
    };
    const { client } = makeSupabase({
      selectDisputes: { data: [dispute], error: null },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ bucket: string; email_sent: boolean; sms_sent: boolean }>;
    };
    expect(body.items[0]?.bucket).toBe("urgent");
    expect(body.items[0]?.email_sent).toBe(true);
    expect(body.items[0]?.sms_sent).toBe(true);

    expect(vi.mocked(sendTemplate)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendSms)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendSms)).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "+33600000000",
        template: "admin_dispute_deadline_urgent",
      }),
    );
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "stripe_dispute_deadline_warning",
        metadata: expect.objectContaining({
          urgency: "urgent",
          sms_sent: true,
        }),
      }),
    );
  });

  it("sends email only when TWILIO_ADMIN_PHONE not configured", async () => {
    const dueBy = new Date(FROZEN_NOW.getTime() + 12 * 60 * 60 * 1000)
      .toISOString();
    const dispute = {
      id: "dispute-uuid",
      stripe_dispute_id: "dp_J1_nosms",
      order_id: "order-1",
      amount: 99.99,
      currency: "eur",
      reason: null,
      evidence_due_by: dueBy,
      metadata: {},
    };
    const { client } = makeSupabase({
      selectDisputes: { data: [dispute], error: null },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(sendTemplate)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendSms)).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Bucket "missed" — deadline passée
// =============================================================================
describe("POST /api/cron/disputes-deadline-check — bucket missed", () => {
  it("logs forensic audit, no email, no SMS", async () => {
    const dueBy = new Date(FROZEN_NOW.getTime() - 6 * 60 * 60 * 1000)
      .toISOString();
    const dispute = {
      id: "dispute-uuid",
      stripe_dispute_id: "dp_missed",
      order_id: "order-1",
      amount: 50,
      currency: "eur",
      reason: null,
      evidence_due_by: dueBy,
      metadata: {},
    };
    const { client } = makeSupabase({
      selectDisputes: { data: [dispute], error: null },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ bucket: string; email_sent: boolean; sms_sent: boolean }>;
    };
    expect(body.items[0]?.bucket).toBe("missed");
    expect(body.items[0]?.email_sent).toBe(false);
    expect(body.items[0]?.sms_sent).toBe(false);

    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();
    expect(vi.mocked(sendSms)).not.toHaveBeenCalled();

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "stripe_dispute_deadline_missed",
        metadata: expect.objectContaining({
          dispute_id: "dp_missed",
        }),
      }),
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[DISPUTES_DEADLINE_MISSED]"),
    );
  });
});
