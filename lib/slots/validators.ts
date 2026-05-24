import { z } from "zod";

// Schema zod pour slot_rules (créneaux). Miroir des contraintes CHECK de la
// migration 20260422300000 + 20260524140000 (colonne mode) + validations
// logiques (end > start, durée cohérente selon le mode).
//
// Deux modes (ADR-0012) :
//   'libre' = un seul créneau couvrant toute la plage ; slot_duration_minutes
//             est dérivée côté serveur (= amplitude) et n'est PAS saisie.
//   'rdv'   = découpage en tranches ; slot_duration_minutes requise (5..amplitude).
//
// Utilisé côté server actions (createSlotRuleAction / updateSlotRuleAction).

const HMM_RE = /^\d{2}:\d{2}$/;

export function timeToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map((x) => parseInt(x, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

export const SLOT_MODES = ["libre", "rdv"] as const;
export type SlotMode = (typeof SLOT_MODES)[number];

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
      .max(4, "Périodicité maximale : 4 semaines")
      .default(1),
    start_time: z
      .string()
      .regex(HMM_RE, "Format HH:MM requis pour l'heure de début"),
    end_time: z
      .string()
      .regex(HMM_RE, "Format HH:MM requis pour l'heure de fin"),
    mode: z.enum(SLOT_MODES).default("rdv"),
    // En mode 'rdv' : durée d'une tranche. En mode 'libre' : absente (dérivée
    // serveur = amplitude). Optionnelle au niveau du schema, validée par le
    // refine ci-dessous quand mode === 'rdv'.
    slot_duration_minutes: z.coerce.number().int().optional(),
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
    (d) => {
      if (d.mode !== "rdv") return true;
      if (d.slot_duration_minutes == null) return false;
      const amplitude = timeToMinutes(d.end_time) - timeToMinutes(d.start_time);
      return d.slot_duration_minutes >= 5 && d.slot_duration_minutes <= amplitude;
    },
    {
      message:
        "En mode rendez-vous, la durée doit être comprise entre 5 minutes et l'amplitude horaire",
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
  mode: SlotMode;
  active: boolean;
  created_at: string;
  updated_at: string;
}
