import { Fragment } from "react";
import { formatEuro } from "@/lib/format/currency";

// CircuitVisualizer — visualisation pédagogique de la répartition d'un kg de
// viande entre les maillons d'une filière (grande surface vs TerrOir).
//
// V0 STATIQUE PUR : Server Component, aucun JS client, layout horizontal
// boîtes + chevrons (wrap mobile via flex-wrap). Pas d'interactivité — un
// CD repassera plus tard pour itérer le polish (rivière sinueuse, hover,
// clic-désactivation maillon).
//
// ⚠️ DONNÉES PLACEHOLDER NON AUDITÉES — la répartition par maillon ci-dessous
// est une représentation pédagogique simplifiée. À calibrer post-V0 sur les
// sources OFPM (FranceAgriMer), Idele et CGAAER, avec validation juridique
// avant ouverture publique de la marketplace.

export type CircuitMode = "gms" | "terroir" | "comparison";

export type CircuitMaillon = {
  label: string;
  share: number; // pourcentage entier (somme attendue = 100)
};

// PLACEHOLDER — à calibrer (cf header). 8 maillons côté GMS.
export const GMS_MAILLONS: readonly CircuitMaillon[] = [
  { label: "Éleveur", share: 20 },
  { label: "Négociant", share: 5 },
  { label: "Abattoir", share: 8 },
  { label: "Atelier de découpe", share: 15 },
  { label: "Logistique", share: 7 },
  { label: "Centrale d'achat", share: 12 },
  { label: "Magasin", share: 33 },
];

// PLACEHOLDER — à calibrer (cf header). 4 maillons côté TerrOir.
// Le "Consommateur" n'est pas un maillon de marge — il est l'arrivée du flux.
export const TERROIR_MAILLONS: readonly CircuitMaillon[] = [
  { label: "Éleveur", share: 78 },
  { label: "Abattoir", share: 8 },
  { label: "Découpe", share: 5 },
  { label: "TerrOir", share: 9 },
];

export type CircuitVisualizerProps = {
  mode: CircuitMode;
  /** Si fourni, affiche les euros par maillon (prixKg × share / 100). */
  prixKg?: number;
  className?: string;
};

function ChevronRight({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="6 4 12 8 6 12" />
    </svg>
  );
}

type RowVariant = "gms" | "terroir";

type CircuitRowProps = {
  variant: RowVariant;
  label: string;
  maillons: readonly CircuitMaillon[];
  prixKg: number | undefined;
};

function CircuitRow({ variant, label, maillons, prixKg }: CircuitRowProps) {
  const palette =
    variant === "gms"
      ? {
          row: "border-terra-200 bg-terra-50",
          eyebrow: "text-terra-700",
          maillon: "border-terra-200 bg-white text-terra-900",
          eleveur: "border-terra-700 bg-terra-700 text-white",
          chevron: "text-terra-300",
        }
      : {
          row: "border-green-200 bg-green-50",
          eyebrow: "text-green-700",
          maillon: "border-green-200 bg-white text-green-900",
          eleveur: "border-green-700 bg-green-700 text-white",
          chevron: "text-green-400",
        };

  return (
    <div
      className={`rounded-2xl border ${palette.row} p-4 md:p-6`}
      data-circuit-row={variant}
    >
      <div
        className={`mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] ${palette.eyebrow}`}
      >
        {label}
      </div>
      <ol
        className="flex flex-wrap items-stretch gap-y-3"
        aria-label={
          variant === "gms"
            ? "Répartition en grande surface"
            : "Répartition avec TerrOir"
        }
      >
        {maillons.map((m, i) => {
          const isEleveur = m.label === "Éleveur";
          const boxStyle = isEleveur ? palette.eleveur : palette.maillon;
          return (
            <Fragment key={`${variant}-${m.label}-${i}`}>
              <li
                className={`flex min-w-[88px] flex-col items-center justify-center rounded-xl border px-3 py-2.5 text-center ${boxStyle}`}
              >
                <div className="text-[10px] font-semibold uppercase tracking-wide opacity-90">
                  {m.label}
                </div>
                <div className="mt-1 text-lg font-semibold leading-none tabular-nums">
                  {m.share}%
                </div>
                {prixKg !== undefined ? (
                  <div className="mt-1 text-xs leading-none tabular-nums opacity-85">
                    {formatEuro((prixKg * m.share) / 100)}
                  </div>
                ) : null}
              </li>
              {i < maillons.length - 1 ? (
                <li
                  aria-hidden="true"
                  className={`flex items-center px-1 ${palette.chevron}`}
                >
                  <ChevronRight className="h-4 w-4" />
                </li>
              ) : null}
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}

export function CircuitVisualizer({
  mode,
  prixKg,
  className = "",
}: CircuitVisualizerProps) {
  if (mode === "gms") {
    return (
      <div className={className}>
        <CircuitRow
          variant="gms"
          label="En grande surface"
          maillons={GMS_MAILLONS}
          prixKg={prixKg}
        />
      </div>
    );
  }

  if (mode === "terroir") {
    return (
      <div className={className}>
        <CircuitRow
          variant="terroir"
          label="Avec TerrOir"
          maillons={TERROIR_MAILLONS}
          prixKg={prixKg}
        />
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <CircuitRow
        variant="gms"
        label="En grande surface"
        maillons={GMS_MAILLONS}
        prixKg={prixKg}
      />
      <CircuitRow
        variant="terroir"
        label="Avec TerrOir"
        maillons={TERROIR_MAILLONS}
        prixKg={prixKg}
      />
    </div>
  );
}
