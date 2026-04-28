import Link from "next/link";
import { Button } from "@/components/ui/button";

// CTA final de /notre-demarche — pattern visuel CtaBand homepage (green-900
// + radial terra subtil + Cormorant blanc + accent terra-300) mais copy
// distincte ciblée sur la conviction "achète chez l'éleveur, pas chez
// l'intermédiaire".
//
// CtaBand homepage hardcode "320 produits / 42 fermes cette semaine" — copy
// inadaptée ici, d'où composant local plutôt que réutilisation directe.

export type CtaSectionProps = { className?: string };

export function CtaSection({ className = "" }: CtaSectionProps) {
  return (
    <section
      className={`relative overflow-hidden bg-green-900 text-white ${className}`}
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 80% 30%, rgba(160,82,45,0.32), transparent 55%)",
        }}
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-[880px] px-4 py-16 text-center md:py-20">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terra-300">
          Passer à l&apos;action
        </span>
        <h2 className="mt-4 font-serif text-[36px] font-medium leading-[1.05] tracking-[-0.01em] text-white md:text-[56px]">
          Goûtez la différence,
          <br />
          directement{" "}
          <em className="not-italic">
            <span className="italic text-terra-300">à la ferme.</span>
          </em>
        </h2>
        <p className="mx-auto mt-5 max-w-[580px] text-base leading-[1.55] text-white/[0.78] md:text-[17px]">
          Découvrez les producteurs sarthois disponibles dès aujourd&apos;hui.
          Une commande, un éleveur, une rencontre.
        </p>
        <div className="mt-8">
          <Link href="/producteurs">
            <Button variant="primary" size="lg">
              Explorer les producteurs sarthois&nbsp;→
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
