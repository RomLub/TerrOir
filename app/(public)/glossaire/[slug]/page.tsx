import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  GLOSSAIRE_ARTICLES,
  GLOSSAIRE_CATEGORY_LABELS,
  getGlossaireArticleBySlug,
} from "@/content/glossaire";

// T-243 — page détail /glossaire/[slug] (Server Component).
//
// Génération statique par slug via generateStaticParams. Pas de fetch DB —
// le registry GLOSSAIRE_ARTICLES est résolu au build time.

export function generateStaticParams() {
  return GLOSSAIRE_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata(
  props: {
    params: Promise<{ slug: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const article = getGlossaireArticleBySlug(params.slug);
  if (!article) {
    return { title: "Glossaire — TerrOir" };
  }
  return {
    title: `${article.title} — Glossaire TerrOir`,
    description: article.excerpt,
  };
}

export default async function GlossaireArticlePage(
  props: {
    params: Promise<{ slug: string }>;
  }
) {
  const params = await props.params;
  const article = getGlossaireArticleBySlug(params.slug);
  if (!article) notFound();

  const Body = article.Body;
  const dateLabel = formatDateLabel(article.last_updated);
  const categoryLabel = GLOSSAIRE_CATEGORY_LABELS[article.category];

  return (
    <article className="bg-white">
      <div className="mx-auto max-w-3xl px-4 py-12 md:py-16">
        <nav
          aria-label="Fil d'Ariane"
          className="mb-6 text-[12px] text-terroir-ink/[0.55]"
        >
          <Link
            href="/glossaire"
            className="hover:text-terra-700 hover:underline underline-offset-2"
          >
            Glossaire
          </Link>
          <span aria-hidden> › </span>
          <span>{categoryLabel}</span>
        </nav>

        <header className="border-b border-terroir-border pb-6 md:pb-8">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terra-700">
            {categoryLabel}
          </span>
          <h1 className="mt-4 font-serif text-[36px] font-medium leading-[1.08] tracking-[-0.01em] text-green-900 md:text-[48px] md:leading-[1.05]">
            {article.title}
          </h1>
          <p className="mt-4 text-[15px] leading-[1.55] text-terroir-ink/[0.72] md:text-base">
            {article.excerpt}
          </p>
          {article.tags.length > 0 && (
            <ul className="mt-5 flex flex-wrap gap-2">
              {article.tags.map((tag) => (
                <li
                  key={tag}
                  className="inline-flex items-center rounded-full border border-terroir-border bg-terroir-bg px-2.5 py-1 text-[11px] uppercase tracking-wider text-terroir-ink/[0.65]"
                >
                  {tag}
                </li>
              ))}
            </ul>
          )}
        </header>

        <div className="prose prose-sm md:prose mt-8 max-w-none text-[15px] leading-[1.7] text-terroir-ink/[0.85] md:text-[16px]">
          <Body />
        </div>

        <footer className="mt-10 border-t border-terroir-border pt-6 text-[12px] leading-[1.5] text-terroir-ink/[0.55]">
          {article.sources.length > 0 && (
            <div>
              <span className="font-semibold uppercase tracking-wider text-terra-700">
                Sources
              </span>
              <ul className="mt-2 space-y-1">
                {article.sources.map((s) => (
                  <li key={s.label}>
                    {s.url ? (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-terra-700 hover:underline underline-offset-2"
                      >
                        {s.label}
                      </a>
                    ) : (
                      s.label
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4">
            Dernière mise à jour&nbsp;: <time dateTime={article.last_updated}>{dateLabel}</time>
          </div>
        </footer>
      </div>
    </article>
  );
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
