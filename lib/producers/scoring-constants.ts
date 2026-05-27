// Constantes centralisées du système de scoring producteur (badges).
// Source de vérité unique pour les seuils + ensembles utilisés par
// `recompute-badges`, `/api/orders/[id]/confirm`, `/api/orders/[id]/cancel`,
// `lib/producers/health`.
//
// Ne pas inliner ces valeurs dans le code applicatif — importer cette
// constante. Cf. audit scoring 2026-05-28 : un seuil 2h inlining laissé
// dans 3 fichiers a produit un wording dashboard désaligné ("24 h" affiché
// vs 2h réel) que personne n'a vu.

/**
 * Délai max pour qu'une confirmation soit considérée "rapide" et compte
 * positivement dans `badge_confirmation_score`. Aligné sur le timeout
 * d'annulation auto du cron `order-timeout` (qui annule les commandes
 * `pending` depuis +24h). Au-delà, la commande est cancellée par le cron
 * et entre dans le badge fiabilité comme annulation imputable (cf.
 * BLAMING_CLOSURE_REASONS).
 */
export const CONFIRMATION_THRESHOLD_HOURS = 24;
export const CONFIRMATION_THRESHOLD_MS =
  CONFIRMATION_THRESHOLD_HOURS * 60 * 60 * 1000;

/**
 * Closure reasons considérées "imputables" au producteur pour le calcul
 * de `badge_annulation_score`. Une commande terminée pour l'une de ces
 * raisons pénalise le badge ; les autres (consumer_cancel, timeout,
 * payment_failed, revival_blocked_*, other) sont externes au producteur
 * et n'affectent pas son score.
 *
 *   - producer_cancel : annulation explicite par le producteur.
 *   - stock           : rupture de stock. Considéré imputable car relève
 *                       de la gestion stock côté producteur ; et exclure
 *                       cette catégorie créerait un loophole (annuler en
 *                       cliquant "rupture de stock" pour préserver son
 *                       score). Aligné avec l'alerte admin existante au
 *                       2e stock-cancel du mois (cf. cancel/route.tsx).
 */
export const BLAMING_CLOSURE_REASONS = ["producer_cancel", "stock"] as const;
export type BlamingClosureReason = (typeof BLAMING_CLOSURE_REASONS)[number];

/** Fenêtre glissante de calcul des badges, en mois. */
export const BADGE_WINDOW_MONTHS = 12;
