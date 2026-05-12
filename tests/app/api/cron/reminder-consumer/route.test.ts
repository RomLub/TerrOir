import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Mocks hoistés AVANT l'import de la route. createSupabaseAdminClient et
// sendTemplate sont substitués pour ne pas avoir à set
// SUPABASE_SERVICE_ROLE_KEY ni RESEND_API_KEY dans l'env du test.
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/resend/send", () => ({
  sendTemplate: vi.fn(),
  googleMapsUrl: (q: string) => `https://maps.google.com/?q=${encodeURIComponent(q)}`,
}));

vi.mock("@/lib/resend/templates/order-reminder-consumer", () => ({
  default: () => null,
  subject: (props: { exploitation: string }) =>
    `Rappel : retrait demain chez ${props.exploitation}`,
}));

import { POST } from "@/app/api/cron/reminder-consumer/route";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendTemplate } from "@/lib/resend/send";

// =============================================================================
// Mock Supabase admin minimal — on attend UN SEUL `from('orders')` (audit C-3 :
// embeds PostgREST → plus de N+1 producers/users dans la boucle).
// =============================================================================
type ChainResp = { data?: unknown; error?: unknown };

interface Captured {
  from: string[];
  selectCols: Array<{ table: string; cols: string }>;
}

function makeSupabase(selectOrders: ChainResp = { data: [], error: null }): {
  client: SupabaseClient;
  captured: Captured;
} {
  const captured: Captured = { from: [], selectCols: [] };

  const buildBuilder = (table: string) => {
    const b: any = {};
    b.select = (cols: string) => {
      captured.selectCols.push({ table, cols });
      return b;
    };
    b.eq = () => b;
    b.then = (onFulfilled: (r: ChainResp) => unknown) =>
      onFulfilled(table === "orders" ? selectOrders : { data: null, error: null });
    return b;
  };

  const client = {
    from: (table: string) => {
      captured.from.push(table);
      return buildBuilder(table);
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

function makeRequest(opts: { auth?: string } = {}): Request {
  const headers = new Headers();
  if (opts.auth) headers.set("authorization", opts.auth);
  return new Request("http://localhost/api/cron/reminder-consumer", {
    method: "POST",
    headers,
  });
}

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  vi.mocked(createSupabaseAdminClient).mockReset();
  vi.mocked(sendTemplate).mockReset();
  vi.mocked(sendTemplate).mockResolvedValue({ ok: true, id: "email_id" });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_CRON_SECRET === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  }
});

describe("POST /api/cron/reminder-consumer — auth", () => {
  it("returns 401 when authorization header is missing", async () => {
    const { client } = makeSupabase();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });
});

describe("POST /api/cron/reminder-consumer — audit C-3 N+1 elimination", () => {
  it("performs ONLY ONE DB call total (the enriched SELECT) — no producers/users lookup in loop", async () => {
    const order = {
      id: "ord-1",
      code_commande: "CMD-1",
      consumer_id: "cons-1",
      producer_id: "prod-1",
      date_retrait: "2026-05-06",
      heure_retrait: "14:00:00",
      producer: {
        nom_exploitation: "Ferme du Test",
        adresse: "1 rue Test",
        commune: "Tours",
        code_postal: "37000",
      },
      consumer: { email: "alice@example.com" },
    };
    const { client, captured } = makeSupabase({ data: [order], error: null });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);

    // Audit C-3 : 1 seul `.from()` total (SELECT enrichi). Avant fix, la boucle
    // ajoutait 2 `.from('producers')` + `.from('users')` par order.
    expect(captured.from).toEqual(["orders"]);

    // Le SELECT enrichi contient bien les embeds producer/consumer.
    expect(captured.selectCols[0]?.cols).toContain("producer:producer_id");
    expect(captured.selectCols[0]?.cols).toContain("consumer:consumer_id");

    // Email envoyé avec les bons props (lecture depuis l'embed).
    expect(vi.mocked(sendTemplate)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendTemplate).mock.calls[0]?.[0];
    expect(call?.to).toBe("alice@example.com");
    expect(call?.userId).toBe("cons-1");
    expect(call?.template).toBe("order_reminder_consumer");
    expect(call?.subject).toContain("Ferme du Test");
    expect(call?.metadata).toEqual({
      order_id: "ord-1",
      code_commande: "CMD-1",
    });
  });

  it("skips an order whose embed.consumer.email is null", async () => {
    const order = {
      id: "ord-2",
      code_commande: "CMD-2",
      consumer_id: "cons-2",
      producer_id: "prod-2",
      date_retrait: "2026-05-06",
      heure_retrait: "10:00:00",
      producer: {
        nom_exploitation: "X",
        adresse: null,
        commune: null,
        code_postal: null,
      },
      consumer: { email: null },
    };
    const { client } = makeSupabase({ data: [order], error: null });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();
  });

  it("skips an order whose embed.producer is null", async () => {
    const order = {
      id: "ord-3",
      code_commande: "CMD-3",
      consumer_id: "cons-3",
      producer_id: "prod-3",
      date_retrait: "2026-05-06",
      heure_retrait: "10:00:00",
      producer: null,
      consumer: { email: "bob@example.com" },
    };
    const { client } = makeSupabase({ data: [order], error: null });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();
  });
});
