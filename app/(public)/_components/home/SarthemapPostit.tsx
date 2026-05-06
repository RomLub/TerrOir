import Link from "next/link";
import { MapSarthe } from "@/components/ui/map-sarthe";
import { PostIt } from "@/components/ui/post-it";

// Section "Carte Sarthe + Conseil de l'éleveur" (homepage.html
// .map-section). Grid 2 cols desktop (1.4fr / 1fr), stack mobile.
//
// La citation Marie Phase 1 est hardcodée fidèle au screen. Phase 2 :
// rotation depuis lib/queries/post-its/get-featured (rotation
// hebdomadaire entre éleveurs publiés).

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
        <div className="grid items-start gap-12 md:grid-cols-[1.4fr_1fr] md:gap-14">
          {/* Col 1 : intro + map + CTA */}
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
              ferme la plus proche de chez vous — et son créneau de retrait
              du week-end.
            </p>
            <div className="mt-7">
              <MapSarthe />
            </div>
            <Link
              href="/carte"
              className="mt-6 inline-flex items-center gap-2 text-[15px] font-medium text-terra-700 transition-colors hover:text-terra-900"
            >
              Trouver un éleveur près de chez vous&nbsp;→
            </Link>
          </div>

          {/* Col 2 : intro post-it + post-it */}
          <div className="md:pt-6">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terroir-muted">
              Le conseil de l&rsquo;éleveur
            </span>
            <h2 className="mt-3 font-serif text-[26px] font-medium leading-[1.2] text-green-900 md:text-[32px]">
              Avec chaque commande,
              <br />
              un mot de la ferme.
            </h2>
            <p className="mt-4 text-[15px] leading-[1.6] text-terroir-ink/[0.7]">
              Marie, Julien, Claire et les autres glissent un conseil de
              cuisson, une recette de saison ou simplement un mot de la
              semaine à côté de votre commande. Le geste qu&rsquo;aucune grande
              surface ne fait.
            </p>
            <div className="mt-8">
              <PostIt
                eyebrow="Le conseil de Marie"
                quote="Faites cuire à basse température, 1h30 à 150°C, puis 10 min à 200°C pour la peau croustillante. Servez avec mes pommes de terre grenaille — vous m'en direz des nouvelles."
                signature="Marie"
                meta="Ferme des Tilleuls · Coulaines"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
