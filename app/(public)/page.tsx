import Link from "next/link";
import { Button } from "@/components/ui/button";

const values = [
  {
    title: "Producteurs vérifiés",
    description:
      "Chaque producteur est rencontré et validé avant de rejoindre TerrOir.",
  },
  {
    title: "Circuit court",
    description:
      "De la ferme à votre table, sans intermédiaires superflus.",
  },
  {
    title: "Savoir-faire français",
    description:
      "Des produits du terroir issus de régions que nous aimons mettre en lumière.",
  },
];

export default function HomePage() {
  return (
    <>
      <section className="bg-terroir-green-100">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-20 md:py-28">
          <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-terroir-green-700">
            Marketplace des produits du terroir
          </span>
          <h1 className="font-serif text-5xl leading-tight text-terroir-ink md:text-6xl">
            Le goût du terroir,
            <br />
            <span className="text-terroir-green-700">au plus près</span> des
            producteurs.
          </h1>
          <p className="max-w-2xl text-lg text-terroir-ink/80">
            Découvrez des produits d&apos;exception, sélectionnés avec soin
            auprès de producteurs passionnés partout en France.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/carte">
              <Button variant="primary">Explorer les produits</Button>
            </Link>
            <Link href="/producteurs">
              <Button variant="secondary">Rencontrer les producteurs</Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20">
        <div className="mb-10 flex flex-col gap-2">
          <h2 className="font-serif text-3xl text-terroir-ink md:text-4xl">
            Pourquoi TerrOir&nbsp;?
          </h2>
          <p className="text-terroir-muted">
            Une sélection exigeante, une relation directe avec les producteurs.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {values.map((v) => (
            <article
              key={v.title}
              className="rounded-xl border border-terroir-border bg-white p-6 shadow-sm"
            >
              <h3 className="font-serif text-xl text-terroir-green-700">
                {v.title}
              </h3>
              <p className="mt-2 text-sm text-terroir-ink/80">{v.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-terroir-terra-100">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-4 py-16 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-serif text-3xl text-terroir-ink">
              Vous êtes producteur&nbsp;?
            </h2>
            <p className="mt-2 max-w-xl text-terroir-ink/80">
              Rejoignez TerrOir et vendez en direct vos produits à une
              communauté d&apos;amateurs.
            </p>
          </div>
          <Link href="/producteur/inscription">
            <Button variant="primary">Devenir producteur</Button>
          </Link>
        </div>
      </section>
    </>
  );
}
