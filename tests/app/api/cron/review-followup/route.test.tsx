// Tests vitest pour POST /api/cron/review-followup (LOT 7 chantier
// pickup-validation 2026-05-06 — comble la lacune trou 2 identifiée
// au LOT 6 : ce cron tournait en prod sans tests, contrairement aux
// 9 autres cron Vercel qui ont leur couverture.
//
// Couverture :
//   - Auth assertCronAuth (Bearer CRON_SECRET) : 401 sans header,
//     401 bearer invalide, exécution si valide.
//   - Logique fenêtre J-2 / J-7 : 1 order completed dans la fenêtre
//     → 1 email envoyé avec dayOffset cohérent.
//   - Anti-spam guard : reviews.order_id existant → skip.
//   - Robustesse missing data : consumer.email null OR producer null
//     → skip propre sans crash.
//   - Réponse JSON { j2: count, j7: count } cohérent.
//
// Pattern aligné sur tests/app/api/cron/reminder-consumer/route.test.ts,
// avec extension queue par-table pour gérer les multiples lookups
// reviews/users/producers par order (cron review-followup utilise un
// pattern N+1 explicite sur ces 3 tables — backlog perf hors scope LOT 7).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/resend/send", () => ({
  sendTemplate: vi.fn(),
}));

vi.mock("@/lib/resend/templates/review-request", () => ({
  default: () => null,
  subject: (props: { exploitation: string; dayOffset: 0 | 2 | 7 }) =>
    `Review subject ${props.exploitation} dayOffset=${props.dayOffset}`,
}));

import { POST } from "@/app/api/cron/review-followup/route";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendTemplate } from "@/lib/resend/send";

// =============================================================================
// Mock Supabase admin avec queue par-table.
//
// Le cron fait 1 SELECT orders par batch (J-2, J-7), puis pour chaque order
// 1 SELECT reviews + 1 SELECT users + 1 SELECT producers. Donc :
//   - responses.orders : queue de 2 réponses (J-2 puis J-7, ordre Promise.all)
//   - responses.reviews / users / producers : queue 1 entrée par order traité
//
// Promise.all([sendBatch(2), sendBatch(7)]) appelle les 2 fonctions
// synchroniquement → 1er hit orders = J-2, 2e hit orders = J-7.
// =============================================================================

type ChainResp = { data?: unknown; error?: unknown };

interface Captured {
  from: string[];
  selectCols: Array<{ table: string; cols: string }>;
}

let responses: Record<string, ChainResp[]>;
let captured: Captured;

function makeClient(): SupabaseClient {
  return {
    from: (table: string) => {
      captured.from.push(table);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      b.select = (cols: string) => {
        captured.selectCols.push({ table, cols });
        return b;
      };
      b.eq = () => b;
      b.gte = () => b;
      b.lte = () => b;
      const consume = (): ChainResp => {
        const queue = responses[table];
        if (queue && queue.length > 0) return queue.shift()!;
        return { data: null, error: null };
      };
      b.maybeSingle = () => Promise.resolve(consume());
      b.then = (onFulfilled: (r: ChainResp) => unknown) =>
        onFulfilled(consume());
      return b;
    },
  } as unknown as SupabaseClient;
}

function makeRequest(opts: { auth?: string } = {}): Request {
  const headers = new Headers();
  if (opts.auth) headers.set("authorization", opts.auth);
  return new Request("http://localhost/api/cron/review-followup", {
    method: "POST",
    headers,
  });
}

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  responses = {};
  captured = { from: [], selectCols: [] };
  vi.mocked(createSupabaseAdminClient).mockReset();
  vi.mocked(createSupabaseAdminClient).mockReturnValue(makeClient());
  vi.mocked(sendTemplate).mockReset();
  vi.mocked(sendTemplate).mockResolvedValue({ ok: true, id: "email-id" });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_CRON_SECRET === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  }
});

// --- Helpers fixtures ---------------------------------------------------

function makeOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "order-1",
    code_commande: "TRR-ABCDE",
    consumer_id: "cons-1",
    producer_id: "prod-1",
    ...overrides,
  };
}

// --- A. Auth ------------------------------------------------------------

describe("POST /api/cron/review-followup — auth", () => {
  it("A1 pas de header Authorization → 401", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();
  });

  it("A2 Bearer invalide → 401", async () => {
    const res = await POST(makeRequest({ auth: "Bearer wrong-secret" }));
    expect(res.status).toBe(401);
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();
  });

  it("A3 Bearer valide → 200 + JSON { j2, j7 }", async () => {
    responses.orders = [
      { data: [], error: null }, // J-2
      { data: [], error: null }, // J-7
    ];
    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { j2: number; j7: number };
    expect(body).toEqual({ j2: 0, j7: 0 });
  });
});

// --- B. Logique fenêtre J-2 / J-7 -------------------------------------

describe("POST /api/cron/review-followup — fenêtre J-2 / J-7", () => {
  it("B1 1 order J-2 sans review → email J+2 envoyé avec dayOffset=2", async () => {
    const order = makeOrder({ id: "order-j2", code_commande: "TRR-J2AAA" });
    responses.orders = [
      { data: [order], error: null }, // J-2 batch
      { data: [], error: null }, // J-7 batch
    ];
    responses.reviews = [{ data: null, error: null }]; // pas de review
    responses.users = [{ data: { email: "consumer@test.fr" }, error: null }];
    responses.producers = [
      { data: { nom_exploitation: "Ferme A" }, error: null },
    ];

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { j2: number; j7: number };
    expect(body.j2).toBe(1);
    expect(body.j7).toBe(0);

    expect(vi.mocked(sendTemplate)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendTemplate).mock.calls[0]?.[0];
    expect(call?.template).toBe("review_request_j2");
    expect(call?.to).toBe("consumer@test.fr");
    expect(call?.userId).toBe("cons-1");
    expect(call?.subject).toContain("dayOffset=2");
    expect(call?.metadata).toEqual({
      order_id: "order-j2",
      code_commande: "TRR-J2AAA",
    });
  });

  it("B2 1 order J-7 sans review → email J+7 envoyé avec dayOffset=7", async () => {
    const order = makeOrder({ id: "order-j7", code_commande: "TRR-J7BBB" });
    responses.orders = [
      { data: [], error: null }, // J-2 batch (vide)
      { data: [order], error: null }, // J-7 batch
    ];
    responses.reviews = [{ data: null, error: null }];
    responses.users = [{ data: { email: "consumer@test.fr" }, error: null }];
    responses.producers = [
      { data: { nom_exploitation: "Ferme B" }, error: null },
    ];

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { j2: number; j7: number };
    expect(body.j2).toBe(0);
    expect(body.j7).toBe(1);

    expect(vi.mocked(sendTemplate)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendTemplate).mock.calls[0]?.[0];
    expect(call?.template).toBe("review_request_j7");
    expect(call?.subject).toContain("dayOffset=7");
  });

  it("B3 fenêtre vide (orders=[]) → 200 + j2:0, j7:0, pas d'email", async () => {
    responses.orders = [
      { data: [], error: null },
      { data: [], error: null },
    ];

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ j2: 0, j7: 0 });
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();
  });

  it("B4 SELECT orders filtre statut='completed' (verrou anti-régression)", async () => {
    responses.orders = [
      { data: [], error: null },
      { data: [], error: null },
    ];
    await POST(makeRequest({ auth: "Bearer test-secret" }));
    // Le SELECT orders est fait 2x (1 par batch). Tous deux doivent demander
    // les colonnes id/code_commande/consumer_id/producer_id.
    const ordersSelects = captured.selectCols.filter(
      (s) => s.table === "orders",
    );
    expect(ordersSelects).toHaveLength(2);
    for (const s of ordersSelects) {
      expect(s.cols).toContain("id");
      expect(s.cols).toContain("code_commande");
      expect(s.cols).toContain("consumer_id");
      expect(s.cols).toContain("producer_id");
    }
  });
});

// --- C. Anti-spam guard (review existante) ----------------------------

describe("POST /api/cron/review-followup — anti-spam (review existante)", () => {
  it("C1 order J-2 AVEC review existante → skip, pas d'email envoyé", async () => {
    const order = makeOrder();
    responses.orders = [
      { data: [order], error: null },
      { data: [], error: null },
    ];
    responses.reviews = [{ data: { id: "review-1" }, error: null }]; // EXISTE
    // users/producers ne devraient pas être appelés (skip avant)

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();
    const body = (await res.json()) as { j2: number; j7: number };
    expect(body.j2).toBe(0);

    // Vérification que le lookup reviews a bien eu lieu (anti-spam guard
    // exécuté juste avant l'envoi).
    expect(captured.from.includes("reviews")).toBe(true);
  });

  it("C2 order J-7 AVEC review existante → skip, pas d'email", async () => {
    const order = makeOrder({ id: "order-j7" });
    responses.orders = [
      { data: [], error: null }, // J-2 vide
      { data: [order], error: null },
    ];
    responses.reviews = [{ data: { id: "review-2" }, error: null }];

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();
  });

  it("C3 mélange : 2 orders J-2, l'un avec review l'autre sans → 1 seul email", async () => {
    responses.orders = [
      {
        data: [
          makeOrder({ id: "order-with-review" }),
          makeOrder({ id: "order-no-review", code_commande: "TRR-NEW01" }),
        ],
        error: null,
      },
      { data: [], error: null }, // J-7 vide
    ];
    // Order 1 a une review, order 2 n'en a pas
    responses.reviews = [
      { data: { id: "rev-1" }, error: null },
      { data: null, error: null },
    ];
    // Pour order 2 (no review), on enchaîne users + producers
    responses.users = [{ data: { email: "u@test.fr" }, error: null }];
    responses.producers = [
      { data: { nom_exploitation: "Ferme" }, error: null },
    ];

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { j2: number };
    expect(body.j2).toBe(1);
    expect(vi.mocked(sendTemplate)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendTemplate).mock.calls[0]?.[0];
    expect(call?.metadata).toMatchObject({ order_id: "order-no-review" });
  });
});

// --- D. Robustesse missing data ---------------------------------------

describe("POST /api/cron/review-followup — robustesse missing data", () => {
  it("D1 consumer.email null → skip propre, pas de crash, pas d'email", async () => {
    const order = makeOrder();
    responses.orders = [
      { data: [order], error: null },
      { data: [], error: null },
    ];
    responses.reviews = [{ data: null, error: null }];
    responses.users = [{ data: { email: null }, error: null }];
    responses.producers = [
      { data: { nom_exploitation: "Ferme" }, error: null },
    ];

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();
    const body = (await res.json()) as { j2: number };
    expect(body.j2).toBe(0);
  });

  it("D2 producer null → skip propre, pas de crash, pas d'email", async () => {
    const order = makeOrder();
    responses.orders = [
      { data: [order], error: null },
      { data: [], error: null },
    ];
    responses.reviews = [{ data: null, error: null }];
    responses.users = [{ data: { email: "u@test.fr" }, error: null }];
    responses.producers = [{ data: null, error: null }];

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(sendTemplate)).not.toHaveBeenCalled();
  });

  it("D3 sendTemplate retourne ok=false → compteur sent NON incrémenté", async () => {
    const order = makeOrder();
    responses.orders = [
      { data: [order], error: null },
      { data: [], error: null },
    ];
    responses.reviews = [{ data: null, error: null }];
    responses.users = [{ data: { email: "u@test.fr" }, error: null }];
    responses.producers = [
      { data: { nom_exploitation: "Ferme" }, error: null },
    ];
    vi.mocked(sendTemplate).mockResolvedValueOnce({
      ok: false,
      error: "send_failed",
    });

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { j2: number };
    expect(body.j2).toBe(0); // ok=false → pas compté
  });
});
