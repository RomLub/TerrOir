import { describe, it, expect } from "vitest";
import {
  slotRuleSchema,
  adHocSlotSchema,
} from "@/lib/slots/validators";

// Garde-fou Zod du plafond capacité (max 2 places / 15 min). Doublure
// applicative du CHECK SQL. Tests ciblés sur la branche refine
// capacité — les autres règles (format, end>start, mode rdv durée
// requise) sont déjà couvertes ailleurs.

const baseRule = {
  days_of_week: [1],
  periodicity_weeks: 1,
  start_time: "09:00",
  end_time: "12:00",
  mode: "rdv" as const,
  slot_duration_minutes: 30,
};

const baseAdHoc = {
  start_at: "2026-06-03T09:00",
  end_at: "2026-06-03T12:00",
  mode: "libre" as const,
};

describe("slotRuleSchema — refine capacité", () => {
  it("mode rdv 30min cap=4 (max autorisé) → accepté", () => {
    const r = slotRuleSchema.safeParse({ ...baseRule, capacity_per_slot: 4 });
    expect(r.success).toBe(true);
  });

  it("mode rdv 30min cap=10 (dépasse) → rejeté avec message explicite", () => {
    const r = slotRuleSchema.safeParse({ ...baseRule, capacity_per_slot: 10 });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) =>
        i.path.includes("capacity_per_slot"),
      );
      expect(issue?.message).toContain("Maximum 4");
      expect(issue?.message).toContain("30 minutes");
    }
  });

  it("mode rdv 15min cap=2 → accepté ; cap=3 → rejeté", () => {
    const r1 = slotRuleSchema.safeParse({
      ...baseRule,
      slot_duration_minutes: 15,
      capacity_per_slot: 2,
    });
    expect(r1.success).toBe(true);
    const r2 = slotRuleSchema.safeParse({
      ...baseRule,
      slot_duration_minutes: 15,
      capacity_per_slot: 3,
    });
    expect(r2.success).toBe(false);
  });

  it("mode rdv 60min cap=8 → accepté ; cap=9 → rejeté", () => {
    const r1 = slotRuleSchema.safeParse({
      ...baseRule,
      slot_duration_minutes: 60,
      capacity_per_slot: 8,
    });
    expect(r1.success).toBe(true);
    const r2 = slotRuleSchema.safeParse({
      ...baseRule,
      slot_duration_minutes: 60,
      capacity_per_slot: 9,
    });
    expect(r2.success).toBe(false);
  });

  it("mode libre 09h-12h (3h) cap=24 → accepté ; cap=25 → rejeté", () => {
    const r1 = slotRuleSchema.safeParse({
      ...baseRule,
      mode: "libre",
      slot_duration_minutes: undefined,
      capacity_per_slot: 24,
    });
    expect(r1.success).toBe(true);
    const r2 = slotRuleSchema.safeParse({
      ...baseRule,
      mode: "libre",
      slot_duration_minutes: undefined,
      capacity_per_slot: 25,
    });
    expect(r2.success).toBe(false);
  });
});

describe("adHocSlotSchema — refine capacité", () => {
  it("ad-hoc libre 3h cap=24 → accepté ; cap=25 → rejeté", () => {
    const r1 = adHocSlotSchema.safeParse({
      ...baseAdHoc,
      capacity_per_slot: 24,
    });
    expect(r1.success).toBe(true);
    const r2 = adHocSlotSchema.safeParse({
      ...baseAdHoc,
      capacity_per_slot: 25,
    });
    expect(r2.success).toBe(false);
  });

  it("ad-hoc libre 1h cap=15 (cas réel La Ferme des Fourchettes, max=8) → rejeté", () => {
    const r = adHocSlotSchema.safeParse({
      start_at: "2026-06-03T09:00",
      end_at: "2026-06-03T10:00",
      mode: "libre",
      capacity_per_slot: 15,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) =>
        i.path.includes("capacity_per_slot"),
      );
      expect(issue?.message).toContain("Maximum 8");
    }
  });

  it("ad-hoc rdv 30min cap=4 → accepté ; cap=5 → rejeté (cap appliquée par tranche)", () => {
    const baseRdv = {
      start_at: "2026-06-03T09:00",
      end_at: "2026-06-03T11:00",
      mode: "rdv" as const,
      slot_duration_minutes: 30,
    };
    const r1 = adHocSlotSchema.safeParse({
      ...baseRdv,
      capacity_per_slot: 4,
    });
    expect(r1.success).toBe(true);
    const r2 = adHocSlotSchema.safeParse({
      ...baseRdv,
      capacity_per_slot: 5,
    });
    expect(r2.success).toBe(false);
  });

  it("ad-hoc libre 15min cap=2 → accepté ; cap=3 → rejeté", () => {
    const base = {
      start_at: "2026-06-03T09:00",
      end_at: "2026-06-03T09:15",
      mode: "libre" as const,
    };
    const r1 = adHocSlotSchema.safeParse({ ...base, capacity_per_slot: 2 });
    expect(r1.success).toBe(true);
    const r2 = adHocSlotSchema.safeParse({ ...base, capacity_per_slot: 3 });
    expect(r2.success).toBe(false);
  });
});
