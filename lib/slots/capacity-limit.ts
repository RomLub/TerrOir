// Plafond de capacité des créneaux producteur — règle produit unique :
// max 2 places par tranche de 15 minutes. Soit 8 places par heure, 24
// places sur une plage de 3h. Décision Romain 2026-05-28 (point de
// départ, sera réajusté avec données terrain).
//
// La formule unique `ceil(durée_min / 15) * 2` couvre uniformément :
//   - mode 'rdv' (durée = slot_duration_minutes : 15 / 30 / 60)
//   - mode 'libre' (durée = amplitude end_time - start_time, ou
//     ends_at - starts_at pour un slot ad-hoc)
//
// Cette source TS est le miroir applicatif du CHECK SQL posé sur
// slot_rules + slots (migration capacity_limit). Toute évolution doit
// rester synchronisée des deux côtés.

export const CAPACITY_PER_QUARTER_HOUR = 2;
export const QUARTER_HOUR_MINUTES = 15;

/**
 * Capacité maximale autorisée pour un créneau de la durée donnée.
 * Lance si durationMinutes <= 0 (cas d'usage indéfini côté produit).
 */
export function maxCapacityForDuration(durationMinutes: number): number {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new Error(
      `maxCapacityForDuration: durationMinutes doit être > 0 (reçu ${durationMinutes})`,
    );
  }
  return Math.ceil(durationMinutes / QUARTER_HOUR_MINUTES) * CAPACITY_PER_QUARTER_HOUR;
}

/**
 * Vérifie qu'une capacité respecte la borne [1, maxCapacityForDuration].
 * Sans throw — usage validation Zod / UI / pré-INSERT.
 */
export function isCapacityValid(
  durationMinutes: number,
  capacity: number,
): boolean {
  if (!Number.isFinite(capacity) || !Number.isInteger(capacity)) return false;
  if (capacity < 1) return false;
  return capacity <= maxCapacityForDuration(durationMinutes);
}

/**
 * Message d'erreur utilisateur quand une capacité dépasse la limite.
 * Forme actionnable : indique la limite + la règle sous-jacente.
 */
export function capacityErrorMessage(durationMinutes: number): string {
  const max = maxCapacityForDuration(durationMinutes);
  return `Maximum ${max} place${max > 1 ? 's' : ''} pour un créneau de ${durationMinutes} minutes (2 places par quart d'heure).`;
}
