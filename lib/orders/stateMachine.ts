// =============================================================================
// State machine des commandes TerrOir
// =============================================================================
// Source de vérité des transitions autorisées. Tout changement de statut
// doit passer par canTransition/assertTransition pour éviter les écarts
// entre routes.
// =============================================================================

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "ready"
  | "completed"
  | "cancelled"
  | "refunded";

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["confirmed", "cancelled", "refunded"],
  confirmed: ["ready", "cancelled", "refunded"],
  ready: ["completed", "cancelled", "refunded"],
  completed: [],
  cancelled: [],
  refunded: [],
};

/**
 * Validateur de transition. Tolère un `from` hors `OrderStatus` (retour
 * `false` via le `?.`) car cette fonction est consommée sur des paires
 * potentiellement issues d'inputs dynamiques (ex. `finalStatus` calculé
 * dans `app/api/orders/[id]/cancel/route.tsx`).
 *
 * Asymétrie volontaire avec `isTerminal` : voir JSDoc de `isTerminal`
 * pour la justification du contrat différent (validator d'inputs vs
 * inspection d'état contraint).
 */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidOrderTransitionError extends Error {
  constructor(
    public readonly from: OrderStatus,
    public readonly to: OrderStatus,
  ) {
    super(`Transition commande invalide: ${from} → ${to}`);
    this.name = "InvalidOrderTransitionError";
  }
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidOrderTransitionError(from, to);
  }
}

/**
 * Inspection d'un état déjà contraint en amont. Le `status` doit être
 * un `OrderStatus` valide — invariant garanti par la CHECK constraint
 * SQL `orders.statut IN (...)` (cf migration `20260419000000`) miroir
 * exact de l'union TS `OrderStatus`. Le seul call site
 * (`app/api/orders/[id]/cancel/route.tsx:50`) lit `order.statut` depuis
 * cette colonne contrainte.
 *
 * Asymétrie volontaire vs `canTransition` : pas de `?.` défensif. Un
 * statut hors enum atteignant cette fonction = invariant DB↔TS violé
 * (drop CHECK, ajout statut DB sans update TS, lecture autre colonne).
 * On crash plutôt que d'absorber silencieusement : `false` autoriserait
 * un UPDATE sur état corrompu, `true` masquerait une vraie demande
 * d'annulation. Fail-fast aligné avec la philosophie projet.
 */
export function isTerminal(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
