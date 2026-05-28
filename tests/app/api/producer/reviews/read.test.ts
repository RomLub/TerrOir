import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "test-service-role-key";
});

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

const { mockAdminFrom } = vi.hoisted(() => ({
  mockAdminFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: mockAdminFrom }),
}));

import { POST } from "@/app/api/producer/reviews/[id]/read/route";

const REVIEW_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const PRODUCER_ID = "cccccccc-cccc-4ccc-cccc-cccccccccccc";

function request(): Request {
  return new Request(`http://localhost/api/producer/reviews/${REVIEW_ID}/read`, {
    method: "POST",
  });
}

function setupAdmin(opts: {
  producerId: string | null;
  reviewFound: boolean;
  upsertError?: { message: string } | null;
}) {
  let upsertPayload: Record<string, unknown> | null = null;
  const eqCalls: Array<[string, unknown]> = [];
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === "producers") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: opts.producerId ? { id: opts.producerId } : null,
                error: null,
              }),
          }),
        }),
      };
    }
    if (table === "reviews") {
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          eqCalls.push([col, val]);
          return builder;
        },
        maybeSingle: () =>
          Promise.resolve({
            data: opts.reviewFound ? { id: REVIEW_ID } : null,
            error: null,
          }),
      };
      return builder;
    }
    if (table === "review_producer_reads") {
      return {
        upsert: (payload: Record<string, unknown>) => {
          upsertPayload = payload;
          return Promise.resolve({ error: opts.upsertError ?? null });
        },
      };
    }
    throw new Error(`table inattendue: ${table}`);
  });
  return { getUpsertPayload: () => upsertPayload, eqCalls };
}

beforeEach(() => {
  sessionUser = { id: USER_ID, email: "u@test", roles: ["producer"], isAdmin: false };
  mockAdminFrom.mockReset();
});

describe("POST /api/producer/reviews/[id]/read", () => {
  it("401 si pas de session", async () => {
    sessionUser = null;
    setupAdmin({ producerId: PRODUCER_ID, reviewFound: true });

    const res = await POST(request(), { params: Promise.resolve({ id: REVIEW_ID }) });

    expect(res.status).toBe(401);
  });

  it("403 si aucun producteur rattache", async () => {
    setupAdmin({ producerId: null, reviewFound: true });

    const res = await POST(request(), { params: Promise.resolve({ id: REVIEW_ID }) });

    expect(res.status).toBe(403);
  });

  it("404 si avis introuvable ou hors producteur", async () => {
    setupAdmin({ producerId: PRODUCER_ID, reviewFound: false });

    const res = await POST(request(), { params: Promise.resolve({ id: REVIEW_ID }) });

    expect(res.status).toBe(404);
  });

  it("happy path : verifie ownership + upsert la lecture", async () => {
    const ctx = setupAdmin({ producerId: PRODUCER_ID, reviewFound: true });

    const res = await POST(request(), { params: Promise.resolve({ id: REVIEW_ID }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.readAt).toBeDefined();
    expect(ctx.eqCalls).toContainEqual(["id", REVIEW_ID]);
    expect(ctx.eqCalls).toContainEqual(["producer_id", PRODUCER_ID]);
    expect(ctx.eqCalls).toContainEqual(["statut", "published"]);
    expect(ctx.getUpsertPayload()).toMatchObject({
      review_id: REVIEW_ID,
      producer_id: PRODUCER_ID,
    });
  });

  it("500 si l'upsert lecture echoue", async () => {
    setupAdmin({
      producerId: PRODUCER_ID,
      reviewFound: true,
      upsertError: { message: "db down" },
    });

    const res = await POST(request(), { params: Promise.resolve({ id: REVIEW_ID }) });

    expect(res.status).toBe(500);
  });
});
