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
  | "completed"
  | "cancelled"
  | "refunded";

// Modèle métier réel = 3 états actifs (pending → confirmed → completed).
// La transition canonique du pickup est `confirmed → completed` : producer
// reçoit, valide, prépare, le consumer arrive avec le code, producer saisit
// le code → completed direct.
//
// Cluster C — T6 cleanup (migration `20260507B00000_cluster_c_drop_ready_status`) :
// l'état `ready` était mort (aucune route ne le settait en prod) et a été
// retiré du CHECK orders.statut + de l'union TS + des transitions ici. Tout
// code TS référençant 'ready' doit être considéré legacy et retiré.
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["confirmed", "cancelled", "refunded"],
  confirmed: ["completed", "cancelled", "refunded"],
  completed: [],
  cancelled: [],
  refunded: [],
};

/**
 * Statuts "actifs" d'une commande = tous ceux qui occupent un slot et sont
 * comptabilisés en cours de cycle de vie (avant terminal). Source de vérité
 * unique pour les call sites qui filtraient historiquement
 * `["pending","confirmed","ready"]` inline.
 *
 * Cluster C — T6 cleanup : la liste passe de 3 à 2 valeurs (ready retiré).
 * Ne pas remplacer par un literal inline ailleurs — importer cette constante.
 */
export const ACTIVE_ORDER_STATUTS = ["pending", "confirmed"] as const;
export type ActiveOrderStatut = (typeof ACTIVE_ORDER_STATUTS)[number];

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

/**
 * T-420 : helper pure pour la fenêtre d'annulation consumer.
 *
 * Source de vérité : route /api/orders/[id]/cancel/route.tsx encode la
 * règle "consumer ne peut cancel que pending" (pas d'engagement
 * producteur encore = annulation sans préjudice).
 *
 * Helper exporté pour permettre future UI consumer d'afficher/cacher
 * un bouton cohérent avec server.
 */
export function canConsumerCancel(status: OrderStatus): boolean {
  return status === "pending";
}

/**
 * T-420 : helper pure pour la fenêtre d'annulation producer.
 *
 * Source de vérité : route /api/orders/[id]/cancel/route.tsx encode la
 * règle "producer owner peut cancel toute order non-terminal" (= pending,
 * confirmed). Couvre les cas légitimes :
 *   - pending   : annulation pré-confirmation
 *   - confirmed : annulation pré/post-préparation (changement d'avis,
 *     perte produit, panne, accident)
 *
 * Helper exporté pour aligner Producer UI avec server.
 */
export function canProducerCancel(status: OrderStatus): boolean {
  return !isTerminal(status);
}
