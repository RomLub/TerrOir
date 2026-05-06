import { FRANCE_DEPARTEMENTS } from "@/lib/geo/france-departements";

// Carte cartogramme de la France métropolitaine + Corse, rendue à partir
// du référentiel hexgrid `lib/geo/france-departements.ts`. Server Component
// pur — pas d'interactivité JS, le tooltip est rendu via l'attribut SVG
// natif `<title>` (browser-native, accessible, zéro bundle JS).
//
// Choix du cartogramme (vs SVG géographique précis) :
//   - Pas de dépendance TopoJSON / GeoJSON (économie ~150 KB)
//   - Position relative des départements adjacents fidèle au terrain (Nord
//     ≈ haut, Bretagne ≈ gauche, PACA ≈ bas-droite, Corse ≈ extrême
//     sud-est) — suffisant pour un usage "couverture marketplace"
//   - V2 envisageable si la précision géo devient un besoin métier
//
// Couleurs design system (tailwind.config.js) :
//   - Couvert      : terra-700 #A0522D
//   - Non couvert  : stone-200 (gris clair)
//   - Hover        : terra-800 (assombrit légèrement, transition CSS)

const CELL_SIZE = 30;
const CELL_GAP = 4;
const CELL_RADIUS = 6;

const COLORS = {
  covered: "#A0522D",
  coveredHover: "#8C4523",
  uncovered: "#E7E5E4",
  uncoveredHover: "#D6D3D1",
  textCovered: "#FFFFFF",
  textUncovered: "#78716C",
};

export interface FranceMapCoverageProps {
  /** Codes département où au moins 1 producer public est présent (ex. ["72","49"]). */
  coveredDepartments: string[];
  /** Nombre de producers publics par département. */
  departmentProducerCounts: Record<string, number>;
  className?: string;
}

export function FranceMapCoverage({
  coveredDepartments,
  departmentProducerCounts,
  className = "",
}: FranceMapCoverageProps) {
  const coveredSet = new Set(coveredDepartments);

  // Calcule la bounding box pour ajuster le viewBox automatiquement.
  const maxCol = Math.max(...FRANCE_DEPARTEMENTS.map((d) => d.col));
  const maxRow = Math.max(...FRANCE_DEPARTEMENTS.map((d) => d.row));
  const widthUnits = maxCol + 1;
  const heightUnits = maxRow + 1;
  const svgWidth = widthUnits * (CELL_SIZE + CELL_GAP);
  const svgHeight = heightUnits * (CELL_SIZE + CELL_GAP);

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-auto"
        role="img"
        aria-label="Carte de France des départements couverts par TerrOir"
      >
        {FRANCE_DEPARTEMENTS.map((dept) => {
          const isCovered = coveredSet.has(dept.code);
          const count = departmentProducerCounts[dept.code] ?? 0;
          const x = dept.col * (CELL_SIZE + CELL_GAP);
          const y = dept.row * (CELL_SIZE + CELL_GAP);
          const fill = isCovered ? COLORS.covered : COLORS.uncovered;
          const hoverFill = isCovered
            ? COLORS.coveredHover
            : COLORS.uncoveredHover;
          const textFill = isCovered ? COLORS.textCovered : COLORS.textUncovered;
          const tooltip = isCovered
            ? `${dept.name} (${dept.code}) — ${count} producteur${count > 1 ? "s" : ""}`
            : `${dept.name} (${dept.code}) — Pas encore de producteur`;

          return (
            <g
              key={dept.code}
              className="cursor-default"
              style={{ transition: "fill 120ms ease" }}
            >
              <title>{tooltip}</title>
              <rect
                x={x}
                y={y}
                width={CELL_SIZE}
                height={CELL_SIZE}
                rx={CELL_RADIUS}
                ry={CELL_RADIUS}
                fill={fill}
                data-dept={dept.code}
                data-covered={isCovered ? "1" : "0"}
              >
                {/* hover via SMIL non requis — on s'appuie sur :hover CSS plus bas */}
              </rect>
              <text
                x={x + CELL_SIZE / 2}
                y={y + CELL_SIZE / 2 + 4}
                textAnchor="middle"
                fontSize="11"
                fontWeight={isCovered ? 600 : 400}
                fontFamily="ui-sans-serif, system-ui, sans-serif"
                fill={textFill}
                pointerEvents="none"
              >
                {dept.code}
              </text>
              {/* Hover overlay : un rect transparent qui force l'effet :hover.
                  La transition fill est appliquée via style inline + CSS
                  injecté dans <style> ci-dessous. */}
            </g>
          );
        })}
        {/* CSS scopé pour transitions hover — pas de JS, pas de classe Tailwind
            (les sélecteurs SVG ne supportent pas les hover states Tailwind
            via groupes sur Server Components). */}
        <style>{`
          rect[data-covered="1"]:hover { fill: ${COLORS.coveredHover}; }
          rect[data-covered="0"]:hover { fill: ${COLORS.uncoveredHover}; }
        `}</style>
      </svg>

      {/* Légende */}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-dark/70">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-4 w-4 rounded"
            style={{ backgroundColor: COLORS.covered }}
            aria-hidden
          />
          Producteurs disponibles
        </div>
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-4 w-4 rounded"
            style={{ backgroundColor: COLORS.uncovered }}
            aria-hidden
          />
          Pas encore couvert
        </div>
      </div>
    </div>
  );
}
