import { notFound } from "next/navigation";
import { ProductFallback } from "@/components/ui/product-fallback";

// Page de démo temporaire pour la relecture visuelle PR3 audit photos.
// Affiche les 8 icônes catégorie côte à côte dans ProductFallback,
// en taille réelle (card 4/3) et en grand (carré).
//
// Gating : process.env.VERCEL_ENV === "production" → notFound() (404).
// Accessible en dev local (npm run dev, VERCEL_ENV undefined) et sur
// les previews Vercel (VERCEL_ENV="preview"), masquée en production
// (VERCEL_ENV="production"). NODE_ENV n'aurait PAS suffi : Vercel pose
// NODE_ENV=production sur preview ET sur prod.
//
// À supprimer une fois la relecture visuelle PR3 validée.

const CATEGORIES = [
  { slug: "viande", label: "Viande" },
  { slug: "charcuterie", label: "Charcuterie" },
  { slug: "legumes", label: "Légumes" },
  { slug: "fromages", label: "Fromages" },
  { slug: "miel", label: "Miel" },
  { slug: "oeufs", label: "Œufs" },
  { slug: "autres", label: "Autres" },
  { slug: null, label: "Fallback (catégorie inconnue)" },
] as const;

export default function IconsPreviewPage() {
  if (process.env.VERCEL_ENV === "production") notFound();

  return (
    <div className="min-h-screen bg-bg p-6 md:p-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-12">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terra-700">
            Dev preview · à supprimer après validation
          </span>
          <h1 className="mt-2 font-serif text-[40px] leading-tight text-green-900">
            Icônes catégories produits
          </h1>
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-dark/70">
            Aperçu des 8 SVG inline dans le composant{" "}
            <code className="rounded bg-dark/5 px-1.5 py-0.5">ProductFallback</code>.
            Trait <code className="rounded bg-dark/5 px-1.5 py-0.5">terra-800</code>{" "}
            sur fond <code className="rounded bg-dark/5 px-1.5 py-0.5">terra-100</code>.
            Cette page n&apos;est servie qu&apos;en dev local et sur les
            previews Vercel (masquée en production via{" "}
            <code className="rounded bg-dark/5 px-1.5 py-0.5">VERCEL_ENV</code>).
          </p>
        </header>

        <section className="mb-16">
          <h2 className="mb-2 font-serif text-[24px] text-green-900">
            1. Taille card (aspect 4/3, ProductCard standard)
          </h2>
          <p className="mb-6 text-[13px] text-dark/60">
            Rendu réel dans une grille de produits sans photo.
          </p>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4">
            {CATEGORIES.map((cat) => (
              <div key={cat.slug ?? "fallback"} className="space-y-2">
                <ProductFallback
                  category={cat.slug ?? undefined}
                  className="aspect-4/3 w-full rounded-2xl"
                />
                <p className="text-center font-mono text-[13px] text-dark/70">
                  {cat.label}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 font-serif text-[24px] text-green-900">
            2. Taille agrandie (carré, icône à 50% de la box)
          </h2>
          <p className="mb-6 text-[13px] text-dark/60">
            Pour examen détaillé du dessin SVG : trait, proportions,
            équilibre visuel.
          </p>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {CATEGORIES.map((cat) => (
              <div key={cat.slug ?? "fallback"} className="space-y-3">
                <ProductFallback
                  category={cat.slug ?? undefined}
                  className="aspect-square w-full rounded-2xl"
                  iconClassName="h-1/2 w-1/2 text-terra-800"
                />
                <p className="text-center font-mono text-[14px] text-dark/70">
                  <strong>{cat.label}</strong>
                  <span className="text-dark/40">
                    {" "}
                    · slug = {cat.slug ?? "null"}
                  </span>
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
