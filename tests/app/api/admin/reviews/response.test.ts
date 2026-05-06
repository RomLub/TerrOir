// Tests vitest pour DELETE /api/admin/reviews/[id]/response.
// Couvre : auth admin, ownership review, override lock 24h, snapshot.

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

const { mockAdminFrom, mockLogReview } = vi.hoisted(() => ({
  mockAdminFrom: vi.fn(),
  mockLogReview: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: mockAdminFrom }),
}));

vi.mock("@/lib/audit-logs/log-review-event", () => ({
  logReviewEvent: mockLogReview,
}));

import { DELETE } from "@/app/api/admin/reviews/[id]/response/route";

const REVIEW_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const ADMIN_ID = "dddddddd-dddd-4ddd-dddd-dddddddddddd";
const PRODUCER_ID = "cccccccc-cccc-4ccc-cccc-cccccccccccc";

function makeRequest(): Request {
  return new Request(`http://localhost/api/admin/reviews/${REVIEW_ID}/response`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
  });
}

function setupReviewLookup(review: Record<string, unknown> | null) {
  let updatePayload: Record<string, unknown> | null = null;
  mockAdminFrom.mockImplementation((table: string) => {
    if (table !== "reviews") {
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
    }
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: review, error: null }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        updatePayload = payload;
        return { eq: () => Promise.resolve({ error: null }) };
      },
    };
  });
  return { getUpdatePayload: () => updatePayload };
}

beforeEach(() => {
  sessionUser = { id: ADMIN_ID, email: "admin@test", roles: [], isAdmin: true };
  mockAdminFrom.mockReset();
  mockLogReview.mockReset();
});

describe("DELETE /api/admin/reviews/[id]/response", () => {
  it("403 si pas admin", async () => {
    sessionUser = { id: "consumer", email: null, roles: ["consumer"], isAdmin: false };
    const res = await DELETE(makeRequest(), { params: { id: REVIEW_ID } });
    expect(res.status).toBe(403);
  });

  it("404 si review inexistante", async () => {
    setupReviewLookup(null);
    const res = await DELETE(makeRequest(), { params: { id: REVIEW_ID } });
    expect(res.status).toBe(404);
  });

  it("409 si pas de réponse à supprimer", async () => {
    setupReviewLookup({
      id: REVIEW_ID,
      producer_id: PRODUCER_ID,
      producer_response: null,
    });
    const res = await DELETE(makeRequest(), { params: { id: REVIEW_ID } });
    expect(res.status).toBe(409);
  });

  it("override lock 24h : admin peut supprimer même si lock passé", async () => {
    const pastLock = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const ctx = setupReviewLookup({
      id: REVIEW_ID,
      producer_id: PRODUCER_ID,
      producer_response: "réponse abusive",
      producer_response_locked_at: pastLock,
    });
    const res = await DELETE(makeRequest(), { params: { id: REVIEW_ID } });
    expect(res.status).toBe(200);
    const payload = ctx.getUpdatePayload() as Record<string, unknown>;
    expect(payload.producer_response).toBeNull();
    expect(payload.producer_response_status).toBe("removed_admin");
    expect(mockLogReview).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "producer_response_removed_by_admin",
        userId: ADMIN_ID,
        metadata: expect.objectContaining({ response_length: 15 }),
      }),
    );
  });
});
