// Icône fallback générique — réutilise le panier en osier d'AutresIcon
// (décision 2026-05-17 : le fallback "catégorie inconnue" est
// visuellement identique à la catégorie "autres"). Re-export plutôt que
// duplication = une seule source de vérité pour le dessin du panier.
//
// Si le fallback doit un jour diverger sémantiquement du panier (ex :
// point d'interrogation pour signaler explicitement l'inconnu),
// remplacer ce re-export par un composant SVG dédié.

export { AutresIcon as FallbackIcon } from "./autres";
