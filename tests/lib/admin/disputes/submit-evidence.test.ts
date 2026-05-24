import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Tests submitDisputeEvidence (chantier 8) : gardes (statut respondable,
// soumission non vide), appel Stripe, MAJ optimiste du statut, audit.

const { stripeUpdate, auditMock } = vi.hoisted(() => ({
  stripeUpdate: vi.fn(async () => ({})),
  auditMock: vi.fn(async () => undefined),
}));

vi.mock("@/lib/stripe/server", () => ({
  stripe: { disputes: { update: stripeUpdate } },
}));
vi.mock("@/lib/audit-logs/log-payment-event", () => ({
  logPaymentEvent: auditMock,
}));

import { submitDisputeEvidence } from "@/lib/admin/disputes/submit-evidence";
import { EMPTY_EVIDENCE } from "@/lib/admin/disputes/types";

function makeAdmin(disputeRow: unknown): {
  admin: SupabaseClient;
  updates: unknown[];
} {
  const updates: unknown[] = [];
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.maybeSingle = () => Promise.resolve({ data: disputeRow, error: null });
  builder.update = (vals: unknown) => {
    updates.push(vals);
    return { eq: () => Promise.resolve({ error: null }) };
  };
  return { admin: { from: () => builder } as unknown as SupabaseClient, updates };
}

const ACTOR = "actor-1";
const EVIDENCE_WITH = { ...EMPTY_EVIDENCE, uncategorized_text: "Retrait validé le 20/05 (code OK)." };

beforeEach(() => {
  stripeUpdate.mockClear();
  stripeUpdate.mockResolvedValue({});
  auditMock.mockClear();
});

describe("submitDisputeEvidence", () => {
  it("litige introuvable → erreur", async () => {
    const { admin } = makeAdmin(null);
    const res = await submitDisputeEvidence(admin, ACTOR, "d1", EVIDENCE_WITH, false);
    expect(res.ok).toBe(false);
    expect(stripeUpdate).not.toHaveBeenCalled();
  });

  it("statut non respondable (under_review) → refus", async () => {
    const { admin } = makeAdmin({ stripe_dispute_id: "dp_1", status: "under_review", order_id: "o1" });
    const res = await submitDisputeEvidence(admin, ACTOR, "d1", EVIDENCE_WITH, false);
    expect(res).toEqual({ ok: false, error: expect.stringContaining("n'accepte plus") });
    expect(stripeUpdate).not.toHaveBeenCalled();
  });

  it("submit=true sans aucune preuve → refus", async () => {
    const { admin } = makeAdmin({ stripe_dispute_id: "dp_1", status: "needs_response", order_id: "o1" });
    const res = await submitDisputeEvidence(admin, ACTOR, "d1", { ...EMPTY_EVIDENCE }, true);
    expect(res.ok).toBe(false);
    expect(stripeUpdate).not.toHaveBeenCalled();
  });

  it("brouillon (submit=false) → stripe update submit:false + audit saved, pas de MAJ statut", async () => {
    const { admin, updates } = makeAdmin({
      stripe_dispute_id: "dp_1", status: "needs_response", order_id: "o1",
    });
    const res = await submitDisputeEvidence(admin, ACTOR, "d1", EVIDENCE_WITH, false);
    expect(res).toEqual({ ok: true });
    expect(stripeUpdate).toHaveBeenCalledWith("dp_1", expect.objectContaining({ submit: false }));
    expect(updates).toHaveLength(0); // pas de MAJ optimiste du statut
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "stripe_dispute_evidence_saved", userId: ACTOR }),
    );
  });

  it("soumission (submit=true) → stripe submit:true + MAJ statut under_review + audit submitted", async () => {
    const { admin, updates } = makeAdmin({
      stripe_dispute_id: "dp_1", status: "needs_response", order_id: "o1",
    });
    const res = await submitDisputeEvidence(admin, ACTOR, "d1", EVIDENCE_WITH, true);
    expect(res).toEqual({ ok: true });
    expect(stripeUpdate).toHaveBeenCalledWith("dp_1", expect.objectContaining({ submit: true }));
    expect(updates).toEqual([expect.objectContaining({ status: "under_review" })]);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "stripe_dispute_evidence_submitted" }),
    );
  });

  it("warning_needs_response + submit → statut optimiste warning_under_review", async () => {
    const { admin, updates } = makeAdmin({
      stripe_dispute_id: "dp_1", status: "warning_needs_response", order_id: "o1",
    });
    await submitDisputeEvidence(admin, ACTOR, "d1", EVIDENCE_WITH, true);
    expect(updates).toEqual([expect.objectContaining({ status: "warning_under_review" })]);
  });

  it("échec Stripe → erreur, pas d'audit succès", async () => {
    stripeUpdate.mockRejectedValueOnce(new Error("Stripe down"));
    const { admin } = makeAdmin({ stripe_dispute_id: "dp_1", status: "needs_response", order_id: "o1" });
    const res = await submitDisputeEvidence(admin, ACTOR, "d1", EVIDENCE_WITH, true);
    expect(res.ok).toBe(false);
    expect(auditMock).not.toHaveBeenCalled();
  });
});
