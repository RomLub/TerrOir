import type { Metadata } from "next";
import Link from "next/link";
import {
  GLOSSAIRE_CATEGORY_LABELS,
  getGlossaireArticlesByCategory,
  type GlossaireCategory,
} from "@/content/glossaire";

// T-243 — page liste /glossaire (Server Component pur).
//
// V0 scaffolding (cf. brief Teammate D) : 1-2 articles seed. Cycles
// rédactionnels suivants viennent étendre. La page rend toutes les catégories
// même vides (placeholder éditorial neutre) — les ajouts à venir n'auront
// qu'à pousser des articles dans GLOSSAIRE_ARTICLES.

export const metadata: Metadata = {
  title: "Glossaire du terroir — TerrOir",
  description:
    "Comprendre les labels, races, modes d'élevage et terroirs sarthois mis en avant sur TerrOir.",
};

const CATEGORY_ORDER: GlossaireCategory[] = [
  "labels",
  "modes-elevage",
  "races",
  "terroirs",
];

export default function GlossairePage() {
  const grouped = getGlossaireArticlesByCategory();

  return (
    <>
      <section className="bg-terroir-bg">
        <div className="mx-auto max-w-6xl px-4 py-16 md:py-24">
          <div className="mx-auto max-w-[820px] text-center md:text-left">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terra-700">
              Glossaire du terroir
            </span>
            <h1 className="mt-6 font-serif text-[36px] font-medium leading-[1.06] tracking-[-0.01em] text-green-900 md:text-[56px] md:leading-[1.04]">
              Le vocabulaire de la{" "}
              <em className="not-italic">
                <span className="italic text-terra-700">qualité.</span>
              </em>
            </h1>
            <p className="mt-6 max-w-[640px] text-base leading-[1.55] text-terroir-ink/[0.78] md:text-[19px]">
              Labels officiels, races rustiques, modes d&rsquo;élevage,
              spécificités du terroir sarthois — petite encyclopédie
              vivante des termes que tu croiseras sur les fiches produits
              et producteurs.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-terroir-border bg-white">
        <div className="mx-auto max-w-6xl px-4 py-12 md:py-16">
          <div className="space-y-12 md:space-y-14">
            {CATEGORY_ORDER.map((cat) => {
              const articles = grouped[cat];
              return (
                <CategoryGroup
                  key={cat}
                  label={GLOSSAIRE_CATEGORY_LABELS[cat]}
                  articles={articles}
                />
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}

type CategoryGroupProps = {
  label: string;
  articles: ReturnType<typeof getGlossaireArticlesByCategory>[GlossaireCategory];
};

function CategoryGroup({ label, articles }: CategoryGroupProps) {
  return (
    <div>
      <h2 className="mb-5 font-serif text-2xl font-medium leading-tight text-green-900 md:text-3xl">
        {label}
      </h2>
      {articles.length === 0 ? (
        <p className="rounded-xl border border-dashed border-terroir-border bg-terroir-bg px-5 py-6 text-[14px] text-terroir-ink/[0.6]">
          Cette catégorie sera bientôt enrichie. Reviens d&rsquo;ici
          quelques jours.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((a) => (
            <li key={a.slug}>
              <Link
                href={`/glossaire/${a.slug}`}
                className="group flex h-full flex-col rounded-2xl border border-terroir-border bg-white p-5 shadow-soft transition-colors hover:border-terra-300"
              >
                <h3 className="font-serif text-lg font-medium leading-snug text-green-900 group-hover:text-terra-700">
                  {a.title}
                </h3>
                <p className="mt-2 text-[13px] leading-[1.55] text-terroir-ink/[0.7]">
                  {a.excerpt}
                </p>
                <span className="mt-4 inline-flex items-center text-[12px] font-semibold text-terra-700">
                  Lire la définition&nbsp;→
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
