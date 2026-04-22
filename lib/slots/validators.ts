import { z } from "zod";

// Schema zod pour slot_rules (Phase 4 créneaux). Miroir exact des contraintes
// CHECK posées par la migration 20260422300000_slot_rules_and_materialized_slots
// + validations logiques supplémentaires (end > start, durée ≤ amplitude).
//
// Utilisé côté server actions (createSlotRuleAction / updateSlotRuleAction).

const HMM_RE = /^\d{2}:\d{2}$/;

function timeToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map((x) => parseInt(x, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

export const slotRuleSchema = z
  .object({
    days_of_week: z
      .array(z.coerce.number().int().min(0).max(6))
      .min(1, "Sélectionnez au moins un jour")
      .max(7),
    periodicity_weeks: z.coerce
      .number()
      .int()
      .min(1, "Périodicité minimale : 1 semaine")
      .max(4, "Périodicité maximale : 4 semaines"),
    start_time: z
      .string()
      .regex(HMM_RE, "Format HH:MM requis pour l'heure de début"),
    end_time: z
      .string()
      .regex(HMM_RE, "Format HH:MM requis pour l'heure de fin"),
    slot_duration_minutes: z.coerce
      .number()
      .int()
      .min(5, "Durée minimale : 5 minutes"),
    capacity_per_slot: z.coerce
      .number()
      .int()
      .min(1, "Capacité minimale : 1 client"),
  })
  .refine((d) => timeToMinutes(d.end_time) > timeToMinutes(d.start_time), {
    message: "L'heure de fin doit être après l'heure de début",
    path: ["end_time"],
  })
  .refine(
    (d) =>
      d.slot_duration_minutes <=
      timeToMinutes(d.end_time) - timeToMinutes(d.start_time),
    {
      message:
        "La durée d'un créneau ne peut pas dépasser l'amplitude horaire",
      path: ["slot_duration_minutes"],
    },
  );

export type SlotRuleInput = z.infer<typeof slotRuleSchema>;

// Shape d'une rule telle que stockée en DB + exposée à l'UI.
export interface SlotRuleRow {
  id: string;
  producer_id: string;
  days_of_week: number[];
  periodicity_weeks: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  capacity_per_slot: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}
