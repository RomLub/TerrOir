import {
  BADGE_WINDOW_MONTHS,
  BLAMING_CLOSURE_REASONS,
  CONFIRMATION_THRESHOLD_HOURS,
  CONFIRMATION_THRESHOLD_MS,
} from "@/lib/producers/scoring-constants";

// formatBadgeDetailLine plus bas dans le fichier consomme aussi
// CONFIRMATION_THRESHOLD_HOURS et BADGE_WINDOW_MONTHS pour les libellés
// "≤ 24 h" et "(12 derniers mois)" — un seul import en haut de fichier.

// Helper PUR (pas d'I/O) qui calcule les 3 scores badges + leurs détails
// chiffrés à partir d'une liste d'orders d'un producteur sur la fenêtre
// glissante 12 mois. Source de vérité unique réutilisée par :
//   - `lib/producers/recompute-badges` (cron weekly + live update :
//     persiste les scores en DB, ignore les détails).
//   - `app/(producer)/sante/page.tsx` (affiche scores + détails).
//   - `app/(producer)/dashboard/page.tsx` (idem).
//
// Pas de fetch DB ici. La page serveur fait son SELECT orders puis appelle
// computeBadgeDetails(orders). Si volume devient critique côté lecture
// (gros producteurs > 5000 orders/an), on basculera sur dénormalisation
// dans une migration additive — pas le sujet aujourd'hui.

/** Order minimale pour le calcul. Le type accepte les champs `null` car
 *  c'est ce que renvoie Postgres pour des colonnes nullable. */
export type ScoringOrder = {
  statut: string | null;
  created_at: string | null;
  confirmed_at: string | null;
  closure_reason: string | null;
};

export type BadgeScores = {
  badge_stock_score: number;
  badge_confirmation_score: number;
  badge_annulation_score: number;
};

export type BadgeDetails = {
  /** Total des commandes du producteur sur la fenêtre. */
  totalOrders: number;
  /** Commandes confirmées au sens large (avec un `confirmed_at`). */
  totalConfirmed: number;
  /** Commandes confirmées en ≤ CONFIRMATION_THRESHOLD. */
  fastConfirmed: number;
  /** Commandes annulées dont closure_reason est dans BLAMING_CLOSURE_REASONS
   *  (producer_cancel + stock par défaut). */
  blamingCancellations: number;
  /** Commandes annulées pour rupture stock spécifiquement (sous-ensemble
   *  des blamingCancellations). Sert au sous-titre du badge stock. */
  stockCancellations: number;
};

export type BadgeComputation = {
  scores: BadgeScores;
  details: BadgeDetails;
};

/** Cas "pas d'orders" : on retourne des scores neutres à 100 (rien à
 *  pénaliser) et des compteurs à 0. L'UI gère le wording "Pas encore
 *  assez de données" via le check totalOrders === 0. */
export const EMPTY_BADGE_COMPUTATION: BadgeComputation = {
  scores: {
    badge_stock_score: 100,
    badge_confirmation_score: 100,
    badge_annulation_score: 100,
  },
  details: {
    totalOrders: 0,
    totalConfirmed: 0,
    fastConfirmed: 0,
    blamingCancellations: 0,
    stockCancellations: 0,
  },
};

function pct(x: number, y: number): number {
  if (y === 0) return 100;
  return Math.round(((x / y) * 100) * 100) / 100;
}

/**
 * Calcule scores + détails à partir d'un tableau d'orders. Pur, testable,
 * sans I/O. Les détails permettent à l'UI d'afficher "X/Y confirmées en
 * ≤ 24 h", "Z annulation(s) de votre côté sur Y commandes", etc.
 */
export function computeBadgeDetails(
  orders: ReadonlyArray<ScoringOrder>,
): BadgeComputation {
  if (orders.length === 0) return EMPTY_BADGE_COMPUTATION;

  const totalOrders = orders.length;
  const stockCancellations = orders.filter(
    (o) => o.closure_reason === "stock",
  ).length;
  const blamingCancellations = orders.filter(
    (o) =>
      (o.statut === "cancelled" || o.statut === "refunded") &&
      (BLAMING_CLOSURE_REASONS as readonly string[]).includes(
        o.closure_reason ?? "",
      ),
  ).length;

  const confirmed = orders.filter((o) => o.confirmed_at !== null);
  const totalConfirmed = confirmed.length;
  const fastConfirmed = confirmed.filter((o) => {
    if (!o.confirmed_at || !o.created_at) return false;
    return (
      new Date(o.confirmed_at).getTime() - new Date(o.created_at).getTime() <=
      CONFIRMATION_THRESHOLD_MS
    );
  }).length;

  return {
    scores: {
      badge_stock_score: pct(totalOrders - stockCancellations, totalOrders),
      // Dénominateur `max(totalConfirmed, 1)` : préserve le comportement
      // historique de recompute-badges (un producteur sans confirmation
      // se retrouve à 0 % sur ce badge). Sémantique discutable, mais
      // changer ça serait un breaking change hors scope chantier scoring
      // cleanup — à traiter séparément si besoin.
      badge_confirmation_score: pct(
        fastConfirmed,
        Math.max(totalConfirmed, 1),
      ),
      badge_annulation_score: pct(
        totalOrders - blamingCancellations,
        totalOrders,
      ),
    },
    details: {
      totalOrders,
      totalConfirmed,
      fastConfirmed,
      blamingCancellations,
      stockCancellations,
    },
  };
}

// ─── Format des sous-titres détaillés affichés sous chaque badge ─────────

export type BadgeKind = "response" | "reliability" | "stock";

const WINDOW_SUFFIX = `(${BADGE_WINDOW_MONTHS} derniers mois)`;

function plural(n: number, singular: string, plural?: string): string {
  return n <= 1 ? singular : (plural ?? `${singular}s`);
}

/**
 * Retourne le sous-titre détaillé affiché sous chaque score. Si le
 * producteur n'a pas encore assez de données (totalOrders === 0, ou
 * totalConfirmed === 0 pour le badge response), retourne un message
 * neutre — un score 100/100 sans contexte n'est pas actionnable.
 */
export function formatBadgeDetailLine(
  kind: BadgeKind,
  details: BadgeDetails,
): string {
  if (details.totalOrders === 0) return "Pas encore assez de données";

  switch (kind) {
    case "response": {
      if (details.totalConfirmed === 0) {
        return "Aucune commande confirmée sur la période";
      }
      return `${details.fastConfirmed}/${details.totalConfirmed} confirmées en ≤ ${CONFIRMATION_THRESHOLD_HOURS} h ${WINDOW_SUFFIX}`;
    }
    case "reliability": {
      const noun = plural(details.blamingCancellations, "annulation");
      return `${details.blamingCancellations} ${noun} de votre côté sur ${details.totalOrders} commandes ${WINDOW_SUFFIX}`;
    }
    case "stock": {
      const noun = plural(details.stockCancellations, "rupture");
      return `${details.stockCancellations} ${noun} de stock sur ${details.totalOrders} commandes ${WINDOW_SUFFIX}`;
    }
  }
}
