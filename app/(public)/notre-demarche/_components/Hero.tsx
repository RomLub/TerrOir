// Hero de /notre-demarche — chiffre choc + source + tagline.
//
// Le chiffre choc EST le H1 de la page (single H1 SEO). Italic terra-700
// sur les valeurs clés ("24 €" et "5 €") cohérent style homepage Hero.
//
// ⚠️ Chiffres placeholder, source à valider — cf <Disclaimer /> en bas
// de page.

export type NotreDemarcheHeroProps = { className?: string };

export function Hero({ className = "" }: NotreDemarcheHeroProps) {
  return (
    <section className={`bg-terroir-bg ${className}`}>
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-24 lg:py-28">
        <div className="mx-auto max-w-[820px] text-center md:text-left">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terra-700">
            Notre démarche · Transparence
          </span>
          <h1 className="mt-6 font-serif text-[36px] font-medium leading-[1.06] tracking-[-0.01em] text-green-900 md:text-[56px] md:leading-[1.04]">
            Sur 1 kg d&apos;entrecôte payé{" "}
            <em className="not-italic">
              <span className="italic text-terra-700">24 €</span>
            </em>{" "}
            en grande surface, l&apos;éleveur ne touche que{" "}
            <em className="not-italic">
              <span className="italic text-terra-700">5 €</span>
            </em>
            .
          </h1>
          <p className="mt-5 text-xs leading-[1.55] text-terroir-muted md:text-sm">
            Source indicative : FranceAgriMer (OFPM — Observatoire de la
            Formation des Prix et des Marges). Chiffre placeholder à calibrer
            avant l&apos;ouverture publique.
          </p>
          <p className="mt-8 max-w-[640px] text-base leading-[1.55] text-terroir-ink/[0.78] md:text-[19px]">
            TerrOir met en relation directe les éleveurs sarthois et les
            consommateurs. Pas de centrale d&apos;achat, pas de grossiste qui
            marge : la quasi-totalité du prix repart vers la ferme.
          </p>
        </div>
      </div>
    </section>
  );
}
