"use server";

import { revalidateTag } from "next/cache";

// Server action wrapper pour invalider le cache 'public-stats' depuis n'importe
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
    revalidateTag("public-stats");
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
