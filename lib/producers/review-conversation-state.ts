export type ReviewConversationSender = "consumer" | "producer";

export type ReviewConversationInput = {
  createdAt: string | null;
  publishedAt: string | null;
  producerResponse: string | null;
  producerResponseAt: string | null;
  producerResponseUpdatedAt: string | null;
  producerResponseStatus: "published" | "removed_admin" | "removed_producer" | null;
  producerReadAt: string | null;
};

export type ReviewConversationState = {
  lastMessageSender: ReviewConversationSender;
  lastMessageAt: string | null;
  needsResponse: boolean;
  unread: boolean;
};

function timestamp(iso: string | null): number | null {
  if (!iso) return null;
  const value = new Date(iso).getTime();
  return Number.isNaN(value) ? null : value;
}

function latestIso(a: string | null, b: string | null): string | null {
  const aTs = timestamp(a);
  const bTs = timestamp(b);
  if (aTs === null) return bTs === null ? null : b;
  if (bTs === null) return a;
  return bTs > aTs ? b : a;
}

export function getReviewConversationState(
  input: ReviewConversationInput,
): ReviewConversationState {
  const consumerMessageAt = input.publishedAt ?? input.createdAt;
  const producerMessageAt =
    input.producerResponse !== null && input.producerResponseStatus === "published"
      ? latestIso(input.producerResponseAt, input.producerResponseUpdatedAt)
      : null;

  const consumerTs = timestamp(consumerMessageAt);
  const producerTs = timestamp(producerMessageAt);
  const producerHasLastMessage =
    producerTs !== null && (consumerTs === null || producerTs >= consumerTs);

  const lastMessageSender: ReviewConversationSender = producerHasLastMessage
    ? "producer"
    : "consumer";
  const lastMessageAt = producerHasLastMessage
    ? producerMessageAt
    : consumerMessageAt;
  const needsResponse = lastMessageSender === "consumer";
  const readTs = timestamp(input.producerReadAt);
  const unread =
    needsResponse &&
    consumerTs !== null &&
    (readTs === null || readTs < consumerTs);

  return {
    lastMessageSender,
    lastMessageAt,
    needsResponse,
    unread,
  };
}

export function compareReviewConversationState(
  a: ReviewConversationState,
  b: ReviewConversationState,
): number {
  const rank = (state: ReviewConversationState) => {
    if (state.needsResponse && state.unread) return 0;
    if (state.needsResponse) return 1;
    if (state.unread) return 2;
    return 3;
  };
  const aRank = rank(a);
  const bRank = rank(b);
  if (aRank !== bRank) return aRank - bRank;

  const aTs = timestamp(a.lastMessageAt) ?? 0;
  const bTs = timestamp(b.lastMessageAt) ?? 0;
  return bTs - aTs;
}
