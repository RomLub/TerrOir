import { CircuitVisualizer } from "@/components/ui/circuit-visualizer";

// Section "La répartition" — wrapper sémantique autour du composant
// CircuitVisualizer en mode comparison avec prixKg=24 (entrecôte hero).
//
// Pattern section homepage (Steps/Reassurance) : bg-white encadré de
// borders, max-w-6xl, padding 16/20. Header centré max-w-720.

export type CircuitSectionProps = { className?: string };

export function CircuitSection({ className = "" }: CircuitSectionProps) {
  return (
    <section
      className={`border-y border-terroir-border bg-white ${className}`}
    >
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <div className="mx-auto mb-10 max-w-[720px] text-center md:mb-12">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terra-700">
            La répartition
          </span>
          <h2 className="mt-4 font-serif text-[32px] font-medium leading-[1.1] tracking-[-0.005em] text-green-900 md:text-[44px]">
            Voici comment se répartit ce que vous payez,
            <br />
            <em className="not-italic">
              <span className="italic text-terra-700">maillon par maillon.</span>
            </em>
          </h2>
          <p className="mx-auto mt-5 max-w-[560px] text-[15px] leading-[1.55] text-terroir-ink/[0.72]">
            Pour 1 kg d&apos;entrecôte facturé 24 € au consommateur, voici
            comment le prix se ventile entre les acteurs de chaque circuit.
          </p>
        </div>
        <CircuitVisualizer mode="comparison" prixKg={24} />
      </div>
    </section>
  );
}
