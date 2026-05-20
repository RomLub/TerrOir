import Link from "next/link";
import { MapSarthe } from "@/components/ui/map-sarthe";

// Section "Les fermes en Sarthe" (homepage.html .map-section) — intro +
// carte SVG évocatrice du département + CTA vers /carte.
//
// La sous-section "Le conseil de l'éleveur" (post-it) a été retirée le
// 2026-05-20 : son contenu (producteur « Marie · Ferme des Tilleuls » +
// conseil de cuisson) était entièrement inventé — fausse social proof,
// en plus du risque d'usurpation. Réactivation conditionnée à un vrai
// conseil producteur fourni avec autorisation écrite (cf.
// docs/post-launch-checklist.md).

export type SarthemapPostitProps = { className?: string };

export function SarthemapPostit({
  className = "",
}: SarthemapPostitProps) {
  return (
    <section
      id="producteurs"
      className={`border-y border-terroir-border bg-white ${className}`}
    >
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <div className="grid items-center gap-12 md:grid-cols-2 md:gap-14">
          {/* Intro + CTA */}
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terra-700">
              Les fermes en Sarthe
            </span>
            <h2 className="mt-3 font-serif text-[28px] font-medium leading-[1.15] tracking-[-0.005em] text-green-900 md:text-[38px]">
              42 producteurs,
              <br />
              tous à moins de 60&nbsp;km du Mans.
            </h2>
            <p className="mt-3 max-w-[480px] text-base leading-[1.55] text-terroir-ink/[0.72]">
              Volaille à Coulaines, maraîchage à Allonnes, chèvrerie à
              Vibraye, vergers à Saosnes. Une carte simple pour repérer la
              ferme la plus proche de chez toi — et son créneau de retrait
              du week-end.
            </p>
            <Link
              href="/carte"
              className="mt-6 inline-flex items-center gap-2 text-[15px] font-medium text-terra-700 transition-colors hover:text-terra-900"
            >
              Trouver un éleveur près de chez toi&nbsp;→
            </Link>
          </div>

          {/* Carte */}
          <div>
            <MapSarthe />
          </div>
        </div>
      </div>
    </section>
  );
}
