import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: () => sessionMock(),
}));

vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: vi.fn().mockResolvedValue({
    success: true,
    limit: 5,
    remaining: 4,
    reset: 0,
  }),
  getExportComptaRateLimit: vi.fn().mockReturnValue(null),
}));

let producerResp: { data: unknown; error: { message: string } | null };
let ordersResp: { data: unknown; error: { message: string } | null };
let captured: {
  filters: Array<[string, unknown]>;
  inFilters: Array<[string, unknown[]]>;
};

function resetCaptures() {
  captured = { filters: [], inFilters: [] };
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      const builder: any = {};
      builder.select = () => builder;
      builder.eq = (column: string, value: unknown) => {
        captured.filters.push([column, value]);
        return builder;
      };
      builder.gte = () => builder;
      builder.lte = () => builder;
      builder.in = (column: string, value: unknown[]) => {
        captured.inFilters.push([column, value]);
        return builder;
      };
      builder.order = () => builder;
      builder.limit = () => builder;
      builder.maybeSingle = () => {
        if (table === "producers") return Promise.resolve(producerResp);
        return Promise.resolve({ data: null, error: null });
      };
      builder.then = (resolve: (value: unknown) => unknown) => {
        if (table === "orders") return Promise.resolve(resolve(ordersResp));
        return Promise.resolve(resolve({ data: [], error: null }));
      };
      return builder;
    },
  }),
}));

beforeEach(() => {
  resetCaptures();
  sessionMock.mockReset();
  producerResp = {
    data: { id: "producer-1", producer_number: 12 },
    error: null,
  };
  ordersResp = { data: [], error: null };
});

describe("GET /api/exports/producer/comptabilite.csv — guards", () => {
  it("retourne 401 si pas de session", async () => {
    sessionMock.mockResolvedValue(null);
    const { GET } = await import(
      "@/app/api/exports/producer/comptabilite.csv/route"
    );
    const res = await GET(
      new Request(
        "https://t.fr/api/exports/producer/comptabilite.csv?period=custom&from=2026-01-01&to=2026-12-31",
      ),
    );
    expect(res.status).toBe(401);
  });

  it("retourne 403 si user n'a pas de profil producteur", async () => {
    sessionMock.mockResolvedValue({
      id: "u1",
      email: "u@e.fr",
      roles: [],
      isAdmin: false,
    });
    producerResp = { data: null, error: null };
    const { GET } = await import(
      "@/app/api/exports/producer/comptabilite.csv/route"
    );
    const res = await GET(
      new Request(
        "https://t.fr/api/exports/producer/comptabilite.csv?period=custom&from=2026-01-01&to=2026-12-31",
      ),
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /api/exports/producer/comptabilite.csv — export", () => {
  it("retourne le CSV détaillé du producteur connecté", async () => {
    sessionMock.mockResolvedValue({
      id: "user-42",
      email: "p@e.fr",
      roles: [],
      isAdmin: false,
    });
    ordersResp = {
      data: [
        {
          id: "order-1",
          producer_order_seq: 42,
          created_at: "2026-03-15T10:00:00.000Z",
          statut: "cancelled",
          montant_total: 25,
          commission_terroir: 1.5,
          montant_net_producteur: 23.5,
          stripe_payment_intent_id: "pi_123",
          date_retrait: "2026-03-20",
          completed_at: null,
          consumer: { prenom: "Jeanne", nom: "Martin" },
        },
      ],
      error: null,
    };

    const { GET } = await import(
      "@/app/api/exports/producer/comptabilite.csv/route"
    );
    const res = await GET(
      new Request(
        "https://t.fr/api/exports/producer/comptabilite.csv?period=custom&from=2026-01-01&to=2026-12-31",
      ),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(captured.filters).toContainEqual(["user_id", "user-42"]);
    expect(captured.filters).toContainEqual(["producer_id", "producer-1"]);
    expect(captured.inFilters).toContainEqual([
      "statut",
      ["confirmed", "completed", "cancelled", "refunded"],
    ]);

    const csv = Buffer.from(await res.arrayBuffer()).toString("utf-8");
    expect(csv).toContain("date commande,numero commande,client,statut");
    expect(csv).toContain("0012-00042");
    expect(csv).toContain("Jeanne Martin");
    expect(csv).toContain("Annulée");
    expect(csv).toContain("Carte bancaire");
  });
});
