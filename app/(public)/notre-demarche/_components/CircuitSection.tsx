import { CircuitVisualizer } from "./CircuitVisualizer";

// Section "La répartition" — wrapper de spacing/layout autour du composant
// CircuitVisualizer V2. Eyebrow / titre / sous-titre vivent dans le composant
// (cohérence avec la maquette Claude Design).
//
// Pattern section homepage : bg-white encadré, max-w-6xl, padding 16/20.

export type CircuitSectionProps = { className?: string };

export function CircuitSection({ className = "" }: CircuitSectionProps) {
  return (
    <section
      className={`border-y border-terroir-border bg-white ${className}`}
    >
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <CircuitVisualizer />
      </div>
    </section>
  );
}
