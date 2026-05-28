import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/stock-alerts/fetch-producer-alerts", () => ({
  fetchProducerAlerts: vi.fn(),
}));

import { fetchProducerNavBadges } from "@/lib/producers/nav-badges";
import { fetchProducerAlerts } from "@/lib/stock-alerts/fetch-producer-alerts";

const mockedFetchAlerts = vi.mocked(fetchProducerAlerts);

type EqCall = [string, unknown];

type ReviewFixture = {
  created_at: string | null;
  published_at: string | null;
  producer_response: string | null;
  producer_response_at: string | null;
  producer_response_updated_at: string | null;
  producer_response_status: "published" | "removed_admin" | "removed_producer" | null;
};

function makeAdmin(
  count: number | null,
  reviews: ReviewFixture[] = [],
  reviewsError: unknown = null,
) {
  const eqCalls: EqCall[] = [];
  const ordersBuilder: Record<string, unknown> = {
    select: vi.fn(() => ordersBuilder),
    eq: vi.fn((col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return ordersBuilder;
    }),
    then: (resolve: (v: { count: number | null }) => unknown) =>
      resolve({ count }),
  };
  const reviewsBuilder: Record<string, unknown> = {
    select: vi.fn(() => reviewsBuilder),
    eq: vi.fn((col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return reviewsBuilder;
    }),
    then: (resolve: (v: { data: ReviewFixture[] | null; error: unknown }) => unknown) =>
      resolve({
        data: reviewsError ? null : reviews,
        error: reviewsError,
      }),
  };
  const admin = {
    from: vi.fn((table: string) => {
      if (table === "orders") return ordersBuilder;
      if (table === "reviews") return reviewsBuilder;
      throw new Error(`table inattendue: ${table}`);
    }),
  } as unknown as SupabaseClient;
  return { admin, eqCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchProducerNavBadges", () => {
  it("ordersToConfirm reflete le count des commandes pending", async () => {
    mockedFetchAlerts.mockResolvedValue([]);
    const { admin, eqCalls } = makeAdmin(3);

    const badges = await fetchProducerNavBadges(admin, "prod-1");

    expect(badges.ordersToConfirm).toBe(3);
    expect(eqCalls).toContainEqual(["producer_id", "prod-1"]);
    expect(eqCalls).toContainEqual(["statut", "pending"]);
  });

  it("stockRuptures = nombre de produits avec alerte active", async () => {
    mockedFetchAlerts.mockResolvedValue([
      { product_id: "p1", product_name: "A", count: 2 },
      { product_id: "p2", product_name: "B", count: 1 },
    ]);
    const { admin } = makeAdmin(0);

    const badges = await fetchProducerNavBadges(admin, "prod-1");

    expect(badges.stockRuptures).toBe(2);
  });

  it("reviewsToAnswer compte les conversations dont le dernier message vient du client", async () => {
    mockedFetchAlerts.mockResolvedValue([]);
    const { admin } = makeAdmin(0, [
      {
        created_at: "2026-05-20T10:00:00.000Z",
        published_at: "2026-05-20T10:00:00.000Z",
        producer_response: null,
        producer_response_at: null,
        producer_response_updated_at: null,
        producer_response_status: null,
      },
      {
        created_at: "2026-05-21T10:00:00.000Z",
        published_at: "2026-05-21T10:00:00.000Z",
        producer_response: "Merci",
        producer_response_at: "2026-05-21T11:00:00.000Z",
        producer_response_updated_at: null,
        producer_response_status: "published",
      },
      {
        created_at: "2026-05-22T10:00:00.000Z",
        published_at: "2026-05-23T10:00:00.000Z",
        producer_response: "Ancienne reponse",
        producer_response_at: "2026-05-22T11:00:00.000Z",
        producer_response_updated_at: null,
        producer_response_status: "published",
      },
    ]);

    const badges = await fetchProducerNavBadges(admin, "prod-1");

    expect(badges.reviewsToAnswer).toBe(2);
  });

  it("fail-open : count null -> 0", async () => {
    mockedFetchAlerts.mockResolvedValue([]);
    const { admin } = makeAdmin(null);

    const badges = await fetchProducerNavBadges(admin, "prod-1");

    expect(badges.ordersToConfirm).toBe(0);
  });

  it("fail-open : erreur alertes -> stockRuptures 0", async () => {
    mockedFetchAlerts.mockRejectedValue(new Error("boom"));
    const { admin } = makeAdmin(5);

    const badges = await fetchProducerNavBadges(admin, "prod-1");

    expect(badges).toEqual({
      ordersToConfirm: 5,
      stockRuptures: 0,
      reviewsToAnswer: 0,
    });
  });

  it("fail-open : erreur reviews -> reviewsToAnswer 0", async () => {
    mockedFetchAlerts.mockResolvedValue([]);
    const { admin } = makeAdmin(0, [], new Error("reviews down"));

    const badges = await fetchProducerNavBadges(admin, "prod-1");

    expect(badges.reviewsToAnswer).toBe(0);
  });
});
