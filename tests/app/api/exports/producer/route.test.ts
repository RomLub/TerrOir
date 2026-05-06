import { describe, it, expect, vi, beforeEach } from "vitest";

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
let payoutsResp: { data: unknown; error: { message: string } | null };
let captured: {
  tables: string[];
  filters: Array<[string, unknown]>;
  selectCols: string[];
};

function resetCaptures() {
  captured = { tables: [], filters: [], selectCols: [] };
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      captured.tables.push(table);
      const builder: any = {};
      builder.select = (cols: string) => {
        captured.selectCols.push(cols);
        return builder;
      };
      builder.eq = (col: string, val: unknown) => {
        captured.filters.push([col, val]);
        return builder;
      };
      builder.maybeSingle = () => {
        if (table === "producers") return Promise.resolve(producerResp);
        return Promise.resolve({ data: null, error: null });
      };
      builder.gte = () => builder;
      builder.lte = () => builder;
      builder.in = () => builder;
      builder.order = () => builder;
      builder.limit = () => builder;
      builder.then = (resolve: (v: unknown) => unknown) => {
        if (table === "orders") return Promise.resolve(resolve(ordersResp));
        if (table === "payouts") return Promise.resolve(resolve(payoutsResp));
        return Promise.resolve(resolve({ data: [], error: null }));
      };
      return builder;
    },
  }),
}));

beforeEach(() => {
  resetCaptures();
  sessionMock.mockReset();
  producerResp = { data: { id: "producer-1" }, error: null };
  ordersResp = { data: [], error: null };
  payoutsResp = { data: [], error: null };
});

describe("GET /api/exports/producer/comptabilite.csv — guards", () => {
  it("retourne 401 si pas de session", async () => {
    sessionMock.mockResolvedValue(null);
    const { GET } = await import(
      "@/app/api/exports/producer/comptabilite.csv/route"
    );
    const res = await GET(
      new Request(
        "https://t.fr/api/exports/producer/comptabilite.csv?from=2026-01-01&to=2026-12-31",
      ),
    );
    expect(res.status).toBe(401);
  });

  it("retourne 403 si user n'a pas de profil producer", async () => {
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
        "https://t.fr/api/exports/producer/comptabilite.csv?from=2026-01-01&to=2026-12-31",
      ),
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /api/exports/producer/comptabilite.csv — happy path", () => {
  it("masque l'email consumer dans le CSV (j***@d***.tld)", async () => {
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
          completed_at: "2026-03-15T10:00:00.000Z",
          statut: "completed",
          montant_total: 25.0,
          commission_terroir: 1.5,
          montant_net_producteur: 23.5,
          consumer: { email: "julien@example.fr" },
        },
      ],
      error: null,
    };

    const { GET } = await import(
      "@/app/api/exports/producer/comptabilite.csv/route"
    );
    const res = await GET(
      new Request(
        "https://t.fr/api/exports/producer/comptabilite.csv?from=2026-01-01&to=2026-12-31",
      ),
    );

    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    const csv = buf.toString("utf-8");

    // Email NE doit PAS apparaître en clair
    expect(csv).not.toContain("julien@example.fr");
    expect(csv).not.toContain("julien");
    // Forme masquée présente
    expect(csv).toContain("j***@e***.fr");
    // Header colonnes attendu
    expect(csv).toContain("consumer_email_masked");
    expect(csv).toContain("commission_terroir_6%");
    expect(csv).toContain("payout_net");
  });

  it("scope strict producer_id du producer authentifié", async () => {
    sessionMock.mockResolvedValue({
      id: "user-42",
      email: "p@e.fr",
      roles: [],
      isAdmin: false,
    });
    producerResp = { data: { id: "producer-99" }, error: null };
    ordersResp = { data: [], error: null };

    const { GET } = await import(
      "@/app/api/exports/producer/comptabilite.csv/route"
    );
    await GET(
      new Request(
        "https://t.fr/api/exports/producer/comptabilite.csv?from=2026-01-01&to=2026-12-31",
      ),
    );

    // Lookup producers : user_id = session.id
    expect(captured.filters).toContainEqual(["user_id", "user-42"]);
    // Filtre orders : producer_id = producer.id (NON consumer_id)
    expect(captured.filters).toContainEqual(["producer_id", "producer-99"]);
    expect(captured.filters).toContainEqual(["statut", "completed"]);
  });
});
