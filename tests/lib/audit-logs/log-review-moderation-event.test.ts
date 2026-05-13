import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "test-service-role-key";
});

const { mockInsert, mockFrom } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: mockFrom }),
}));

import {
  REVIEW_MODERATION_EVENT_TYPES,
  logReviewModerationEvent,
} from "@/lib/audit-logs/log-review-moderation-event";

beforeEach(() => {
  mockInsert.mockReset().mockResolvedValue({ error: null });
  mockFrom.mockReset().mockReturnValue({ insert: mockInsert });
});

describe("REVIEW_MODERATION_EVENT_TYPES", () => {
  it("expose les 2 event_types attendus (publish + reject)", () => {
    expect(REVIEW_MODERATION_EVENT_TYPES).toContain("admin_review_published");
    expect(REVIEW_MODERATION_EVENT_TYPES).toContain("admin_review_rejected");
    expect(REVIEW_MODERATION_EVENT_TYPES).toHaveLength(2);
  });
});

describe("logReviewModerationEvent", () => {
  it("insère dans audit_logs avec event_type + user_id + metadata", async () => {
    await logReviewModerationEvent({
      eventType: "admin_review_published",
      userId: "admin-1",
      metadata: {
        review_id: "r1",
        producer_id: "p1",
        previous_statut: "pending",
      },
    });
    expect(mockFrom).toHaveBeenCalledWith("audit_logs");
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "admin-1",
        event_type: "admin_review_published",
        metadata: expect.objectContaining({
          review_id: "r1",
          producer_id: "p1",
          previous_statut: "pending",
        }),
      }),
    );
  });

  it("metadata par défaut = {} si non fourni", async () => {
    await logReviewModerationEvent({
      eventType: "admin_review_rejected",
      userId: "admin-1",
    });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: {} }),
    );
  });

  it("fail-safe : un échec d'insert ne re-throw pas", async () => {
    mockInsert.mockResolvedValueOnce({ error: { message: "boom" } });
    await expect(
      logReviewModerationEvent({
        eventType: "admin_review_published",
        userId: null,
      }),
    ).resolves.toBeUndefined();
  });

  it("fail-safe : un throw client est swallow", async () => {
    mockFrom.mockImplementationOnce(() => {
      throw new Error("client crashed");
    });
    await expect(
      logReviewModerationEvent({
        eventType: "admin_review_rejected",
        userId: "admin-1",
      }),
    ).resolves.toBeUndefined();
  });
});
