// Tests POST /api/admin/reviews/[id]/moderate.
// Couvre : auth admin, payload invalide, review absente, publish + audit log,
// reject + audit log, échec UPDATE → 500 sans audit log.

import { describe, it, expect, vi, beforeEach } from "vitest";

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

const {
  mockAdminFrom,
  mockLogModeration,
  mockRevalidateProducerCard,
  mockRevalidateProducerReviews,
} = vi.hoisted(() => ({
  mockAdminFrom: vi.fn(),
  mockLogModeration: vi.fn(),
  mockRevalidateProducerCard: vi.fn(),
  mockRevalidateProducerReviews: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: mockAdminFrom }),
}));

vi.mock("@/lib/audit-logs/log-review-moderation-event", () => ({
  logReviewModerationEvent: mockLogModeration,
}));

vi.mock("@/lib/stats/revalidate", () => ({
  revalidateProducerCard: mockRevalidateProducerCard,
  revalidateProducerReviews: mockRevalidateProducerReviews,
}));

import { POST } from "@/app/api/admin/reviews/[id]/moderate/route";

const REVIEW_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const ADMIN_ID = "dddddddd-dddd-4ddd-dddd-dddddddddddd";
const PRODUCER_ID = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
const PRODUCER_SLUG = "test-slug";

function makeRequest(body: unknown): Request {
  return new Request(`http://localhost/api/admin/reviews/${REVIEW_ID}/moderate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Stub Supabase admin. Trois interactions ciblées :
//  - reviews.select.eq.maybeSingle → renvoie review (ou null)
//  - reviews.update.eq → renvoie { error } configurable
//  - reviews.select.eq.eq → stats (note=published) renvoie liste
//  - producers.update.eq → renvoie { error: null }
type StubOptions = {
  review: Record<string, unknown> | null;
  updateError?: { message: string } | null;
  statsRows?: Array<{ note: number }>;
};

function setupAdminStub(opts: StubOptions) {
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === "reviews") {
      return {
        select: (cols: string) => {
          // Stats query : "note" only, deux .eq()
          if (cols === "note") {
            return {
              eq: () => ({
                eq: () => Promise.resolve({ data: opts.statsRows ?? [], error: null }),
              }),
            };
          }
          // Review lookup : "id, producer_id, statut, producers!inner(slug)"
          return {
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: opts.review, error: null }),
            }),
          };
        },
        update: () => ({
          eq: () =>
            Promise.resolve({ error: opts.updateError ?? null }),
        }),
      };
    }
    if (table === "producers") {
      return {
        update: () => ({
          eq: () => Promise.resolve({ error: null }),
        }),
      };
    }
    return {};
  });
}

beforeEach(() => {
  sessionUser = {
    id: ADMIN_ID,
    email: "admin@test",
    roles: [],
    isAdmin: true,
  };
  mockAdminFrom.mockReset();
  mockLogModeration.mockReset().mockResolvedValue(undefined);
  mockRevalidateProducerCard.mockReset().mockResolvedValue(undefined);
  mockRevalidateProducerReviews.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/admin/reviews/[id]/moderate", () => {
  it("403 si pas de session", async () => {
    sessionUser = null;
    const res = await POST(makeRequest({ action: "publish" }), {
      params: Promise.resolve({ id: REVIEW_ID }),
    });
    expect(res.status).toBe(403);
    expect(mockLogModeration).not.toHaveBeenCalled();
  });

  it("403 si pas admin", async () => {
    sessionUser = {
      id: "consumer",
      email: null,
      roles: ["consumer"],
      isAdmin: false,
    };
    const res = await POST(makeRequest({ action: "publish" }), {
      params: Promise.resolve({ id: REVIEW_ID }),
    });
    expect(res.status).toBe(403);
  });

  it("400 si payload invalide", async () => {
    const res = await POST(makeRequest({ action: "invalid" }), {
      params: Promise.resolve({ id: REVIEW_ID }),
    });
    expect(res.status).toBe(400);
  });

  it("404 si review inexistante", async () => {
    setupAdminStub({ review: null });
    const res = await POST(makeRequest({ action: "publish" }), {
      params: Promise.resolve({ id: REVIEW_ID }),
    });
    expect(res.status).toBe(404);
    expect(mockLogModeration).not.toHaveBeenCalled();
  });

  it("publish : 200 + audit log admin_review_published + previous_statut", async () => {
    setupAdminStub({
      review: {
        id: REVIEW_ID,
        producer_id: PRODUCER_ID,
        statut: "pending",
        producers: { slug: PRODUCER_SLUG },
      },
      statsRows: [{ note: 5 }, { note: 4 }],
    });
    const res = await POST(makeRequest({ action: "publish" }), {
      params: Promise.resolve({ id: REVIEW_ID }),
    });
    expect(res.status).toBe(200);
    expect(mockLogModeration).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "admin_review_published",
        userId: ADMIN_ID,
        metadata: expect.objectContaining({
          review_id: REVIEW_ID,
          producer_id: PRODUCER_ID,
          previous_statut: "pending",
        }),
      }),
    );
    expect(mockRevalidateProducerCard).toHaveBeenCalledWith(
      expect.objectContaining({ slug: PRODUCER_SLUG }),
    );
    expect(mockRevalidateProducerReviews).toHaveBeenCalledWith(
      expect.objectContaining({ slug: PRODUCER_SLUG }),
    );
  });

  it("reject : 200 + audit log admin_review_rejected", async () => {
    setupAdminStub({
      review: {
        id: REVIEW_ID,
        producer_id: PRODUCER_ID,
        statut: "pending",
        producers: { slug: PRODUCER_SLUG },
      },
    });
    const res = await POST(makeRequest({ action: "reject" }), {
      params: Promise.resolve({ id: REVIEW_ID }),
    });
    expect(res.status).toBe(200);
    expect(mockLogModeration).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "admin_review_rejected",
        metadata: expect.objectContaining({
          previous_statut: "pending",
        }),
      }),
    );
  });

  it("500 si UPDATE échoue + pas d'audit log émis", async () => {
    setupAdminStub({
      review: {
        id: REVIEW_ID,
        producer_id: PRODUCER_ID,
        statut: "pending",
        producers: { slug: PRODUCER_SLUG },
      },
      updateError: { message: "constraint X violation" },
    });
    const res = await POST(makeRequest({ action: "publish" }), {
      params: Promise.resolve({ id: REVIEW_ID }),
    });
    expect(res.status).toBe(500);
    // Audit log doit suivre la mutation, pas la précéder.
    expect(mockLogModeration).not.toHaveBeenCalled();
  });
});
