// Sanity test des constantes scoring producteur. La présence de ce fichier
// fait office de garde anti-régression : si Romain ou un autre dev change
// la valeur du seuil sans intention, ce test rouge le signale.

import { describe, it, expect } from "vitest";
import {
  BADGE_WINDOW_MONTHS,
  BLAMING_CLOSURE_REASONS,
  CONFIRMATION_THRESHOLD_HOURS,
  CONFIRMATION_THRESHOLD_MS,
} from "@/lib/producers/scoring-constants";

describe("scoring-constants", () => {
  it("CONFIRMATION_THRESHOLD_HOURS = 24 (aligné cron order-timeout)", () => {
    expect(CONFIRMATION_THRESHOLD_HOURS).toBe(24);
  });

  it("CONFIRMATION_THRESHOLD_MS = 24 * 60 * 60 * 1000", () => {
    expect(CONFIRMATION_THRESHOLD_MS).toBe(24 * 60 * 60 * 1000);
    expect(CONFIRMATION_THRESHOLD_MS).toBe(86_400_000);
  });

  it("BLAMING_CLOSURE_REASONS = ['producer_cancel', 'stock'] strictement", () => {
    // L'ordre n'est pas significatif sémantiquement, mais on fige pour
    // éviter qu'une variante (ex. ajout silencieux de 'other') passe.
    expect([...BLAMING_CLOSURE_REASONS]).toEqual(["producer_cancel", "stock"]);
  });

  it("BLAMING_CLOSURE_REASONS exclut les causes externes au producteur", () => {
    const external = [
      "consumer_cancel",
      "timeout",
      "payment_failed",
      "revival_blocked_slot",
      "revival_blocked_stock",
      "other",
    ];
    for (const reason of external) {
      expect(
        (BLAMING_CLOSURE_REASONS as readonly string[]).includes(reason),
      ).toBe(false);
    }
  });

  it("BADGE_WINDOW_MONTHS = 12", () => {
    expect(BADGE_WINDOW_MONTHS).toBe(12);
  });
});
