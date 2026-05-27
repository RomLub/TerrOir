import { describe, it, expect } from "vitest";
import {
  computeBadgeDetails,
  EMPTY_BADGE_COMPUTATION,
  formatBadgeDetailLine,
  type ScoringOrder,
} from "@/lib/producers/compute-badge-details";

// Helpers de construction d'orders factices.
function order(over: Partial<ScoringOrder> = {}): ScoringOrder {
  return {
    statut: "completed",
    created_at: "2026-04-01T10:00:00Z",
    confirmed_at: "2026-04-01T10:30:00Z",
    closure_reason: null,
    ...over,
  };
}

describe("computeBadgeDetails — cas no_orders", () => {
  it("tableau vide → EMPTY_BADGE_COMPUTATION (scores 100, détails à 0)", () => {
    expect(computeBadgeDetails([])).toEqual(EMPTY_BADGE_COMPUTATION);
    expect(EMPTY_BADGE_COMPUTATION.scores).toEqual({
      badge_stock_score: 100,
      badge_confirmation_score: 100,
      badge_annulation_score: 100,
    });
    expect(EMPTY_BADGE_COMPUTATION.details.totalOrders).toBe(0);
  });
});

describe("computeBadgeDetails — détails chiffrés", () => {
  it("mix riche : tous les compteurs corrects", () => {
    const orders = [
      // 3 completed dont 2 fast (≤ 24h)
      order({ confirmed_at: "2026-04-01T10:30:00Z" }), // 30 min → fast
      order({
        created_at: "2026-04-02T10:00:00Z",
        confirmed_at: "2026-04-03T08:00:00Z", // +22h → fast
      }),
      order({
        created_at: "2026-04-03T10:00:00Z",
        confirmed_at: "2026-04-04T11:00:00Z", // +25h → slow
      }),
      // 1 producer_cancel (blaming)
      order({ statut: "cancelled", confirmed_at: null, closure_reason: "producer_cancel" }),
      // 1 stock (blaming + stockCancellations)
      order({ statut: "cancelled", confirmed_at: null, closure_reason: "stock" }),
      // 1 consumer_cancel (externe → ni blaming ni stock)
      order({ statut: "cancelled", confirmed_at: null, closure_reason: "consumer_cancel" }),
      // 1 timeout (externe)
      order({ statut: "refunded", confirmed_at: null, closure_reason: "timeout" }),
    ];
    const res = computeBadgeDetails(orders);
    expect(res.details).toEqual({
      totalOrders: 7,
      totalConfirmed: 3,
      fastConfirmed: 2,
      blamingCancellations: 2, // producer_cancel + stock
      stockCancellations: 1,
    });
    // Scores correspondants :
    // stock = (7-1)/7 = 85.71
    // confirmation = 2/3 = 66.67
    // annulation = (7-2)/7 = 71.43
    expect(res.scores).toEqual({
      badge_stock_score: 85.71,
      badge_confirmation_score: 66.67,
      badge_annulation_score: 71.43,
    });
  });

  it("ignore les commandes annulées dont closure_reason est externe au producteur", () => {
    const orders: ScoringOrder[] = [
      { statut: "cancelled", created_at: null, confirmed_at: null, closure_reason: "consumer_cancel" },
      { statut: "cancelled", created_at: null, confirmed_at: null, closure_reason: "timeout" },
      { statut: "refunded", created_at: null, confirmed_at: null, closure_reason: "payment_failed" },
      { statut: "cancelled", created_at: null, confirmed_at: null, closure_reason: "other" },
      { statut: "completed", created_at: null, confirmed_at: null, closure_reason: null },
    ];
    const res = computeBadgeDetails(orders);
    expect(res.details.blamingCancellations).toBe(0);
    expect(res.scores.badge_annulation_score).toBe(100); // (5-0)/5
  });

  it("seuil 24h inclusif : commande confirmée à 24h pile compte comme fast", () => {
    const orders = [
      order({
        created_at: "2026-04-01T10:00:00Z",
        confirmed_at: "2026-04-02T10:00:00Z", // +24h pile
      }),
    ];
    expect(computeBadgeDetails(orders).details.fastConfirmed).toBe(1);
  });

  it("aucune confirmation : score réactivité retombe à 0 (comportement historique préservé)", () => {
    const orders = [order({ confirmed_at: null, statut: "pending" })];
    const res = computeBadgeDetails(orders);
    expect(res.details.totalConfirmed).toBe(0);
    expect(res.scores.badge_confirmation_score).toBe(0);
  });
});

describe("formatBadgeDetailLine", () => {
  it("totalOrders === 0 → message neutre", () => {
    expect(formatBadgeDetailLine("response", EMPTY_BADGE_COMPUTATION.details)).toBe(
      "Pas encore assez de données",
    );
    expect(formatBadgeDetailLine("reliability", EMPTY_BADGE_COMPUTATION.details)).toBe(
      "Pas encore assez de données",
    );
    expect(formatBadgeDetailLine("stock", EMPTY_BADGE_COMPUTATION.details)).toBe(
      "Pas encore assez de données",
    );
  });

  it("response avec confirmations : 'X/Y confirmées en ≤ 24 h (12 derniers mois)'", () => {
    expect(
      formatBadgeDetailLine("response", {
        totalOrders: 14,
        totalConfirmed: 14,
        fastConfirmed: 12,
        blamingCancellations: 0,
        stockCancellations: 0,
      }),
    ).toBe("12/14 confirmées en ≤ 24 h (12 derniers mois)");
  });

  it("response sans confirmation : message neutre dédié", () => {
    expect(
      formatBadgeDetailLine("response", {
        totalOrders: 3,
        totalConfirmed: 0,
        fastConfirmed: 0,
        blamingCancellations: 0,
        stockCancellations: 0,
      }),
    ).toBe("Aucune commande confirmée sur la période");
  });

  it("reliability au singulier : '1 annulation de votre côté sur Y commandes'", () => {
    expect(
      formatBadgeDetailLine("reliability", {
        totalOrders: 10,
        totalConfirmed: 9,
        fastConfirmed: 9,
        blamingCancellations: 1,
        stockCancellations: 0,
      }),
    ).toBe("1 annulation de votre côté sur 10 commandes (12 derniers mois)");
  });

  it("reliability au pluriel : '3 annulations'", () => {
    expect(
      formatBadgeDetailLine("reliability", {
        totalOrders: 10,
        totalConfirmed: 7,
        fastConfirmed: 7,
        blamingCancellations: 3,
        stockCancellations: 1,
      }),
    ).toBe("3 annulations de votre côté sur 10 commandes (12 derniers mois)");
  });

  it("reliability avec 0 annulation imputable : '0 annulation' (singulier)", () => {
    expect(
      formatBadgeDetailLine("reliability", {
        totalOrders: 10,
        totalConfirmed: 10,
        fastConfirmed: 10,
        blamingCancellations: 0,
        stockCancellations: 0,
      }),
    ).toBe("0 annulation de votre côté sur 10 commandes (12 derniers mois)");
  });

  it("stock : 'X rupture(s) de stock sur Y commandes'", () => {
    expect(
      formatBadgeDetailLine("stock", {
        totalOrders: 20,
        totalConfirmed: 18,
        fastConfirmed: 17,
        blamingCancellations: 2,
        stockCancellations: 2,
      }),
    ).toBe("2 ruptures de stock sur 20 commandes (12 derniers mois)");
  });
});
