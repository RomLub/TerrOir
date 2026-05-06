import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth session — controllable per test
const sessionMock = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: () => sessionMock(),
}));

// Mock rate limit (fail-open by default)
vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: vi.fn().mockResolvedValue({
    success: true,
    limit: 5,
    remaining: 4,
    reset: 0,
  }),
  getExportComptaRateLimit: vi.fn().mockReturnValue(null),
}));

// Mock supabase admin client : chainable builder qui retourne ordersResp
let ordersResp: { data: unknown; error: { message: string } | null } = {
  data: [],
  error: null,
};
let captured: {
  table: string | null;
  filters: Array<[string, unknown]>;
  inFilters: Array<[string, unknown[]]>;
  gte: Array<[string, unknown]>;
  lte: Array<[string, unknown]>;
  selectCols: string | null;
};
function resetCaptures() {
  captured = {
    table: null,
    filters: [],
    inFilters: [],
    gte: [],
    lte: [],
    selectCols: null,
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      captured.table = table;
      const builder: any = {};
      builder.select = (cols: string) => {
        captured.selectCols = cols;
        return builder;
      };
      builder.eq = (col: string, val: unknown) => {
        captured.filters.push([col, val]);
        return builder;
      };
      builder.in = (col: string, vals: unknown[]) => {
        captured.inFilters.push([col, vals]);
        return builder;
      };
      builder.gte = (col: string, val: unknown) => {
        captured.gte.push([col, val]);
        return builder;
      };
      builder.lte = (col: string, val: unknown) => {
        captured.lte.push([col, val]);
        return builder;
      };
      builder.order = () => builder;
      builder.limit = () => builder;
      builder.then = (onResolve: (v: unknown) => unknown) =>
        Promise.resolve(onResolve(ordersResp));
      return builder;
    },
  }),
}));

beforeEach(() => {
  resetCaptures();
  sessionMock.mockReset();
  ordersResp = { data: [], error: null };
});

describe("GET /api/exports/consumer/comptabilite.csv — guards", () => {
  it("retourne 401 si pas de session", async () => {
    sessionMock.mockResolvedValue(null);
    const { GET } = await import(
      "@/app/api/exports/consumer/comptabilite.csv/route"
    );
    const res = await GET(
      new Request(
        "https://t.fr/api/exports/consumer/comptabilite.csv?from=2026-01-01&to=2026-12-31",
      ),
    );
    expect(res.status).toBe(401);
  });

  it("retourne 400 si paramètres period invalides", async () => {
    sessionMock.mockResolvedValue({
      id: "u1",
      email: "u@e.fr",
      roles: [],
      isAdmin: false,
    });
    const { GET } = await import(
      "@/app/api/exports/consumer/comptabilite.csv/route"
    );
    const res = await GET(
      new Request("https://t.fr/api/exports/consumer/comptabilite.csv"),
    );
    expect(res.status).toBe(400);
  });

  it("retourne 400 si from > to", async () => {
    sessionMock.mockResolvedValue({
      id: "u1",
      email: "u@e.fr",
      roles: [],
      isAdmin: false,
    });
    const { GET } = await import(
      "@/app/api/exports/consumer/comptabilite.csv/route"
    );
    const res = await GET(
      new Request(
        "https://t.fr/api/exports/consumer/comptabilite.csv?from=2026-12-31&to=2026-01-01",
      ),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/exports/consumer/comptabilite.csv — happy path", () => {
  it("scope strict consumer_id sur la session + statuts paid + retourne CSV", async () => {
    sessionMock.mockResolvedValue({
      id: "user-42",
      email: "u@e.fr",
      roles: [],
      isAdmin: false,
    });
    ordersResp = {
      data: [
        {
          id: "order-1",
          created_at: "2026-03-15T10:00:00.000Z",
          statut: "completed",
          montant_total: 25.0,
          commission_terroir: 1.5,
          montant_net_producteur: 23.5,
          producer: { nom_exploitation: "Ferme Du Pré" },
        },
        {
          id: "order-2",
          created_at: "2026-03-20T14:00:00.000Z",
          statut: "confirmed",
          montant_total: 12.0,
          commission_terroir: 0.72,
          montant_net_producteur: 11.28,
          producer: [{ nom_exploitation: "Ferme Bis" }],
        },
      ],
      error: null,
    };

    const { GET } = await import(
      "@/app/api/exports/consumer/comptabilite.csv/route"
    );
    const res = await GET(
      new Request(
        "https://t.fr/api/exports/consumer/comptabilite.csv?from=2026-01-01&to=2026-12-31",
      ),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");

    // Scope strict : filtre eq sur consumer_id avec session.id
    expect(captured.filters).toContainEqual(["consumer_id", "user-42"]);
    // Filtre statut IN paid
    expect(captured.inFilters).toContainEqual([
      "statut",
      ["confirmed", "completed"],
    ]);
    // Period filter applied
    expect(captured.gte.length).toBeGreaterThan(0);
    expect(captured.lte.length).toBeGreaterThan(0);

    // BOM UTF-8 (EF BB BF) inspecté en bytes pour couvrir la sérialisation
    // Response → bytes (le BOM doit survivre à la transformation).
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
    const csv = buf.toString("utf-8");
    expect(csv).toContain("commande_id,date_commande");
    expect(csv).toContain("order-1");
    expect(csv).toContain("order-2");
    expect(csv).toContain("Ferme Du Pré");
    expect(csv).toContain("Ferme Bis");
    expect(csv).toContain("23.50");
    expect(csv).toContain("1.50");
    expect(csv).toContain("25.00");
  });
});
