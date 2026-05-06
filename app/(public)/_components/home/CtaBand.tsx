import Link from "next/link";
import { Button } from "@/components/ui/button";

// Section CTA final dark green-900 (homepage.html .cta-band).
//
// Bandeau plein largeur avec radial-gradient terra subtil en overlay
// pour réchauffer le fond green-900 (cf. screen ::before). Contenu
// centré max-w-880, eyebrow terra-300, H2 Cormorant blanc avec em
// italic terra-300, body white/78, CTA primary terra.

export type CtaBandProps = { className?: string };

export function CtaBand({ className = "" }: CtaBandProps) {
  return (
    <section
      className={`relative overflow-hidden bg-green-900 text-white ${className}`}
    >
      {/* Overlay radial terra subtil (cf. screen .cta-band::before) */}
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
          Goûte la Sarthe
        </span>
        <h2 className="mt-4 font-serif text-[36px] font-medium leading-[1.05] tracking-[-0.01em] text-white md:text-[56px]">
          Une commande,
          <br />
          un{" "}
          <em className="not-italic">
            <span className="italic text-terra-300">producteur</span>
          </em>
          , une rencontre.
        </h2>
        <p className="mx-auto mt-5 max-w-[580px] text-base leading-[1.55] text-white/[0.78] md:text-[17px]">
          Cette semaine, 320 produits sont disponibles auprès de 42 fermes
          sarthoises. Compose ton panier, choisis ton créneau, le
          reste se passe en cuisine.
        </p>
        <div className="mt-8">
          <Link href="/producteurs">
            <Button variant="primary" size="lg">
              Explorer les fermes&nbsp;→
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
