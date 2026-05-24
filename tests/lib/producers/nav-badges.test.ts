import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// fetchProducerNavBadges agrège 2 compteurs pour la sidebar producteur
// (ADR-0011). On mocke le client Supabase (chaîne from/select/eq awaitable)
// et fetchProducerAlerts. `server-only` est neutralisé par tests/setup.ts.

vi.mock("@/lib/stock-alerts/fetch-producer-alerts", () => ({
  fetchProducerAlerts: vi.fn(),
}));

import { fetchProducerNavBadges } from "@/lib/producers/nav-badges";
import { fetchProducerAlerts } from "@/lib/stock-alerts/fetch-producer-alerts";

const mockedFetchAlerts = vi.mocked(fetchProducerAlerts);

type EqCall = [string, unknown];

function makeAdmin(count: number | null) {
  const eqCalls: EqCall[] = [];
  const builder: Record<string, unknown> = {
    from: vi.fn(() => builder),
    select: vi.fn(() => builder),
    eq: vi.fn((col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return builder;
    }),
    then: (resolve: (v: { count: number | null }) => unknown) =>
      resolve({ count }),
  };
  return { admin: builder as unknown as SupabaseClient, eqCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchProducerNavBadges", () => {
  it("ordersToConfirm reflète le count des commandes pending", async () => {
    mockedFetchAlerts.mockResolvedValue([]);
    const { admin, eqCalls } = makeAdmin(3);

    const badges = await fetchProducerNavBadges(admin, "prod-1");

    expect(badges.ordersToConfirm).toBe(3);
    // Filtre bien sur producer_id + statut 'pending'.
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

  it("fail-open : count null → 0", async () => {
    mockedFetchAlerts.mockResolvedValue([]);
    const { admin } = makeAdmin(null);

    const badges = await fetchProducerNavBadges(admin, "prod-1");

    expect(badges.ordersToConfirm).toBe(0);
  });

  it("fail-open : erreur alertes → stockRuptures 0 (pas de throw)", async () => {
    mockedFetchAlerts.mockRejectedValue(new Error("boom"));
    const { admin } = makeAdmin(5);

    const badges = await fetchProducerNavBadges(admin, "prod-1");

    expect(badges).toEqual({ ordersToConfirm: 5, stockRuptures: 0 });
  });
});
