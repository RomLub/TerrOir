// Tests vitest pour POST /api/reviews/create — audit RPC M-2.
// Refacto user client + RLS-driven : SELECT initial via createSupabaseServerClient
// (RLS filtre), INSERT review via user client (RLS valide), admin client
// uniquement pour notifications.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

// --- User client (server) — RLS-driven ----------------------------------
type Resp = { data?: unknown; error?: unknown };

let serverResponses: {
  orders?: Resp;
  reviewExists?: Resp;
  insertReview?: Resp;
};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const b: any = {};
      let mode: "select" | "insert" = "select";
      b.select = () => b;
      b.insert = () => {
        mode = "insert";
        return b;
      };
      b.eq = () => b;
      b.maybeSingle = () => {
        if (table === "orders") {
          return Promise.resolve(serverResponses.orders ?? { data: null, error: null });
        }
        if (table === "reviews") {
          return Promise.resolve(serverResponses.reviewExists ?? { data: null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      };
      b.single = () => {
        if (table === "reviews" && mode === "insert") {
          return Promise.resolve(serverResponses.insertReview ?? { data: null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      };
      return b;
    },
  }),
}));

// --- Admin client — uniquement notifications ----------------------------
const { mockAdminFrom, mockNotifInsert } = vi.hoisted(() => ({
  mockAdminFrom: vi.fn(),
  mockNotifInsert: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: mockAdminFrom,
  }),
}));

import { POST } from "@/app/api/reviews/create/route";

const VALID_ORDER_ID = "11111111-1111-4111-9111-111111111111";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/reviews/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  sessionUser = null;
  serverResponses = {};
  mockAdminFrom.mockReset();
  mockNotifInsert.mockReset();

  // Default admin: admin_users SELECT vide (pas de notif), notifications insert no-op.
  mockAdminFrom.mockImplementation((table: string) => {
    const b: any = {};
    b.select = () => Promise.resolve({ data: [], error: null });
    b.insert = (...args: unknown[]) => {
      mockNotifInsert(table, ...args);
      return Promise.resolve({ data: null, error: null });
    };
    return b;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/reviews/create — auth", () => {
  it("401 quand non authentifié", async () => {
    sessionUser = null;
    const res = await POST(
      makeRequest({ order_id: VALID_ORDER_ID, note: 5 }),
    );
    expect(res.status).toBe(401);
    expect(mockAdminFrom).not.toHaveBeenCalled();
  });
});

describe("POST /api/reviews/create — validation Zod", () => {
  beforeEach(() => {
    sessionUser = {
      id: "user-A",
      email: "a@test.fr",
      roles: [],
      isAdmin: false,
    };
  });

  it("400 quand order_id manquant", async () => {
    const res = await POST(makeRequest({ note: 5 }));
    expect(res.status).toBe(400);
  });

  it("400 quand note hors bornes [1..5]", async () => {
    const res = await POST(
      makeRequest({ order_id: VALID_ORDER_ID, note: 6 }),
    );
    expect(res.status).toBe(400);
  });

  it("400 quand note non-entière", async () => {
    const res = await POST(
      makeRequest({ order_id: VALID_ORDER_ID, note: 3.5 }),
    );
    expect(res.status).toBe(400);
  });

  it("400 quand commentaire > 2000 chars", async () => {
    const res = await POST(
      makeRequest({
        order_id: VALID_ORDER_ID,
        note: 4,
        commentaire: "x".repeat(2001),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/reviews/create — RLS-driven SELECT", () => {
  beforeEach(() => {
    sessionUser = {
      id: "user-A",
      email: "a@test.fr",
      roles: [],
      isAdmin: false,
    };
  });

  it("404 quand RLS filtre l'order (consumer A ne peut pas reviewer order de B)", async () => {
    // RLS "orders parties read" filtre — l'user A demande l'order de B,
    // SELECT renvoie null. La route doit répondre 404 sans exposer
    // l'existence de l'order, et SANS jamais appeler admin client (l'ancien
    // pattern faisait `admin.from("orders")...` qui bypassait RLS).
    serverResponses.orders = { data: null, error: null };

    const res = await POST(
      makeRequest({ order_id: VALID_ORDER_ID, note: 5 }),
    );
    expect(res.status).toBe(404);
    expect(mockAdminFrom).not.toHaveBeenCalled();
  });

  it("403 quand user lit l'order via owns_producer (pas consumer)", async () => {
    // L'RLS orders autorise SELECT pour consumer_id OR owns_producer. Si le
    // user est producer-owner mais pas consumer, on doit refuser la review.
    serverResponses.orders = {
      data: {
        id: VALID_ORDER_ID,
        producer_id: "prod-X",
        consumer_id: "user-OTHER",
        statut: "completed",
      },
      error: null,
    };

    const res = await POST(
      makeRequest({ order_id: VALID_ORDER_ID, note: 5 }),
    );
    expect(res.status).toBe(403);
  });

  it("409 quand order pas completed (message UX clair)", async () => {
    serverResponses.orders = {
      data: {
        id: VALID_ORDER_ID,
        producer_id: "prod-X",
        consumer_id: "user-A",
        statut: "pending",
      },
      error: null,
    };

    const res = await POST(
      makeRequest({ order_id: VALID_ORDER_ID, note: 5 }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("terminée");
  });

  it("409 quand review déjà existante pour cet order", async () => {
    serverResponses.orders = {
      data: {
        id: VALID_ORDER_ID,
        producer_id: "prod-X",
        consumer_id: "user-A",
        statut: "completed",
      },
      error: null,
    };
    serverResponses.reviewExists = {
      data: { id: "rev-existing" },
      error: null,
    };

    const res = await POST(
      makeRequest({ order_id: VALID_ORDER_ID, note: 5 }),
    );
    expect(res.status).toBe(409);
  });
});

describe("POST /api/reviews/create — happy path + notifications admin", () => {
  beforeEach(() => {
    sessionUser = {
      id: "user-A",
      email: "a@test.fr",
      roles: [],
      isAdmin: false,
    };
    serverResponses.orders = {
      data: {
        id: VALID_ORDER_ID,
        producer_id: "prod-X",
        consumer_id: "user-A",
        statut: "completed",
      },
      error: null,
    };
    serverResponses.reviewExists = { data: null, error: null };
    serverResponses.insertReview = {
      data: { id: "rev-new" },
      error: null,
    };
  });

  it("200 + review_id + statut pending, pas de notif si admin_users vide", async () => {
    const res = await POST(
      makeRequest({
        order_id: VALID_ORDER_ID,
        note: 5,
        commentaire: "Top",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ review_id: "rev-new", statut: "pending" });
    // admin_users SELECT a été tenté (call admin.from('admin_users'))
    expect(mockAdminFrom).toHaveBeenCalledWith("admin_users");
    // mais aucune insertion notif (admins=[])
    expect(mockNotifInsert).not.toHaveBeenCalled();
  });

  it("200 + INSERT notifications pour chaque admin", async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      const b: any = {};
      b.select = () => {
        if (table === "admin_users") {
          return Promise.resolve({
            data: [{ id: "admin-1" }, { id: "admin-2" }],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      };
      b.insert = (...args: unknown[]) => {
        mockNotifInsert(table, ...args);
        return Promise.resolve({ data: null, error: null });
      };
      return b;
    });

    const res = await POST(
      makeRequest({ order_id: VALID_ORDER_ID, note: 4 }),
    );
    expect(res.status).toBe(200);

    expect(mockNotifInsert).toHaveBeenCalledTimes(1);
    const [table, payload] = mockNotifInsert.mock.calls[0]!;
    expect(table).toBe("notifications");
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({
      user_id: "admin-1",
      type: "email",
      template: "admin_review_pending",
      statut: "sent",
      metadata: expect.objectContaining({
        review_id: "rev-new",
        order_id: VALID_ORDER_ID,
        producer_id: "prod-X",
        note: 4,
      }),
    });
  });

  it("500 quand INSERT review échoue côté RLS (defense-in-depth)", async () => {
    serverResponses.insertReview = {
      data: null,
      error: { message: "row violates RLS" },
    };

    const res = await POST(
      makeRequest({ order_id: VALID_ORDER_ID, note: 5 }),
    );
    expect(res.status).toBe(500);
    expect(mockNotifInsert).not.toHaveBeenCalled();
  });
});
