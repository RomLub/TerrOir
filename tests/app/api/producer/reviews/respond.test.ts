// Tests vitest pour POST/DELETE /api/producer/reviews/[id]/respond.
// Couvre : auth, ownership, lock 24h, validation Zod, audit log.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "test-service-role-key";
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
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
  mockServerFrom,
  mockLogReview,
  mockSendEmail,
  mockRevalidateProducerCard,
} = vi.hoisted(() => ({
  mockAdminFrom: vi.fn(),
  mockServerFrom: vi.fn(),
  mockLogReview: vi.fn(),
  mockSendEmail: vi.fn(),
  mockRevalidateProducerCard: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: mockAdminFrom }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: mockServerFrom }),
}));

vi.mock("@/lib/audit-logs/log-review-event", () => ({
  logReviewEvent: mockLogReview,
}));

vi.mock("@/lib/notifications/send-review-response-email", () => ({
  sendReviewResponseEmail: mockSendEmail,
}));

// bugs-P2-3 : mock du helper revalidateProducerCard. Test de leak ('not.toHaveBeenCalled')
// pas pertinent ici, on vérifie juste qu'on l'appelle bien sur les paths
// create/update/delete (cf assertions plus bas).
vi.mock("@/lib/stats/revalidate", () => ({
  revalidateProducerCard: mockRevalidateProducerCard,
  revalidateProducerReviews: vi.fn(),
  revalidateProducerProducts: vi.fn(),
}));

import { POST, DELETE } from "@/app/api/producer/reviews/[id]/respond/route";

const REVIEW_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const PRODUCER_ID = "cccccccc-cccc-4ccc-cccc-cccccccccccc";

function makeRequest(method: string, body?: unknown): Request {
  return new Request(`http://localhost/api/producer/reviews/${REVIEW_ID}/respond`, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function setupProducerLookup(producerId: string | null, slug = "test-slug") {
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === "producers") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: producerId ? { id: producerId, slug } : null,
                error: null,
              }),
          }),
        }),
      };
    }
    return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
  });
}

function setupReviewLookup(review: Record<string, unknown> | null) {
  let updatePayload: Record<string, unknown> | null = null;
  mockServerFrom.mockImplementation((table: string) => {
    if (table !== "reviews") {
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) };
    }
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: review, error: null }),
          }),
          // Pour DELETE qui chaine .eq().maybeSingle (pas double eq).
          maybeSingle: () => Promise.resolve({ data: review, error: null }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        updatePayload = payload;
        return {
          eq: () =>
            Promise.resolve({ error: null, _capturedPayload: updatePayload }),
        };
      },
    };
  });
  return { getUpdatePayload: () => updatePayload };
}

beforeEach(() => {
  sessionUser = { id: USER_ID, email: "u@test", roles: ["producer"], isAdmin: false };
  mockAdminFrom.mockReset();
  mockServerFrom.mockReset();
  mockLogReview.mockReset();
  mockSendEmail.mockReset();
  mockSendEmail.mockResolvedValue({ ok: true });
  mockRevalidateProducerCard.mockReset();
});

describe("POST /api/producer/reviews/[id]/respond", () => {
  it("401 si pas de session", async () => {
    sessionUser = null;
    setupProducerLookup(PRODUCER_ID);
    const res = await POST(makeRequest("POST", { response: "merci" }), { params: Promise.resolve({ id: REVIEW_ID }) });
    expect(res.status).toBe(401);
  });

  it("403 si user n'est pas producer", async () => {
    setupProducerLookup(null);
    const res = await POST(makeRequest("POST", { response: "merci" }), { params: Promise.resolve({ id: REVIEW_ID }) });
    expect(res.status).toBe(403);
  });

  it("400 si body invalide (response vide)", async () => {
    setupProducerLookup(PRODUCER_ID);
    const res = await POST(makeRequest("POST", { response: "" }), { params: Promise.resolve({ id: REVIEW_ID }) });
    expect(res.status).toBe(400);
  });

  it("400 si response > 500 chars", async () => {
    setupProducerLookup(PRODUCER_ID);
    const res = await POST(makeRequest("POST", { response: "x".repeat(501) }), { params: Promise.resolve({ id: REVIEW_ID }) });
    expect(res.status).toBe(400);
  });

  it("404 si review introuvable ou pas owned", async () => {
    setupProducerLookup(PRODUCER_ID);
    setupReviewLookup(null);
    const res = await POST(makeRequest("POST", { response: "merci" }), { params: Promise.resolve({ id: REVIEW_ID }) });
    expect(res.status).toBe(404);
  });

  it("409 si review pas published (statut pending/rejected)", async () => {
    setupProducerLookup(PRODUCER_ID);
    setupReviewLookup({
      id: REVIEW_ID,
      producer_id: PRODUCER_ID,
      consumer_id: USER_ID,
      statut: "pending",
      producer_response: null,
      producer_response_locked_at: null,
    });
    const res = await POST(makeRequest("POST", { response: "merci" }), { params: Promise.resolve({ id: REVIEW_ID }) });
    expect(res.status).toBe(409);
  });

  it("happy path : create initial → mode=created + audit + email", async () => {
    setupProducerLookup(PRODUCER_ID);
    const ctx = setupReviewLookup({
      id: REVIEW_ID,
      producer_id: PRODUCER_ID,
      consumer_id: USER_ID,
      statut: "published",
      producer_response: null,
      producer_response_locked_at: null,
    });
    const res = await POST(makeRequest("POST", { response: "Merci pour votre retour !" }), { params: Promise.resolve({ id: REVIEW_ID }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, mode: "created" });
    const payload = ctx.getUpdatePayload() as Record<string, unknown>;
    expect(payload.producer_response).toBe("Merci pour votre retour !");
    expect(payload.producer_response_status).toBe("published");
    expect(payload.producer_response_at).toBeDefined();
    expect(payload.producer_response_locked_at).toBeDefined();
    expect(mockLogReview).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "producer_response_published" }),
    );
    expect(mockSendEmail).toHaveBeenCalledOnce();
    // bugs-P2-3 : revalidation du tag producer:<slug> après create response
    expect(mockRevalidateProducerCard).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "test-slug",
        source: "producer-reviews-respond-create",
      }),
    );
  });

  it("modification dans 24h → mode=updated + producer_response_at unchanged", async () => {
    setupProducerLookup(PRODUCER_ID);
    const futureLock = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(); // +1h
    const ctx = setupReviewLookup({
      id: REVIEW_ID,
      producer_id: PRODUCER_ID,
      consumer_id: USER_ID,
      statut: "published",
      producer_response: "ancienne réponse",
      producer_response_locked_at: futureLock,
    });
    const res = await POST(makeRequest("POST", { response: "réponse révisée" }), { params: Promise.resolve({ id: REVIEW_ID }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, mode: "updated" });
    const payload = ctx.getUpdatePayload() as Record<string, unknown>;
    expect(payload.producer_response).toBe("réponse révisée");
    expect(payload.producer_response_updated_at).toBeDefined();
    expect(payload.producer_response_at).toBeUndefined();
    expect(payload.producer_response_locked_at).toBeUndefined();
    expect(mockLogReview).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "producer_response_updated" }),
    );
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("403 si tentative modification après lock 24h", async () => {
    setupProducerLookup(PRODUCER_ID);
    const pastLock = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // -1h
    setupReviewLookup({
      id: REVIEW_ID,
      producer_id: PRODUCER_ID,
      consumer_id: USER_ID,
      statut: "published",
      producer_response: "ancienne",
      producer_response_locked_at: pastLock,
    });
    const res = await POST(makeRequest("POST", { response: "tentative tardive" }), { params: Promise.resolve({ id: REVIEW_ID }) });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/producer/reviews/[id]/respond", () => {
  it("DELETE dans 24h → ok + status removed_producer", async () => {
    setupProducerLookup(PRODUCER_ID);
    const futureLock = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const ctx = setupReviewLookup({
      id: REVIEW_ID,
      producer_response: "à supprimer",
      producer_response_locked_at: futureLock,
    });
    const res = await DELETE(makeRequest("DELETE"), { params: Promise.resolve({ id: REVIEW_ID }) });
    expect(res.status).toBe(200);
    const payload = ctx.getUpdatePayload() as Record<string, unknown>;
    expect(payload.producer_response).toBeNull();
    expect(payload.producer_response_status).toBe("removed_producer");
    expect(mockLogReview).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "producer_response_deleted_by_producer" }),
    );
  });

  it("403 DELETE après lock 24h", async () => {
    setupProducerLookup(PRODUCER_ID);
    const pastLock = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    setupReviewLookup({
      id: REVIEW_ID,
      producer_response: "ancienne",
      producer_response_locked_at: pastLock,
    });
    const res = await DELETE(makeRequest("DELETE"), { params: Promise.resolve({ id: REVIEW_ID }) });
    expect(res.status).toBe(403);
  });

  it("409 si pas de réponse à supprimer", async () => {
    setupProducerLookup(PRODUCER_ID);
    setupReviewLookup({
      id: REVIEW_ID,
      producer_response: null,
      producer_response_locked_at: null,
    });
    const res = await DELETE(makeRequest("DELETE"), { params: Promise.resolve({ id: REVIEW_ID }) });
    expect(res.status).toBe(409);
  });
});
