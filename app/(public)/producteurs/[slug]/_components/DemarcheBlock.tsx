import { DistanceWidget } from "./DistanceWidget";

// Section « Notre démarche » de la fiche publique producteur. Remplace
// l'ancien ScoreCarbonBlock (chantier 3, 2026-05-22) dont elle ne conserve
// que le widget distance ferme → consommateur. Les 3 indicateurs score-carbone
// (mode d'élevage / alimentation / densité) ont été supprimés ; le widget
// distance est une fonctionnalité distincte, préservée.

export type DemarcheBlockProps = {
  producerLat: number | null;
  producerLng: number | null;
  producerName: string;
};

export function DemarcheBlock({
  producerLat,
  producerLng,
  producerName,
}: DemarcheBlockProps) {
  const hasDistance = producerLat !== null && producerLng !== null;

  return (
    <section
      id="demarche"
      className="border-y border-terroir-border bg-terroir-bg scroll-mt-32"
    >
      <div className="mx-auto max-w-7xl px-6 py-16 md:py-24">
        <div className="mx-auto max-w-[720px] text-center md:text-left">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terra-700">
            Notre démarche
          </span>
          <h2 className="mt-4 font-serif text-[32px] font-medium leading-[1.1] tracking-[-0.005em] text-green-900 md:text-[44px]">
            <span className="italic text-terra-700">Au plus près</span> de chez
            toi.
          </h2>
          <p className="mt-5 max-w-[560px] text-[15px] leading-[1.55] text-terroir-ink/[0.72] md:max-w-none">
            La distance réelle qui te sépare de la ferme, à vol d&rsquo;oiseau.
          </p>
        </div>

        {hasDistance ? (
          <div className="mt-8">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-terra-700">
              Distance ferme → toi
            </div>
            <DistanceWidget
              producerLat={producerLat}
              producerLng={producerLng}
              producerName={producerName}
            />
          </div>
        ) : (
          <div className="mx-auto mt-10 max-w-[720px]">
            <div className="rounded-xl border border-dashed border-terroir-border bg-white px-5 py-6 text-center">
              <p className="text-[14px] leading-[1.55] text-terroir-ink/[0.7]">
                Ce producteur n&rsquo;a pas encore renseigné sa localisation.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
