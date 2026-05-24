// « Santé de ma boutique » (ADR-0011) — consolidation des indicateurs déjà
// calculés (badges + note d'avis) en une vue lisible avec seuils + conseils.
// Helper PUR (testable). Les scores viennent de la table producers (calculés
// par le cron weekly-badges / recompute-badges) — aucune recompute ici.
//
// Seuils alignés sur l'affichage existant du tableau de bord :
//   stock ≥ 90, réactivité ≥ 85, fiabilité ≥ 95 = « bon ».

export type HealthBand = "good" | "warn" | "bad";

export type HealthMetric = {
  key: "stock" | "response" | "reliability" | "rating";
  label: string;
  display: string;
  band: HealthBand;
  tip: string;
};

export type ProducerHealth = {
  metrics: HealthMetric[];
  overall: number; // 0-100, moyenne des 3 badges
  overallBand: HealthBand;
};

export type HealthInput = {
  stock: number; // 0-100
  response: number; // 0-100
  reliability: number; // 0-100
  rating: number; // 0-5
  reviewCount: number;
};

function band(score: number, good: number, warn: number): HealthBand {
  if (score >= good) return "good";
  if (score >= warn) return "warn";
  return "bad";
}

function pct(score: number): string {
  return `${Math.round(score)} %`;
}

export function computeHealth(input: HealthInput): ProducerHealth {
  const stock = Math.round(input.stock);
  const response = Math.round(input.response);
  const reliability = Math.round(input.reliability);

  const stockBand = band(stock, 90, 70);
  const responseBand = band(response, 85, 65);
  const reliabilityBand = band(reliability, 95, 80);

  // Note d'avis : bande sur la note, mais « pas encore d'avis » est neutre.
  let ratingBand: HealthBand;
  let ratingDisplay: string;
  let ratingTip: string;
  if (input.reviewCount <= 0) {
    ratingBand = "warn";
    ratingDisplay = "—";
    ratingTip = "Pas encore d'avis : vos premiers clients feront la différence.";
  } else {
    ratingBand =
      input.rating >= 4.5 ? "good" : input.rating >= 4 ? "warn" : "bad";
    ratingDisplay = `${input.rating.toFixed(1).replace(".", ",")} / 5`;
    ratingTip =
      ratingBand === "good"
        ? "Vos clients sont très satisfaits, continuez ainsi."
        : ratingBand === "warn"
          ? "Bonne note. Soignez chaque retrait pour la faire monter."
          : "Soignez l'accueil et la qualité pour faire remonter la note.";
  }

  const metrics: HealthMetric[] = [
    {
      key: "stock",
      label: "Gestion du stock",
      display: pct(stock),
      band: stockBand,
      tip:
        stockBand === "good"
          ? "Excellent. Continuez à actualiser vos stocks après chaque vente."
          : "Actualisez vos stocks régulièrement pour éviter les ruptures.",
    },
    {
      key: "response",
      label: "Réactivité",
      display: pct(response),
      band: responseBand,
      tip:
        responseBand === "good"
          ? "Très réactif, vos clients apprécient."
          : "Confirmez vos commandes en moins de 2h pour atteindre 85 % et plus.",
    },
    {
      key: "reliability",
      label: "Fiabilité",
      display: pct(reliability),
      band: reliabilityBand,
      tip:
        reliabilityBand === "good"
          ? "Parfait, presque aucune annulation de votre côté."
          : "Évitez les annulations de votre côté pour améliorer ce score.",
    },
    {
      key: "rating",
      label: "Note des avis",
      display: ratingDisplay,
      band: ratingBand,
      tip: ratingTip,
    },
  ];

  const overall = Math.round((stock + response + reliability) / 3);
  const overallBand = band(overall, 85, 70);

  return { metrics, overall, overallBand };
}
