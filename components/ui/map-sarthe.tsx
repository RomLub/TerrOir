// Carte SVG Sarthe — silhouette stylisée + 8 pins producteurs partenaires.
//
// Source visuelle fidèle au screen handoff (screens/desktop/homepage.html
// section .map). C'est une silhouette ÉVOCATRICE (ellipse irrégulière), pas
// le contour cadastral exact du département. Suffit pour la home consumer.
//
// Phase 2 : ce composant sera remplacé sur /carte par une carte interactive
// Mapbox GL JS plein écran (déjà dans le stack du repo). Les 8 pins ci-
// dessous sont mockés Phase 1 ; en Phase 2 ils viendront de Supabase via
// un props `producers: { name, x, y }[]` (coords projetées sur le viewBox).

const PRODUCER_PINS: Array<{
  name: string;
  cx: number;
  cy: number;
  /** Si true, le label est positionné à gauche (text-anchor=end). Sinon à droite. */
  labelLeft?: boolean;
  /** Décalage vertical du label, par défaut centré (4). Utiliser -10 pour label au-dessus. */
  labelDy?: number;
}> = [
  { name: "Coulaines", cx: 265, cy: 178, labelLeft: true, labelDy: -10 },
  { name: "Allonnes", cx: 312, cy: 222 },
  { name: "Vibraye", cx: 420, cy: 175 },
  { name: "Saosnes", cx: 225, cy: 130, labelLeft: true, labelDy: -10 },
  { name: "Mayet", cx: 380, cy: 305 },
  { name: "Loué", cx: 195, cy: 245, labelLeft: true, labelDy: -10 },
  { name: "Bonnétable", cx: 355, cy: 145, labelDy: -6 },
  { name: "Le Lude", cx: 420, cy: 245 },
  { name: "Sillé", cx: 150, cy: 175, labelLeft: true, labelDy: -10 },
];

export type MapSartheProps = {
  className?: string;
};

export function MapSarthe({ className = "" }: MapSartheProps) {
  return (
    <div
      className={`relative aspect-16/11 overflow-hidden rounded-2xl border border-terroir-border bg-terroir-bg shadow-soft ${className}`}
    >
      <svg
        viewBox="0 0 600 410"
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        role="img"
        aria-label="Carte de la Sarthe avec les producteurs partenaires"
      >
        <defs>
          <pattern
            id="map-sarthe-hatch"
            width="14"
            height="14"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="14" stroke="#E6E1D6" strokeWidth="1" />
          </pattern>
        </defs>

        {/* Fond hachuré subtil teinté crème */}
        <rect width="600" height="410" fill="url(#map-sarthe-hatch)" opacity="0.5" />

        {/* Silhouette stylisée du département */}
        <path
          d="M120 95 C 150 70, 230 60, 300 70 C 360 78, 430 90, 470 130 C 510 170, 510 230, 480 290 C 450 340, 380 360, 310 350 C 240 340, 170 320, 130 280 C 95 240, 90 170, 105 130 Z"
          fill="#FFFFFF"
          stroke="#2D6A4F"
          strokeWidth="1.5"
          opacity="0.95"
        />

        {/* Rivières Sarthe + Loir, esquissées */}
        <path
          d="M150 110 C 200 140, 240 180, 290 200 C 340 220, 400 240, 460 260"
          fill="none"
          stroke="#A0522D"
          strokeWidth="1.2"
          opacity="0.5"
        />
        <path
          d="M200 320 C 250 290, 320 280, 380 300 C 420 312, 450 320, 470 318"
          fill="none"
          stroke="#A0522D"
          strokeWidth="1.2"
          opacity="0.5"
        />

        {/* Le Mans — préfecture, gros marqueur terra */}
        <g transform="translate(290 200)">
          <circle r="14" fill="rgba(160,82,45,0.15)" />
          <circle r="6" fill="#A0522D" />
          <text
            x="14"
            y="5"
            fontFamily="Inter, sans-serif"
            fontSize="12"
            fontWeight="600"
            fill="#1A1A1A"
          >
            Le Mans
          </text>
        </g>

        {/* Producteurs partenaires — pins green-700 cerclés blanc */}
        <g
          fontFamily="Inter, sans-serif"
          fontSize="11"
          fill="#1A1A1A"
          fontWeight="500"
        >
          {PRODUCER_PINS.map((pin) => {
            const dy = pin.labelDy ?? 4;
            const dx = pin.labelLeft ? -6 : 10;
            return (
              <g key={pin.name} transform={`translate(${pin.cx} ${pin.cy})`}>
                <circle r="6" fill="#2D6A4F" stroke="#fff" strokeWidth="2" />
                <text
                  x={dx}
                  y={dy}
                  textAnchor={pin.labelLeft ? "end" : "start"}
                >
                  {pin.name}
                </text>
              </g>
            );
          })}
        </g>

        {/* Légende */}
        <g
          transform="translate(28 360)"
          fontFamily="Inter, sans-serif"
          fontSize="11"
          fill="#6B7280"
        >
          <circle r="5" cx="6" cy="-2" fill="#2D6A4F" stroke="#fff" strokeWidth="1.5" />
          <text x="18" y="2">
            Producteur partenaire
          </text>
          <circle r="5" cx="180" cy="-2" fill="#A0522D" />
          <text x="192" y="2">
            Préfecture · Le Mans
          </text>
        </g>
      </svg>
    </div>
  );
}
