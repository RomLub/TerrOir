import { describe, it, expect } from "vitest";
import { computeHealth } from "@/lib/producers/health";

function base() {
  return { stock: 95, response: 90, reliability: 98, rating: 4.7, reviewCount: 12 };
}

const m = (h: ReturnType<typeof computeHealth>, key: string) =>
  h.metrics.find((x) => x.key === key)!;

describe("computeHealth", () => {
  it("tout au vert → bandes good + overall good", () => {
    const h = computeHealth(base());
    expect(m(h, "stock").band).toBe("good");
    expect(m(h, "rating").band).toBe("good");
    expect(h.overallBand).toBe("good");
    expect(h.overall).toBe(Math.round((95 + 90 + 98) / 3));
  });

  it("seuils stock : 90 good, 89 warn, 69 bad", () => {
    expect(m(computeHealth({ ...base(), stock: 90 }), "stock").band).toBe("good");
    expect(m(computeHealth({ ...base(), stock: 89 }), "stock").band).toBe("warn");
    expect(m(computeHealth({ ...base(), stock: 69 }), "stock").band).toBe("bad");
  });

  it("réactivité seuil 85, fiabilité seuil 95", () => {
    expect(m(computeHealth({ ...base(), response: 84 }), "response").band).toBe("warn");
    expect(m(computeHealth({ ...base(), reliability: 94 }), "reliability").band).toBe("warn");
  });

  it("note : 4.5 good, 4.0 warn, 3.9 bad", () => {
    expect(m(computeHealth({ ...base(), rating: 4.5 }), "rating").band).toBe("good");
    expect(m(computeHealth({ ...base(), rating: 4.0 }), "rating").band).toBe("warn");
    expect(m(computeHealth({ ...base(), rating: 3.9 }), "rating").band).toBe("bad");
  });

  it("aucun avis → note neutre (—), bande warn", () => {
    const rating = m(computeHealth({ ...base(), reviewCount: 0 }), "rating");
    expect(rating.display).toBe("—");
    expect(rating.band).toBe("warn");
  });

  it("note formatée avec virgule française", () => {
    const rating = m(
      computeHealth({ ...base(), rating: 4.6, reviewCount: 5 }),
      "rating",
    );
    expect(rating.display).toBe("4,6 / 5");
  });

  it("badgeDetails fourni → chaque metric technique porte son `detail`", () => {
    const h = computeHealth({
      ...base(),
      badgeDetails: {
        totalOrders: 10,
        totalConfirmed: 9,
        fastConfirmed: 8,
        blamingCancellations: 1,
        stockCancellations: 1,
      },
    });
    expect(m(h, "stock").detail).toBe(
      "1 rupture de stock sur 10 commandes (12 derniers mois)",
    );
    expect(m(h, "response").detail).toBe(
      "8/9 confirmées en ≤ 24 h (12 derniers mois)",
    );
    expect(m(h, "reliability").detail).toBe(
      "1 annulation de votre côté sur 10 commandes (12 derniers mois)",
    );
    // rating n'a jamais de detail (champ neutre).
    expect(m(h, "rating").detail).toBeNull();
  });

  it("badgeDetails absent → `detail` à null sur tous les metrics (rétrocompat)", () => {
    const h = computeHealth(base());
    expect(m(h, "stock").detail).toBeNull();
    expect(m(h, "response").detail).toBeNull();
    expect(m(h, "reliability").detail).toBeNull();
    expect(m(h, "rating").detail).toBeNull();
  });

  it("tout au rouge → overall bad, chaque métrique a un conseil", () => {
    const h = computeHealth({
      stock: 50,
      response: 50,
      reliability: 50,
      rating: 2,
      reviewCount: 3,
    });
    for (const metric of h.metrics) expect(metric.tip.length).toBeGreaterThan(0);
    expect(h.overallBand).toBe("bad");
  });
});
