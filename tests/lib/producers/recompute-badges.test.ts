// Tests vitest pour lib/producers/recompute-badges.ts (T-417).
// Helper extrait de l'ancienne route PATCH /api/producers/[id]/badges
// supprimée — tous les call sites passent désormais par cette pure
// function (cron weekly-badges direct, plus de fetch HTTP interne).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { recomputeBadgesForProducer } from "@/lib/producers/recompute-badges";

type SelectResp = {
  data?: unknown;
  error?: { message: string } | null;
};

type Captured = {
  fromCalls: string[];
  selectCols: string[];
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
  gteCalls: Array<{ table: string; col: string; val: unknown }>;
  updates: Array<{ table: string; payload: Record<string, unknown> }>;
};

interface Control {
  selectOrders?: SelectResp;
  updateProducers?: SelectResp;
}

function buildClient(ctrl: Control = {}): {
  client: SupabaseClient;
  captured: Captured;
} {
  const captured: Captured = {
    fromCalls: [],
    selectCols: [],
    eqCalls: [],
    gteCalls: [],
    updates: [],
  };

  const client = {
    from: (table: string) => {
      captured.fromCalls.push(table);
      let mode: "select" | "update" | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      b.select = (cols: string) => {
        captured.selectCols.push(cols);
        mode = "select";
        return b;
      };
      b.update = (payload: Record<string, unknown>) => {
        captured.updates.push({ table, payload });
        mode = "update";
        return b;
      };
      b.eq = (col: string, val: unknown) => {
        captured.eqCalls.push({ table, col, val });
        if (mode === "update") {
          return Promise.resolve(ctrl.updateProducers ?? { error: null });
        }
        return b;
      };
      b.gte = (col: string, val: unknown) => {
        captured.gteCalls.push({ table, col, val });
        return b;
      };
      b.then = (onFulfilled: (r: SelectResp) => unknown) => {
        if (mode === "select" && table === "orders") {
          return onFulfilled(ctrl.selectOrders ?? { data: [], error: null });
        }
        return onFulfilled({ data: null, error: null });
      };
      return b;
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

const FROZEN_NOW = new Date("2026-04-29T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("recomputeBadgesForProducer", () => {
  it("path no_orders : aucune order trouvée → reason='no_orders' + pas d'UPDATE", async () => {
    const { client, captured } = buildClient({
      selectOrders: { data: [], error: null },
    });

    const res = await recomputeBadgesForProducer(client, "prod-empty");

    expect(res).toEqual({ producer_id: "prod-empty", reason: "no_orders" });
    expect(captured.updates).toHaveLength(0);
    // Cutoff = 12 mois en arrière de FROZEN_NOW.
    const expectedCutoff = "2025-04-29T12:00:00.000Z";
    expect(captured.gteCalls).toContainEqual({
      table: "orders",
      col: "created_at",
      val: expectedCutoff,
    });
  });

  it("path nominal : 5 orders dont 1 stock_cancel + 1 cancelled + 2 fast_confirmed → 3 scores corrects", async () => {
    const orders = [
      {
        id: "o1",
        statut: "completed",
        created_at: "2026-04-01T10:00:00Z",
        confirmed_at: "2026-04-01T10:30:00Z", // 30min < 2h → fast
        closure_reason: null,
      },
      {
        id: "o2",
        statut: "completed",
        created_at: "2026-04-02T10:00:00Z",
        confirmed_at: "2026-04-02T11:00:00Z", // 1h < 2h → fast
        closure_reason: null,
      },
      {
        id: "o3",
        statut: "completed",
        created_at: "2026-04-03T10:00:00Z",
        confirmed_at: "2026-04-03T13:00:00Z", // 3h > 2h → slow
        closure_reason: null,
      },
      {
        id: "o4",
        statut: "cancelled",
        created_at: "2026-04-04T10:00:00Z",
        confirmed_at: null,
        closure_reason: "stock",
      },
      {
        id: "o5",
        statut: "cancelled",
        created_at: "2026-04-05T10:00:00Z",
        confirmed_at: null,
        closure_reason: "consumer_cancel",
      },
    ];
    const { client, captured } = buildClient({
      selectOrders: { data: orders, error: null },
    });

    const res = await recomputeBadgesForProducer(client, "prod-A");

    // 5 total, 1 stock_cancel → (5-1)/5 = 80
    // 3 confirmed dont 2 fast → 2/3 = 66.67
    // 5 total, 2 cancelled (stock + consumer) → (5-2)/5 = 60
    expect(res).toEqual({
      producer_id: "prod-A",
      total_orders: 5,
      badge_stock_score: 80,
      badge_confirmation_score: 66.67,
      badge_annulation_score: 60,
    });

    // UPDATE producers avec les 3 scores
    expect(captured.updates).toEqual([
      {
        table: "producers",
        payload: {
          badge_stock_score: 80,
          badge_confirmation_score: 66.67,
          badge_annulation_score: 60,
        },
      },
    ]);
  });

  it("path SELECT error : remonte error sans UPDATE", async () => {
    const { client, captured } = buildClient({
      selectOrders: { data: null, error: { message: "RLS denied" } },
    });

    const res = await recomputeBadgesForProducer(client, "prod-rls");

    expect(res).toEqual({ producer_id: "prod-rls", error: "RLS denied" });
    expect(captured.updates).toHaveLength(0);
  });

  it("path UPDATE error : remonte error", async () => {
    const orders = [
      {
        id: "o1",
        statut: "completed",
        created_at: "2026-04-01T10:00:00Z",
        confirmed_at: "2026-04-01T10:30:00Z",
        closure_reason: null,
      },
    ];
    const { client, captured } = buildClient({
      selectOrders: { data: orders, error: null },
      updateProducers: { error: { message: "constraint violation" } },
    });

    const res = await recomputeBadgesForProducer(client, "prod-fail-update");

    expect(res).toEqual({
      producer_id: "prod-fail-update",
      error: "constraint violation",
    });
    // L'UPDATE a bien été tenté (effet de bord noté).
    expect(captured.updates).toHaveLength(1);
  });

  it("edge case : 0 confirmation → fast_confirmed=0/max(0,1)=0/1=0 (pas de div by 0)", async () => {
    const orders = [
      {
        id: "o1",
        statut: "pending",
        created_at: "2026-04-01T10:00:00Z",
        confirmed_at: null,
        closure_reason: null,
      },
    ];
    const { client } = buildClient({
      selectOrders: { data: orders, error: null },
    });

    const res = await recomputeBadgesForProducer(client, "prod-no-confirm");

    expect(res.badge_confirmation_score).toBe(0);
  });
});
