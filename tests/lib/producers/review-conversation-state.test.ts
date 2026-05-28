import { describe, expect, it } from "vitest";
import {
  compareReviewConversationState,
  getReviewConversationState,
} from "@/lib/producers/review-conversation-state";

const REVIEW_AT = "2026-05-20T10:00:00.000Z";
const RESPONSE_AT = "2026-05-20T12:00:00.000Z";
const CLIENT_AFTER_RESPONSE_AT = "2026-05-21T09:00:00.000Z";

describe("getReviewConversationState", () => {
  it("avis client non lu sans reponse -> a repondre + non lu", () => {
    const state = getReviewConversationState({
      createdAt: REVIEW_AT,
      publishedAt: REVIEW_AT,
      producerResponse: null,
      producerResponseAt: null,
      producerResponseUpdatedAt: null,
      producerResponseStatus: null,
      producerReadAt: null,
    });

    expect(state).toMatchObject({
      lastMessageSender: "consumer",
      needsResponse: true,
      unread: true,
    });
  });

  it("avis client deja lu sans reponse -> a repondre mais pas non lu", () => {
    const state = getReviewConversationState({
      createdAt: REVIEW_AT,
      publishedAt: REVIEW_AT,
      producerResponse: null,
      producerResponseAt: null,
      producerResponseUpdatedAt: null,
      producerResponseStatus: null,
      producerReadAt: "2026-05-20T11:00:00.000Z",
    });

    expect(state.needsResponse).toBe(true);
    expect(state.unread).toBe(false);
  });

  it("reponse producteur plus recente -> repondu", () => {
    const state = getReviewConversationState({
      createdAt: REVIEW_AT,
      publishedAt: REVIEW_AT,
      producerResponse: "Merci",
      producerResponseAt: RESPONSE_AT,
      producerResponseUpdatedAt: null,
      producerResponseStatus: "published",
      producerReadAt: null,
    });

    expect(state).toMatchObject({
      lastMessageSender: "producer",
      needsResponse: false,
      unread: false,
    });
  });

  it("message client plus recent que la reponse existante -> a repondre", () => {
    const state = getReviewConversationState({
      createdAt: REVIEW_AT,
      publishedAt: CLIENT_AFTER_RESPONSE_AT,
      producerResponse: "Merci",
      producerResponseAt: RESPONSE_AT,
      producerResponseUpdatedAt: null,
      producerResponseStatus: "published",
      producerReadAt: "2026-05-20T13:00:00.000Z",
    });

    expect(state).toMatchObject({
      lastMessageSender: "consumer",
      needsResponse: true,
      unread: true,
    });
  });

  it("relance client apres lecture -> nouveau revient", () => {
    const state = getReviewConversationState({
      createdAt: REVIEW_AT,
      publishedAt: CLIENT_AFTER_RESPONSE_AT,
      producerResponse: "Merci",
      producerResponseAt: RESPONSE_AT,
      producerResponseUpdatedAt: null,
      producerResponseStatus: "published",
      producerReadAt: "2026-05-20T13:00:00.000Z",
    });

    expect(state.needsResponse).toBe(true);
    expect(state.unread).toBe(true);
  });

  it("reponse supprimee -> dernier message utile cote client", () => {
    const state = getReviewConversationState({
      createdAt: REVIEW_AT,
      publishedAt: REVIEW_AT,
      producerResponse: null,
      producerResponseAt: RESPONSE_AT,
      producerResponseUpdatedAt: null,
      producerResponseStatus: "removed_producer",
      producerReadAt: "2026-05-20T11:00:00.000Z",
    });

    expect(state.lastMessageSender).toBe("consumer");
    expect(state.needsResponse).toBe(true);
    expect(state.unread).toBe(false);
  });
});

describe("compareReviewConversationState", () => {
  it("classe les non lus a repondre, puis les lus a repondre, puis les repondues", () => {
    const answered = getReviewConversationState({
      createdAt: REVIEW_AT,
      publishedAt: REVIEW_AT,
      producerResponse: "Merci",
      producerResponseAt: "2026-05-22T10:00:00.000Z",
      producerResponseUpdatedAt: null,
      producerResponseStatus: "published",
      producerReadAt: null,
    });
    const oldUnreadNeedsResponse = getReviewConversationState({
      createdAt: "2026-05-18T10:00:00.000Z",
      publishedAt: "2026-05-18T10:00:00.000Z",
      producerResponse: null,
      producerResponseAt: null,
      producerResponseUpdatedAt: null,
      producerResponseStatus: null,
      producerReadAt: null,
    });
    const recentReadNeedsResponse = getReviewConversationState({
      createdAt: "2026-05-19T10:00:00.000Z",
      publishedAt: "2026-05-19T10:00:00.000Z",
      producerResponse: null,
      producerResponseAt: null,
      producerResponseUpdatedAt: null,
      producerResponseStatus: null,
      producerReadAt: "2026-05-19T11:00:00.000Z",
    });

    const sorted = [answered, oldUnreadNeedsResponse, recentReadNeedsResponse].sort(
      compareReviewConversationState,
    );

    expect(sorted).toEqual([
      oldUnreadNeedsResponse,
      recentReadNeedsResponse,
      answered,
    ]);
  });
});
