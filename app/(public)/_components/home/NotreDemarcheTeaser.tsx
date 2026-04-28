import Link from "next/link";
import { Button } from "@/components/ui/button";

// Encart teaser /notre-demarche sur la home consumer.
//
// Server Component, V0 statique pur. Inséré entre Steps (white border-y)
// et FeaturedProducts (bg-terroir-bg) → bg-green-100 pour break visuel
// pédagogique (vs alternance cream/white dominante de la home), tonalité
// brand TerrOir. CtaBand final reste sur green-900 dark, pas de doublon.
//
// H2 reprend le chiffre choc du Hero de /notre-demarche (italic terra-700
// sur les valeurs) — cohérence narrative entre l'encart et la page cible.
// CTA "secondary" terra discret pour ne pas concurrencer le Hero principal.

export type NotreDemarcheTeaserProps = { className?: string };

export function NotreDemarcheTeaser({
  className = "",
}: NotreDemarcheTeaserProps) {
  return (
    <section
      className={`border-y border-terroir-border bg-green-100 ${className}`}
    >
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <div className="mx-auto max-w-[760px] text-center">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terra-700">
            Notre démarche
          </span>
          <h2 className="mt-4 font-serif text-[28px] font-medium leading-[1.15] tracking-[-0.005em] text-green-900 md:text-[40px] md:leading-[1.1]">
            Sur{" "}
            <em className="not-italic">
              <span className="italic text-terra-700">24 €</span>
            </em>{" "}
            payés en grande surface, l&apos;éleveur ne touche que{" "}
            <em className="not-italic">
              <span className="italic text-terra-700">5 €</span>
            </em>
            .
          </h2>
          <p className="mx-auto mt-5 max-w-[560px] text-[15px] leading-[1.6] text-terroir-ink/[0.72] md:text-base">
            Découvrez où va vraiment chaque euro, maillon par maillon, et
            pourquoi le circuit court redonne sa juste place à l&apos;éleveur
            sarthois.
          </p>
          <div className="mt-8">
            <Link href="/notre-demarche">
              <Button variant="secondary" size="lg">
                Comprendre la démarche&nbsp;→
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
