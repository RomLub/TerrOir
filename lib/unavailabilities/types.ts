// Chantier indisponibilités producteur (2026-05-28) — types partagés entre
// les helpers backend (lib/unavailabilities/*), les server actions
// (app/(producer)/creneaux/actions.ts) et l'UI calendaire (PR #2).
//
// Source de vérité de la décision produit : docs/decisions/0009-unavailabilities-option-b.md.

/**
 * Détail d'une commande active qui empêche la pose d'une indisponibilité
 * (ou la suppression d'un slot fermé). Réutilise le pattern de
 * `app/(producer)/creneaux/actions.ts:BlockingOrder` (PR #198 « Annuler et
 * fermer ») en ajoutant `date_key` pour grouper l'affichage par jour côté
 * UI calendaire.
 */
export type BlockingOrderForUnavail = {
  id: string;
  numero_commande: string;
  consumer_prenom: string | null;
  montant_total: number;
  slot_starts_at: string;
  slot_ends_at: string;
  /** YYYY-MM-DD Europe/Paris du slot bloquant. */
  date_key: string;
};

/** Résultat de `createUnavailabilities`. */
export type CreateUnavailabilitiesResult =
  | { success: true; created_count: number }
  | {
      error: string;
      code: 'BLOCKING_ORDERS' | 'INVALID_INPUT' | 'INTERNAL';
      blocking_orders?: BlockingOrderForUnavail[];
    };

/** Résultat de `deleteUnavailability`. */
export type DeleteUnavailabilityResult =
  | { success: true; regenerated_slots: number }
  | { error: string; code: 'NOT_FOUND' | 'INVALID_INPUT' | 'INTERNAL' };

/** Input validé de `createUnavailabilities`. */
export type CreateUnavailabilitiesInput = {
  producerId: string;
  /** Dates YYYY-MM-DD Europe/Paris. Doivent être >= today Paris. */
  dates: string[];
  /** Optionnelle, owner-only — max 280 chars. */
  raison: string | null;
  /** Auteur de la pose (pour audit). */
  createdBy: string;
};

/** Input validé de `deleteUnavailability`. */
export type DeleteUnavailabilityInput = {
  producerId: string;
  unavailabilityId: string;
};
