// Constantes partagées du domaine produits.
//
// Source de vérité pour les sentinelles applicatives utilisées côté UI.
// La DB stocke `stock_illimite: boolean` distinct de `stock_disponible:
// integer` ; cette sentinelle ne franchit jamais la frontière côté DB.

/**
 * Sentinelle "stock illimité" projetée vers les composants UI qui n'acceptent
 * qu'un `stockLeft: number` (ProductCard, ProductPageClient stepper, etc.).
 *
 * Pourquoi 999 et pas Number.MAX_SAFE_INTEGER ? Les composants utilisent
 * `stockLeft` à la fois pour la disponibilité (>0) et pour le seuil low
 * stock (≤5). 999 échappe trivialement aux deux seuils sans casser l'UI
 * (ex: pas d'affichage "stock: 9007199254740991" si un composant régresse
 * et oublie de tester `unlimited`).
 *
 * Refacto possible (backlog) : faire évoluer la signature des composants
 * vers `stockLeft: number | 'unlimited'` pour supprimer la sentinelle.
 */
export const STOCK_UNLIMITED_SENTINEL = 999 as const;
