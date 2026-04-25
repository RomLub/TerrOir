"use server";

import { revalidateTag } from "next/cache";

// Server action wrapper pour invalider le cache 'public-stats' depuis n'importe
// quel contexte (client ou server). Nécessaire car les Client Components du
// catalogue producteur écrivent directement via supabase-js browser, alors que
// revalidateTag est server-only. Les call sites RPC ce wrapper après un UPDATE
// /INSERT réussi qui peut affecter producersCount, ordersCount ou productsCount.
//
// Fail-safe : un échec d'invalidation ne doit jamais bloquer l'appelant.
export async function revalidatePublicStats(): Promise<void> {
  try {
    revalidateTag("public-stats");
  } catch (e) {
    console.warn(`[STATS_REVAL_WARN] ${(e as Error).message}`);
  }
}
