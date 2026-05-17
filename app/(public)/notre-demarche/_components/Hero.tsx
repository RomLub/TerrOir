import Image from "next/image";

// Hero de /notre-demarche — chiffre choc + tagline.
//
// Visuel hero : photo éditoriale `photo20_eolienne-orage` (éolienne sous
// orage, ambiance ruralité / enjeux climat). L'éolienne est cadrée à
// gauche, le ciel orageux occupe la moitié haute. Le texte est superposé
// côté droit, sur un voile blanc qui dégrade vers la gauche pour ne pas
// masquer l'éolienne (cf. décision PR2 audit photos 2026-05-17).
//
// Le H1 est volontairement formulé "une fraction" (sans chiffre précis)
// en attendant la calibration sourcée — cf. issue GitHub #144. Quand
// les chiffres précis seront sourcés (FranceAgriMer OFPM entrecôte),
// le H1 pourra retrouver des valeurs chiffrées + une mention source.

export type NotreDemarcheHeroProps = { className?: string };

export function Hero({ className = "" }: NotreDemarcheHeroProps) {
  return (
    <section className={`relative overflow-hidden ${className}`}>
      <Image
        src="/images/editorial/photo20_eolienne-orage_hero-16x9.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      {/* Overlay mobile : voile blanc uniforme pour lisibilité full-width. */}
      <div
        className="absolute inset-0 bg-white/82 md:hidden"
        aria-hidden="true"
      />
      {/* Overlay desktop : gradient horizontal — opaque côté droit (texte),
          transparent côté gauche (éolienne libre). */}
      <div
        className="absolute inset-0 hidden bg-linear-to-l from-white/90 via-white/55 to-transparent md:block"
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-6xl px-4 py-20 md:py-28 lg:py-32">
        <div className="md:ml-auto md:w-[58%]">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terra-700">
            Notre démarche · Transparence
          </span>
          <h1 className="mt-6 font-serif text-[36px] font-medium leading-[1.06] tracking-[-0.01em] text-green-900 md:text-[56px] md:leading-[1.04]">
            Sur 1 kg d&apos;entrecôte payé en grande surface,
            l&apos;éleveur ne touche qu&apos;
            <em className="not-italic">
              <span className="italic text-terra-700">une fraction</span>
            </em>
            .
          </h1>
          <p className="mt-8 max-w-[640px] text-base leading-[1.55] text-terroir-ink/[0.85] md:text-[19px]">
            TerrOir met en relation directe les éleveurs sarthois et les
            consommateurs. Pas de centrale d&apos;achat, pas de grossiste qui
            marge : la quasi-totalité du prix repart vers la ferme.
          </p>
        </div>
      </div>
    </section>
  );
}
