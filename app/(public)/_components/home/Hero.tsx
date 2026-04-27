import Link from "next/link";
import { Button } from "@/components/ui/button";

// Section Hero de la home consumer (homepage.html section .hero).
//
// Phase 1 : visuel = placeholder dégradé terra (3-stop linear-gradient
// + radial highlight + texture stripes) avec tag overlay producteur en
// dur. Phase 2 : remplacer le placeholder par une vraie photo et
// alimenter le tag depuis Supabase via la prop `producer`.
//
// Pas de stats inline dans le hero (Q2 validé pre-Phase C : on garde
// <PublicStats /> en section dédiée après Hero, branchée Supabase live).

export type HeroProducer = {
  name: string;
  commune: string;
  pitch: string;
};

export type HeroProps = {
  producer?: HeroProducer;
  className?: string;
};

const DEFAULT_PRODUCER: HeroProducer = {
  name: "Ferme des Tilleuls",
  commune: "Coulaines",
  pitch: "volaille fermière depuis 1987",
};

export function Hero({
  producer = DEFAULT_PRODUCER,
  className = "",
}: HeroProps) {
  return (
    <section className={`bg-terroir-bg ${className}`}>
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-24 lg:py-28">
        <div className="grid items-center gap-12 md:grid-cols-[1.05fr_1fr] md:gap-16">
          {/* Texte (mobile : ordre 2 / desktop : ordre 1) */}
          <div className="order-2 md:order-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terra-700">
              Marketplace des produits du terroir · Sarthe
            </span>
            <h1 className="mt-6 font-serif text-[44px] font-medium leading-[1.04] tracking-[-0.01em] text-green-900 md:text-[64px] md:leading-[1.02]">
              Le goût du terroir,
              <br />
              au plus près des{" "}
              <em className="not-italic">
                <span className="italic text-terra-700">producteurs.</span>
              </em>
            </h1>
            <p className="mt-6 max-w-[520px] text-base leading-[1.55] text-terroir-ink/[0.78] md:text-[19px]">
              Volaille fermière, légumes des sables, fromages affinés à la
              cave : commandez en ligne auprès des producteurs de la Sarthe et
              récupérez votre commande sur le créneau qui vous convient.
            </p>
            <div className="mt-9 flex flex-col gap-3 md:flex-row md:items-center md:gap-3.5">
              <Link href="#produits" className="md:inline-flex">
                <Button variant="primary" size="lg" className="w-full md:w-auto">
                  Explorer les produits
                </Button>
              </Link>
              <Link href="/carte" className="md:inline-flex">
                <Button
                  variant="ghost"
                  size="lg"
                  className="w-full border border-terra-700 md:w-auto"
                >
                  Voir la carte des fermes
                </Button>
              </Link>
            </div>
          </div>

          {/* Visuel (mobile : ordre 1 / desktop : ordre 2) */}
          <div
            className="relative order-1 overflow-hidden rounded-2xl shadow-lift md:order-2"
            style={{
              aspectRatio: "4 / 5",
              background:
                "radial-gradient(ellipse at 30% 20%, rgba(255,255,255,.4), transparent 50%), linear-gradient(135deg, #E5C9A6 0%, #B8713E 45%, #6B3620 100%)",
            }}
            aria-hidden="true"
          >
            {/* Texture stripes subtiles */}
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(10deg, rgba(0,0,0,0) 0 24px, rgba(255,255,255,.04) 24px 26px), repeating-linear-gradient(-12deg, rgba(0,0,0,0) 0 38px, rgba(0,0,0,.05) 38px 40px)",
              }}
            />
            {/* Tag overlay producteur (placeholder Phase 1) */}
            <div className="absolute inset-x-6 bottom-6 flex items-center gap-3.5 rounded-xl bg-white/[0.92] p-3.5 backdrop-blur">
              <div
                className="h-11 w-11 shrink-0 rounded-full"
                style={{
                  background: "linear-gradient(135deg, #95D5B2, #2D6A4F)",
                }}
              />
              <div className="min-w-0">
                <div className="text-sm font-medium leading-tight text-terroir-ink">
                  {producer.name}
                </div>
                <div className="mt-0.5 text-xs leading-tight text-terroir-muted">
                  {producer.commune} · {producer.pitch}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
