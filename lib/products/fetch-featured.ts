import "server-only";
import { unstable_cache } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ProductCardData } from "@/components/ui/product-card";
import { STOCK_UNLIMITED_SENTINEL } from "@/lib/products/constants";

// Audit Vercel H-6 (2026-05-05) : remplace lib/mocks/featured-products.
//
// Sélection : les N derniers produits actifs (created_at DESC) chez les
// producers en statut='public' AND deleted_at IS NULL. Inner join inverse
// sur producers (idem fetchPublicProducts pattern) — sinon le client admin
// (service_role) bypass la RLS et exposerait les produits de producers en
// draft sur la home.
//
// Cache 10 min + tag 'featured-products' : le mix de produits affiché en
// home évolue rarement (un nouveau produit par jour côté MVP). Tolère 10
// min de retard. Le tag autorise une invalidation ciblée à l'avenir si on
// veut forcer un refresh sur publication d'un produit "vedette".
//
// Fail-open : si la query throw, on retourne [] (le composant rend un
// section vide, bordel UI minimal). Cohérent avec getPublicStats.

const FEATURED_LIMIT = 4;

export type FeaturedProductCard = ProductCardData & {
  /** Slug du producteur — requis pour construire l'URL canonique
   * /producteurs/[slug]/produits/[id] sur le wrapping Link de la home. */
  producerSlug: string;
};

type RawRow = {
  id: string;
  nom: string;
  prix: number | string;
  unite: string | null;
  photos: string[] | null;
  stock_disponible: number | null;
  stock_illimite: boolean | null;
  product_categories: { name: string } | { name: string }[] | null;
  animals: { name: string } | { name: string }[] | null;
  cuts: { name: string } | { name: string }[] | null;
  producers:
    | { nom_exploitation: string; slug: string; commune: string | null }
    | { nom_exploitation: string; slug: string; commune: string | null }[];
};

function pickFirst<T>(v: T | T[] | null): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

async function fetchFeaturedRaw(): Promise<FeaturedProductCard[]> {
  const admin = createSupabaseAdminClient();
  try {
    const { data, error } = await admin
      .from("products")
      .select(
        `id, nom, prix, unite, photos, stock_disponible, stock_illimite,
         product_categories(name),
         animals(name),
         cuts(name),
         producers!inner(nom_exploitation, slug, commune, statut, deleted_at)`,
      )
      .eq("active", true)
      .eq("producers.statut", "public")
      .is("producers.deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(FEATURED_LIMIT);

    if (error) {
      console.error("[FEATURED_PRODUCTS_ERR]", error.message);
      return [];
    }

    const rows = ((data ?? []) as RawRow[])
      .map((p): FeaturedProductCard | null => {
        const producer = pickFirst(p.producers);
        if (!producer?.slug) return null;
        const cut = pickFirst(p.cuts);
        const animal = pickFirst(p.animals);
        const category = pickFirst(p.product_categories);
        const stockLeft = p.stock_illimite ? STOCK_UNLIMITED_SENTINEL : (p.stock_disponible ?? 0);
        return {
          id: p.id,
          name: p.nom,
          price: Number(p.prix),
          unit: p.unite ?? undefined,
          stockLeft,
          producer: `${producer.nom_exploitation}${producer.commune ? ` — ${producer.commune}` : ""}`,
          producerSlug: producer.slug,
          // ProductCard affiche un seul badge — priorité cut > animal >
          // category, cohérent avec /produits.
          category: cut?.name ?? animal?.name ?? category?.name ?? undefined,
          image: Array.isArray(p.photos) && p.photos.length > 0 ? p.photos[0] : null,
        };
      });

    return rows.filter((r): r is FeaturedProductCard => r !== null);
  } catch (err) {
    console.error("[FEATURED_PRODUCTS_ERR]", err);
    return [];
  }
}

export const getFeaturedProducts = unstable_cache(
  fetchFeaturedRaw,
  ["featured-products"],
  {
    revalidate: 600,
    tags: ["featured-products"],
  },
);
