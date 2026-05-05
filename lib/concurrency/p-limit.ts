// Helper de concurrence borné — équivalent minimaliste de p-limit, sans
// dépendance externe. Utilisé par les crons (audit RPC M-1) pour éviter
// les boucles séquentielles d'appels Stripe / Resend / DB qui peuvent
// dépasser le timeout Vercel (10s Hobby, 60s Pro).
//
// Pattern : N workers tirent en parallèle des items depuis un curseur partagé,
// chacun appelant `worker(item, index)`. Si le worker throw, l'erreur est
// capturée dans le résultat — on ne casse jamais le batch entier (cohérent
// avec Promise.allSettled).
//
// Usage :
//   const settled = await mapWithConcurrency(rows, 5, async (row) => {
//     return await stripe.refunds.create(...);
//   });
//   settled.forEach((r, i) => {
//     if (r.status === "fulfilled") { ... } else { console.error(r.reason); }
//   });

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  if (items.length === 0) return results;

  let cursor = 0;

  async function pump(): Promise<void> {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      try {
        const value = await worker(items[i] as T, i);
        results[i] = { status: "fulfilled", value };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i += 1) {
    workers.push(pump());
  }
  await Promise.all(workers);
  return results;
}
