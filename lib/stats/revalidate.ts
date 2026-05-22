"use server";

import { revalidateTag } from "next/cache";

// Server action wrapper pour invalider les caches publics depuis n'importe
// quel contexte (client ou server). Nécessaire car les Client Components du
// catalogue producteur écrivent directement via supabase-js browser, alors que
// revalidateTag est server-only. Les call sites RPC ce wrapper après un UPDATE
// /INSERT réussi qui peut affecter producersCount, ordersCount ou productsCount.
//
// T-100 C2 : signature enrichie avec contexte structuré pour parsing logs
// forensique. `source` requis (kebab-case, identifie l'appelant), `orderId`
// optionnel quand applicable, `extra` optionnel pour sous-classification.
//
// Format warn unifié :
//   [STATS_REVAL_WARN] source=<source> orderId=<id|none> [key1=val1 ...] <err>
//
// `orderId=none` est explicite (pas omis) pour parsing prévisible. Les paires
// `extra` sont sérialisées key=value insérées entre orderId et err.message.
//
// Fail-safe : un échec d'invalidation ne doit jamais bloquer l'appelant. Tout
// est swallowé en interne — les call sites n'ont pas besoin de wrapper try/catch
// externe (cf C2 Option A : dead code redondant supprimé).
export async function revalidatePublicStats(opts: {
  source: string;
  orderId?: string;
  extra?: Record<string, string>;
}): Promise<void> {
  try {
    revalidateTag("public-stats", "max");
  } catch (e) {
    const parts: string[] = [
      `[STATS_REVAL_WARN]`,
      `source=${opts.source}`,
      `orderId=${opts.orderId ?? "none"}`,
    ];
    if (opts.extra) {
      for (const [k, v] of Object.entries(opts.extra)) {
        parts.push(`${k}=${v}`);
      }
    }
    parts.push((e as Error).message);
    console.warn(parts.join(" "));
  }
}

// Audit Vercel C-5 (2026-05-05) : invalidation du cache 'public-products'
// (route /produits passée de force-dynamic à revalidate=60 + tag). Appelée
// par les mutations catalogue (create/update/toggle actif) pour forcer un
// refresh immédiat sans attendre les 60s de revalidate. Même fail-safe que
// revalidatePublicStats : un échec d'invalidation ne bloque jamais
// l'appelant.
export async function revalidatePublicProducts(opts: {
  source: string;
  productId?: string;
  extra?: Record<string, string>;
}): Promise<void> {
  try {
    revalidateTag("public-products", "max");
  } catch (e) {
    const parts: string[] = [
      `[PRODUCTS_REVAL_WARN]`,
      `source=${opts.source}`,
      `productId=${opts.productId ?? "none"}`,
    ];
    if (opts.extra) {
      for (const [k, v] of Object.entries(opts.extra)) {
        parts.push(`${k}=${v}`);
      }
    }
    parts.push((e as Error).message);
    console.warn(parts.join(" "));
  }
}

// Variante pour le cache producer partial (header + bio) sur la fiche
// /producteurs/[slug]. Tag par slug pour invalider précisément un seul
// producteur lors d'un changement de bio/photos depuis ma-page.
export async function revalidateProducerCard(opts: {
  slug: string;
  source: string;
}): Promise<void> {
  try {
    revalidateTag(`producer:${opts.slug}`, "max");
  } catch (e) {
    console.warn(
      `[PRODUCER_REVAL_WARN] source=${opts.source} slug=${opts.slug} ${(e as Error).message}`,
    );
  }
}

// F-047 (audit pré-launch 2026-05) : invalidation du cache des reviews
// affichées sur la fiche /producteurs/[slug]. Appelée depuis le flow
// producer-reviews-respond (create/update/delete) ET depuis le flow
// consumer review submit. TTL côté page = 30s, mais ce tag permet la
// propagation immédiate.
export async function revalidateProducerReviews(opts: {
  slug: string;
  source: string;
}): Promise<void> {
  try {
    revalidateTag(`producer-reviews:${opts.slug}`, "max");
  } catch (e) {
    console.warn(
      `[PRODUCER_REVIEWS_REVAL_WARN] source=${opts.source} slug=${opts.slug} ${(e as Error).message}`,
    );
  }
}

// F-047 : invalidation du cache des produits affichés sur la fiche
// /producteurs/[slug]. Appelée depuis le flow producer catalogue
// (create/update/toggle actif). Distinct de `public-products` qui couvre
// /produits (page liste).
export async function revalidateProducerProducts(opts: {
  slug: string;
  source: string;
}): Promise<void> {
  try {
    revalidateTag(`producer-products:${opts.slug}`, "max");
  } catch (e) {
    console.warn(
      `[PRODUCER_PRODUCTS_REVAL_WARN] source=${opts.source} slug=${opts.slug} ${(e as Error).message}`,
    );
  }
}

// Page /livraison (P0 légales 2026-05-06) : carte SVG des départements
// couverts. Le tag est invalidé quand un producer change d'état public
// (devient public, retire son catalogue, suppression RGPD). Le wiring
// dans les flows producer existants n'est pas posé dans cette PR : la
// carte tolère un délai jusqu'à 10 min (revalidate par défaut), suffisant
// pour le besoin actuel. À câbler en même temps que le bouton publish/
// unpublish producer si la latence devient gênante.
export async function revalidateCoverageDepartments(opts: {
  source: string;
  producerId?: string;
}): Promise<void> {
  try {
    revalidateTag("coverage-departments", "max");
  } catch (e) {
    console.warn(
      `[COVERAGE_REVAL_WARN] source=${opts.source} producerId=${opts.producerId ?? "none"} ${(e as Error).message}`,
    );
  }
}

// F-021 (audit pré-launch 2026-05 + verification 2026-05-11) : invalidation
// du cache de la RPC `search_producers` wrap dans
// `lib/producers/search-producers-cached.ts`. Appelée après toute mutation
// qui change l'état visible côté search :
//   - producer self-update / admin update (especes, labels, statut
//     public/pending qui entrent dans le ranking/filtrage).
//   - product create / update / toggle active (impacte la sous-requête
//     corrélée `count(*) FROM products WHERE active=true` retournée par
//     la RPC).
// TTL côté wrapper = 60s, donc fail-safe si un flow oublie l'invalidation.
export async function revalidateProducersSearch(opts: {
  source: string;
  producerId?: string;
  extra?: Record<string, string>;
}): Promise<void> {
  try {
    revalidateTag("producers-search", "max");
  } catch (e) {
    const parts: string[] = [
      `[PRODUCERS_SEARCH_REVAL_WARN]`,
      `source=${opts.source}`,
      `producerId=${opts.producerId ?? "none"}`,
    ];
    if (opts.extra) {
      for (const [k, v] of Object.entries(opts.extra)) {
        parts.push(`${k}=${v}`);
      }
    }
    parts.push((e as Error).message);
    console.warn(parts.join(" "));
  }
}
