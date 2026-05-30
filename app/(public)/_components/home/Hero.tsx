import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WheatIcon } from "@/components/icons/wheat";

// Section Hero de la home consumer (homepage.html section .hero).
//
// Visuel hero : photo éditoriale `photo06_paysage-piquets` (bocage
// sarthois, espace négatif ciel haut → garantit la lisibilité du tag
// overlay positionné en bas). Format 16/9 (PR1 audit photos
// 2026-05-17 — décision : 16/9 par défaut partout, 4/5 conservé pour
// les blocs story-like).
//
// Tag overlay : étiquette générique (avatar épi de blé + claim circuit
// court). Ne porte AUCUNE mention de producteur nominative — la carte
// "Ferme des Tilleuls" inventée a été retirée (risque usurpation +
// crédibilité, audit photos 2026-05-20).
//
// Pas de stats inline dans le hero (Q2 validé pre-Phase C : on garde
// <PublicStats /> en section dédiée après Hero, branchée Supabase live).

export type HeroProps = {
  className?: string;
};

export function Hero({ className = "" }: HeroProps) {
  return (
    <section className={`bg-terroir-bg ${className}`}>
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-24 lg:py-28">
        <div className="grid items-center gap-12 md:grid-cols-[1.05fr_1fr] md:gap-16">
          {/* Texte (mobile : ordre 2 / desktop : ordre 1) */}
          <div className="order-2 md:order-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terra-700">
              Achat direct auprès des producteurs · Sarthe
            </span>
            <h1 className="mt-6 font-serif text-[44px] font-medium leading-[1.04] tracking-[-0.01em] text-green-900 md:text-[64px] md:leading-[1.02]">
              Achète local,
              <br />
              directement aux{" "}
              <em className="not-italic">
                <span className="italic text-terra-700">producteurs.</span>
              </em>
            </h1>
            <p className="mt-6 max-w-[520px] text-base leading-[1.55] text-terroir-ink/[0.78] md:text-[19px]">
              Volaille fermière, légumes des sables, fromages affinés à la
              cave : commande en ligne auprès des producteurs de la Sarthe et
              récupère ta commande sur le créneau qui te convient.
            </p>
            <div className="mt-9 flex flex-col gap-3 md:flex-row md:items-center md:gap-3.5">
              <Link href="/produits" className="md:inline-flex">
                <Button variant="primary" size="lg" className="w-full md:w-auto">
                  Acheter maintenant
                </Button>
              </Link>
              <Link href="/producteurs" className="md:inline-flex">
                <Button
                  variant="ghost"
                  size="lg"
                  className="w-full border border-terra-700 md:w-auto"
                >
                  Découvrir les producteurs
                </Button>
              </Link>
            </div>
          </div>

          {/* Visuel (mobile : ordre 1 / desktop : ordre 2) */}
          <div
            className="relative order-1 overflow-hidden rounded-2xl shadow-lift md:order-2"
            style={{ aspectRatio: "16 / 9" }}
          >
            <Image
              src="/images/editorial/photo06_paysage-piquets_hero-16x9.jpg"
              alt=""
              fill
              priority
              sizes="(min-width: 768px) 48vw, 100vw"
              className="object-cover"
            />
            {/* Tag overlay générique (avatar épi de blé + claim circuit
                court). Aucune mention de producteur nominative. */}
            <div className="absolute inset-x-6 bottom-6 flex items-center gap-3.5 rounded-xl bg-white/92 p-3.5 backdrop-blur">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-terra-100">
                <WheatIcon className="h-7 w-7 text-terra-800" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium leading-tight text-terroir-ink">
                  Produits disponibles · Sarthe
                </div>
                <div className="mt-0.5 text-xs leading-tight text-terroir-muted">
                  Commande en ligne · retrait à la ferme
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
