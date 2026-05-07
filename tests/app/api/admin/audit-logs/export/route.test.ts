// Tests vitest pour GET /api/admin/audit-logs/export.
//
// Stratégie : mock getSessionUser + createSupabaseServerClient. Le mock
// Supabase est un builder chaînable qui capture les filtres et le LIMIT
// posés par le route handler — permet d'asserter la cohérence avec la
// page côté UI (mêmes searchParams → même query). Les vraies fonctions
// serialize-csv et export-filename sont utilisées (intégration), seul
// le `Date` est figé via setSystemTime pour stabilité du filename.

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { NextRequest } from "next/server";

type SessionUser = {
  id: string;
  email: string | null;
  roles: string[];
  isAdmin: boolean;
} | null;

let sessionUser: SessionUser;
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => sessionUser,
}));

type Resp = { data: unknown; error: { message: string } | null };

let auditLogsResponse: Resp;
let producersResponse: Resp;
let auditLogsCapture: {
  selectCols: string;
  filters: Record<string, unknown>;
  limit: number | null;
};
let producersCapture: {
  filters: Record<string, unknown>;
};

function resetCaptures() {
  auditLogsCapture = { selectCols: "", filters: {}, limit: null };
  producersCapture = { filters: {} };
}

type Builder = {
  select: (cols: string) => Builder;
  order: (col: string, opts?: unknown) => Builder;
  limit: (n: number) => Builder;
  in: (col: string, vals: unknown[]) => Builder;
  eq: (col: string, val: unknown) => Builder;
  gte: (col: string, val: unknown) => Builder;
  lt: (col: string, val: unknown) => Builder;
  then: (onResolve: (v: Resp) => unknown) => Promise<unknown>;
};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let limitVal: number | null = null;
      let selectCols = "";
      const builder: Builder = {
        select: (cols) => {
          selectCols = cols;
          return builder;
        },
        order: () => builder,
        limit: (n) => {
          limitVal = n;
          return builder;
        },
        in: (col, vals) => {
          filters[`in:${col}`] = vals;
          return builder;
        },
        eq: (col, val) => {
          filters[`eq:${col}`] = val;
          return builder;
        },
        gte: (col, val) => {
          filters[`gte:${col}`] = val;
          return builder;
        },
        lt: (col, val) => {
          filters[`lt:${col}`] = val;
          return builder;
        },
        then: (onResolve) => {
          if (table === "audit_logs") {
            auditLogsCapture = { selectCols, filters, limit: limitVal };
            return Promise.resolve(auditLogsResponse).then(onResolve);
          }
          producersCapture = { filters };
          return Promise.resolve(producersResponse).then(onResolve);
        },
      };
      return builder;
    },
  }),
}));

import { GET } from "@/app/api/admin/audit-logs/export/route";

function makeRequest(qs: string): NextRequest {
  return new NextRequest(
    `https://admin.terroir-local.fr/api/admin/audit-logs/export${qs}`,
  );
}

beforeEach(() => {
  sessionUser = {
    id: "admin-1",
    email: "admin@example.com",
    roles: [],
    isAdmin: true,
  };
  resetCaptures();
  auditLogsResponse = { data: [], error: null };
  producersResponse = { data: [], error: null };
  // Date figée à 2026-04-30T12:32:00Z = 14:32 Paris (été, UTC+2).
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-30T12:32:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GET /api/admin/audit-logs/export — auth", () => {
  it("session absente → 403", async () => {
    sessionUser = null;
    const res = await GET(makeRequest(""));
    expect(res.status).toBe(403);
  });

  it("session non-admin → 403", async () => {
    sessionUser = {
      id: "user-1",
      email: "u@example.com",
      roles: ["consumer"],
      isAdmin: false,
    };
    const res = await GET(makeRequest(""));
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/audit-logs/export — query + headers", () => {
  it("sans filtres : pas de filtres posés sur la query, headers basiques, filename sans _filtered", async () => {
    auditLogsResponse = {
      data: [
        {
          id: "row-1",
          user_id: null,
          event_type: "account_logout",
          metadata: {},
          ip_address: null,
          user_agent: null,
          created_at: "2026-04-30T12:00:00Z",
        },
      ],
      error: null,
    };
    const res = await GET(makeRequest(""));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="audit-logs_2026-04-30_1432.csv"',
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Audit-Logs-Truncated")).toBeNull();
    expect(auditLogsCapture.filters).toEqual({});
    expect(auditLogsCapture.limit).toBe(10001);
  });

  it("avec event_type[] + user_id + date range : query reçoit les bons filtres + filename _filtered", async () => {
    const qs =
      "?event_type=account_logout&event_type=stripe_dispute" +
      "&user_id=11111111-2222-3333-4444-555555555555" +
      "&date_from=2026-04-01&date_to=2026-04-30";
    const res = await GET(makeRequest(qs));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="audit-logs_2026-04-30_1432_filtered.csv"',
    );
    expect(auditLogsCapture.filters["in:event_type"]).toEqual([
      "account_logout",
      "stripe_dispute",
    ]);
    expect(auditLogsCapture.filters["eq:user_id"]).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
    // date_from / date_to convertis en bornes Paris UTC.
    expect(auditLogsCapture.filters["gte:created_at"]).toBe(
      "2026-03-31T22:00:00.000Z",
    );
    expect(auditLogsCapture.filters["lt:created_at"]).toBe(
      "2026-04-30T22:00:00.000Z",
    );
  });

  it("event_type inconnu silencieusement ignoré (parseSearchParams strict)", async () => {
    const res = await GET(makeRequest("?event_type=__inconnu__"));
    expect(res.status).toBe(200);
    expect(auditLogsCapture.filters["in:event_type"]).toBeUndefined();
    // Pas de filter actif → filename sans _filtered.
    expect(res.headers.get("Content-Disposition")).toContain(
      "audit-logs_2026-04-30_1432.csv",
    );
  });

  it("body CSV : BOM en bytes + header + data row", async () => {
    auditLogsResponse = {
      data: [
        {
          id: "row-1",
          user_id: "11111111-2222-3333-4444-555555555555",
          event_type: "account_login_password",
          metadata: { foo: "bar" },
          ip_address: "1.2.3.4",
          user_agent: "Mozilla/5.0",
          created_at: "2026-04-30T12:00:00Z",
        },
      ],
      error: null,
    };
    producersResponse = { data: [], error: null };
    const res = await GET(makeRequest(""));
    // res.text() consomme le body, donc on lit en arrayBuffer pour vérifier
    // les 3 octets BOM UTF-8 (EF BB BF). TextDecoder par défaut strip le
    // BOM sur res.text(), d'où l'inspection bytewise.
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    const text = new TextDecoder("utf-8").decode(bytes);
    expect(text).toContain(
      "created_at;event_type;user_id;ip_address;user_agent;metadata;is_producer",
    );
    expect(text).toContain(
      '2026-04-30T12:00:00Z;account_login_password;11111111-2222-3333-4444-555555555555;1.2.3.4;Mozilla/5.0;"{""foo"":""bar""}";false',
    );
  });

  it("is_producer=true quand user_id matche public.producers.user_id", async () => {
    auditLogsResponse = {
      data: [
        {
          id: "row-1",
          user_id: "11111111-2222-3333-4444-555555555555",
          event_type: "account_logout",
          metadata: {},
          ip_address: null,
          user_agent: null,
          created_at: "2026-04-30T12:00:00Z",
        },
      ],
      error: null,
    };
    producersResponse = {
      data: [{ user_id: "11111111-2222-3333-4444-555555555555" }],
      error: null,
    };
    const res = await GET(makeRequest(""));
    const text = await res.text();
    expect(text.endsWith(";true\r\n")).toBe(true);
    // Pre-fetch producers.user_id reçoit la bonne liste d'IDs.
    expect(producersCapture.filters["in:user_id"]).toEqual([
      "11111111-2222-3333-4444-555555555555",
    ]);
  });
});

describe("GET /api/admin/audit-logs/export — truncation", () => {
  function makeRow(i: number) {
    return {
      id: `row-${i}`,
      user_id: null,
      event_type: "account_logout",
      metadata: {},
      ip_address: null,
      user_agent: null,
      created_at: "2026-04-30T12:00:00Z",
    };
  }

  it("retour à 10 000 lignes pile : pas truncated", async () => {
    auditLogsResponse = {
      data: Array.from({ length: 10_000 }, (_, i) => makeRow(i)),
      error: null,
    };
    const res = await GET(makeRequest(""));
    expect(res.headers.get("X-Audit-Logs-Truncated")).toBeNull();
    const text = await res.text();
    expect(text).not.toContain("AVERTISSEMENT");
  });

  it("retour à 10 001 lignes : truncated=true → header HTTP + ligne d'avertissement + 10 000 lignes data", async () => {
    auditLogsResponse = {
      data: Array.from({ length: 10_001 }, (_, i) => makeRow(i)),
      error: null,
    };
    const res = await GET(makeRequest(""));
    expect(res.headers.get("X-Audit-Logs-Truncated")).toBe("true");
    const text = await res.text();
    expect(text).toContain("AVERTISSEMENT");
    expect(text).toContain("10 000");
    // Comptage data rows : split sur \r\n, retirer BOM, header, warning,
    // trailing empty.
    const lines = text.replace(/^﻿/, "").split("\r\n");
    // [warning, header, ...10_000 data, ""] = 10 003 entries.
    expect(lines).toHaveLength(10_003);
  });
});

describe("GET /api/admin/audit-logs/export — erreur DB", () => {
  it("error renvoyée par Supabase → 500 JSON générique (bugs-P1-5)", async () => {
    auditLogsResponse = { data: null, error: { message: "boom" } };
    const res = await GET(makeRequest(""));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    // bugs-P1-5 (T9 2026-05-07) : helper dbErrorResponse remplace l'exposition
    // du message Postgres brut par un message générique côté client. La trace
    // forensique va dans console.error côté serveur (préfixe grep-able).
    expect(body.error).toBe("Internal database error");
  });
});
