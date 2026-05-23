import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchAdminPendingRefundsList,
  fetchRefundsBadgeCount,
} from "@/lib/admin/refunds/fetch";

// Tests des helpers service_role de la section Remboursements (chantier 5) :
//   - fetchAdminPendingRefundsList : mapping raw→row + normalisation jointures.
//   - fetchRefundsBadgeCount : agrégation pending_refunds(pending) +
//     refund_incidents(pending,retrying), fail-open.

type Resp = { data?: unknown; error?: unknown; count?: number | null };

// Mock chainable + thenable, réponse configurée par table. `limit`, `eq`, `in`
// sont terminaux (resolve la réponse). `select`/`order` chaînent.
function makeAdmin(responses: Record<string, Resp>): {
  admin: SupabaseClient;
  calls: Array<{ table: string; op: string; col?: string; val?: unknown }>;
} {
  const calls: Array<{ table: string; op: string; col?: string; val?: unknown }> = [];
  function builder(table: string) {
    const resp = responses[table] ?? { data: [], error: null, count: 0 };
    const b: Record<string, unknown> = {};
    b.select = (...a: unknown[]) => {
      calls.push({ table, op: "select", val: a });
      return b;
    };
    b.order = () => b;
    b.limit = () => Promise.resolve(resp);
    b.eq = (col: string, val: unknown) => {
      calls.push({ table, op: "eq", col, val });
      return Promise.resolve(resp);
    };
    b.in = (col: string, val: unknown) => {
      calls.push({ table, op: "in", col, val });
      return Promise.resolve(resp);
    };
    b.then = (onF: (r: Resp) => unknown) => onF(resp);
    return b;
  }
  return {
    admin: { from: (t: string) => builder(t) } as unknown as SupabaseClient,
    calls,
  };
}

describe("fetchAdminPendingRefundsList", () => {
  it("mappe les rows + normalise jointures objet/array + Number(amount)", async () => {
    const raw = {
      id: "pr1",
      order_id: "o1",
      producer_id: "p1",
      amount_eur: "42.50",
      reason: "trop cher",
      status: "pending",
      requested_at: "2026-05-20T10:00:00Z",
      decided_at: null,
      decision_reason: null,
      order: { code_commande: "TRR-ABC" },
      producer: [{ nom_exploitation: "Ferme A" }],
    };
    const { admin } = makeAdmin({ pending_refunds: { data: [raw], error: null } });
    const res = await fetchAdminPendingRefundsList(admin);
    expect(res.error).toBeNull();
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      id: "pr1",
      amount_eur: 42.5,
      status: "pending",
      order_code: "TRR-ABC",
      producer_name: "Ferme A",
    });
  });

  it("erreur DB → rows vide + message", async () => {
    const { admin } = makeAdmin({
      pending_refunds: { data: null, error: { message: "boom" } },
    });
    const res = await fetchAdminPendingRefundsList(admin);
    expect(res.rows).toEqual([]);
    expect(res.error).toBe("boom");
  });
});

describe("fetchRefundsBadgeCount", () => {
  it("agrège pending_refunds(pending) + refund_incidents(pending,retrying)", async () => {
    const { admin, calls } = makeAdmin({
      pending_refunds: { count: 3, error: null },
      refund_incidents: { count: 2, error: null },
    });
    const total = await fetchRefundsBadgeCount(admin);
    expect(total).toBe(5);
    // pending_refunds filtré sur status='pending', refund_incidents sur in().
    expect(calls).toContainEqual({
      table: "pending_refunds",
      op: "eq",
      col: "status",
      val: "pending",
    });
    expect(calls).toContainEqual({
      table: "refund_incidents",
      op: "in",
      col: "status",
      val: ["pending", "retrying"],
    });
  });

  it("fail-open : count null → compté 0", async () => {
    const { admin } = makeAdmin({
      pending_refunds: { count: null, error: { message: "x" } },
      refund_incidents: { count: 4, error: null },
    });
    const total = await fetchRefundsBadgeCount(admin);
    expect(total).toBe(4);
  });
});
