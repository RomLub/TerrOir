import { describe, it, expect } from "vitest";
import { slotRuleSchema } from "@/lib/slots/validators";

function base() {
  return {
    days_of_week: [1, 3, 5],
    periodicity_weeks: 1,
    start_time: "09:00",
    end_time: "12:00",
    slot_duration_minutes: 30,
    capacity_per_slot: 5,
  };
}

describe("slotRuleSchema", () => {
  it("payload valide → success", () => {
    const res = slotRuleSchema.safeParse(base());
    expect(res.success).toBe(true);
  });

  it("days_of_week vide → erreur", () => {
    const res = slotRuleSchema.safeParse({ ...base(), days_of_week: [] });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.path).toEqual(["days_of_week"]);
    }
  });

  it("days_of_week hors [0..6] → erreur", () => {
    const res = slotRuleSchema.safeParse({ ...base(), days_of_week: [7] });
    expect(res.success).toBe(false);
  });

  it("end_time <= start_time → erreur", () => {
    const res = slotRuleSchema.safeParse({
      ...base(),
      start_time: "12:00",
      end_time: "09:00",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.path).toEqual(["end_time"]);
    }
  });

  it("duration > amplitude → erreur", () => {
    const res = slotRuleSchema.safeParse({
      ...base(),
      start_time: "09:00",
      end_time: "09:30",
      slot_duration_minutes: 60,
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.path).toEqual(["slot_duration_minutes"]);
    }
  });

  it("format HH:MM invalide → erreur", () => {
    const res = slotRuleSchema.safeParse({ ...base(), start_time: "9:00" });
    expect(res.success).toBe(false);
  });

  it("periodicity_weeks hors [1..4] → erreur", () => {
    expect(
      slotRuleSchema.safeParse({ ...base(), periodicity_weeks: 0 }).success,
    ).toBe(false);
    expect(
      slotRuleSchema.safeParse({ ...base(), periodicity_weeks: 5 }).success,
    ).toBe(false);
  });

  it("slot_duration_minutes < 5 → erreur", () => {
    const res = slotRuleSchema.safeParse({
      ...base(),
      slot_duration_minutes: 1,
    });
    expect(res.success).toBe(false);
  });

  it("capacity_per_slot < 1 → erreur", () => {
    const res = slotRuleSchema.safeParse({ ...base(), capacity_per_slot: 0 });
    expect(res.success).toBe(false);
  });

  it("coerce string → number (formdata flow)", () => {
    const res = slotRuleSchema.safeParse({
      ...base(),
      periodicity_weeks: "2",
      slot_duration_minutes: "45",
      capacity_per_slot: "8",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.periodicity_weeks).toBe(2);
      expect(res.data.slot_duration_minutes).toBe(45);
      expect(res.data.capacity_per_slot).toBe(8);
    }
  });
});

describe("slotRuleSchema — modes libre / rdv (ADR-0012)", () => {
  it("mode par défaut = 'rdv'", () => {
    const res = slotRuleSchema.safeParse(base());
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.mode).toBe("rdv");
  });

  it("mode 'libre' sans durée → success (durée dérivée serveur)", () => {
    const res = slotRuleSchema.safeParse({
      ...base(),
      slot_duration_minutes: undefined,
      mode: "libre",
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.mode).toBe("libre");
  });

  it("mode 'rdv' sans durée → erreur sur slot_duration_minutes", () => {
    const res = slotRuleSchema.safeParse({
      ...base(),
      slot_duration_minutes: undefined,
      mode: "rdv",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(
        res.error.issues.some((i) => i.path[0] === "slot_duration_minutes"),
      ).toBe(true);
    }
  });

  it("mode inconnu → erreur", () => {
    const res = slotRuleSchema.safeParse({ ...base(), mode: "autre" });
    expect(res.success).toBe(false);
  });
});
