import type { CircuitNode } from "../_data/circuits";

// Helpers maths pour CircuitVisualizer V2 — port direct des fonctions
// JS de la maquette Claude Design (notre_demarche/circuit_visualizer_v2.html
// lignes 547-562 et 649-659).

const NBSP = " ";

export type RiverPathInput = {
  /** Positions X des nœuds en unité viewbox (0 → viewboxWidth). */
  positionsX: ReadonlyArray<number>;
  /** Hauteur viewbox du tracé. */
  height: number;
};

/**
 * Construit un path SVG sinueux (Catmull-Rom approximé via courbes de
 * Bézier cubiques) reliant les positions données. Premier et dernier
 * nœuds sont alignés sur l'axe central, les intermédiaires alternent
 * au-dessus / en-dessous (offset = 32% de la hauteur).
 */
export function buildRiverPath({ positionsX, height }: RiverPathInput): string {
  if (positionsX.length === 0) return "";
  const center = height / 2;
  const offset = height * 0.32;
  const ys = positionsX.map((_, i) => {
    if (i === 0 || i === positionsX.length - 1) return center;
    return i % 2 === 1 ? center - offset : center + offset;
  });
  let d = `M ${positionsX[0]} ${ys[0]}`;
  for (let i = 1; i < positionsX.length; i++) {
    const px = positionsX[i - 1]!;
    const py = ys[i - 1]!;
    const cx = positionsX[i]!;
    const cy = ys[i]!;
    const midX = (px + cx) / 2;
    d += ` C ${midX} ${py}, ${midX} ${cy}, ${cx} ${cy}`;
  }
  return d;
}

/**
 * Calcule la part éleveur GMS dans la simulation pédagogique : part
 * d'origine + somme des parts des maillons désactivés (redistribution).
 */
export function computeEleveurShareGMS(
  gmsData: ReadonlyArray<CircuitNode>,
  disabled: ReadonlySet<string>,
): number {
  const eleveur = gmsData.find((n) => n.id === "eleveur");
  if (!eleveur) return 0;
  let bonus = 0;
  disabled.forEach((id) => {
    const node = gmsData.find((n) => n.id === id);
    if (node) bonus += node.pct;
  });
  return eleveur.pct + bonus;
}

/**
 * Calcule les positions Y (en pourcentage de la hauteur) pour chaque
 * nœud — alignées sur le tracé de buildRiverPath.
 */
export function computeNodeYPercents(count: number): number[] {
  if (count === 0) return [];
  const center = 50;
  const offset = 32;
  return Array.from({ length: count }, (_, i) => {
    if (i === 0 || i === count - 1) return center;
    return i % 2 === 1 ? center - offset : center + offset;
  });
}

/**
 * Distribue n nœuds horizontalement avec un padding latéral en
 * pourcentage. Renvoie les positions X en %.
 */
export function computeNodeXPercents(count: number, padding = 6): number[] {
  if (count === 0) return [];
  if (count === 1) return [50];
  const usable = 100 - padding * 2;
  return Array.from(
    { length: count },
    (_, i) => padding + (usable * i) / (count - 1),
  );
}

/** Format pourcentage avec espace insécable, sans décimale. */
export function formatPct(value: number): string {
  return `${Math.round(value)}${NBSP}%`;
}

/** Variante 1 décimale (utilisée pour la moyenne en tooltip). */
export function formatPctDecimal(value: number): string {
  return `${value.toFixed(1)}${NBSP}%`;
}
