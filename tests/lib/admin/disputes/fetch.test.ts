import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Tests fetch disputes (chantier 8) : mapping liste + état live Stripe.

const { retrieveMock } = vi.hoisted(() => ({ retrieveMock: vi.fn() }));
vi.mock("@/lib/stripe/server", () => ({
  stripe: { disputes: { retrieve: retrieveMock } },
}));

import {
  fetchAdminDisputesList,
  fetchStripeDisputeLive,
} from "@/lib/admin/disputes/fetch";

type Resp = { data?: unknown; error?: unknown };
function makeAdmin(resp: Resp): SupabaseClient {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.order = () => b;
  b.limit = () => Promise.resolve(resp);
  b.eq = () => b;
  b.maybeSingle = () => Promise.resolve(resp);
  return { from: () => b } as unknown as SupabaseClient;
}

beforeEach(() => retrieveMock.mockReset());

describe("fetchAdminDisputesList", () => {
  it("mappe orderCode (jointure), amount Number, status", async () => {
    const raw = {
      id: "d1",
      stripe_dispute_id: "dp_1",
      order_id: "o1",
      status: "needs_response",
      reason: "fraudulent",
      amount: "42.50",
      currency: "eur",
      evidence_due_by: "2026-06-01T00:00:00Z",
      closed_at: null,
      created_at: "2026-05-20T10:00:00Z",
      order: { code_commande: "TRR-001" },
    };
    const res = await fetchAdminDisputesList(makeAdmin({ data: [raw], error: null }));
    expect(res.error).toBeNull();
    expect(res.rows[0]).toMatchObject({
      id: "d1",
      orderCode: "TRR-001",
      amount: 42.5,
      status: "needs_response",
      currency: "eur",
    });
  });

  it("erreur DB → rows vide + message", async () => {
    const res = await fetchAdminDisputesList(makeAdmin({ data: null, error: { message: "boom" } }));
    expect(res.rows).toEqual([]);
    expect(res.error).toBe("boom");
  });
});

describe("fetchStripeDisputeLive", () => {
  it("mappe dueBy (unix→ISO), submissionCount, submittable + evidence", async () => {
    retrieveMock.mockResolvedValue({
      status: "needs_response",
      evidence_details: { due_by: 1780000000, submission_count: 0, has_evidence: false },
      evidence: { product_description: "Panier bio", uncategorized_text: "" },
    });
    const live = await fetchStripeDisputeLive("dp_1");
    expect(live).not.toBeNull();
    expect(live!.submittable).toBe(true); // needs_response
    expect(live!.submissionCount).toBe(0);
    expect(live!.dueBy).toBe(new Date(1780000000 * 1000).toISOString());
    expect(live!.evidence.product_description).toBe("Panier bio");
    expect(live!.evidence.customer_name).toBe(""); // absent → ""
  });

  it("statut terminal (won) → submittable false", async () => {
    retrieveMock.mockResolvedValue({
      status: "won",
      evidence_details: { due_by: null, submission_count: 1, has_evidence: true },
      evidence: {},
    });
    const live = await fetchStripeDisputeLive("dp_1");
    expect(live!.submittable).toBe(false);
  });

  it("réponse inexploitable → null (fail-safe via try/catch)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Réponse null → l'accès d.evidence_details throw dans le try → catch →
    // null. Exerce le même chemin fail-safe qu'une erreur API, sans créer de
    // promesse rejetée que vitest signalerait comme unhandled.
    retrieveMock.mockResolvedValue(null);
    expect(await fetchStripeDisputeLive("dp_1")).toBeNull();
  });
});
