// Tests vitest pour mapWithConcurrency — helper de concurrence borné
// utilisé par les crons (audit RPC M-1).

import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "@/lib/concurrency/p-limit";

function defer<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("mapWithConcurrency", () => {
  it("items vide → tableau vide, worker pas appelé", async () => {
    let called = 0;
    const out = await mapWithConcurrency([], 5, async () => {
      called += 1;
      return 1;
    });
    expect(out).toEqual([]);
    expect(called).toBe(0);
  });

  it("results préservent l'ordre d'entrée même si workers terminent en désordre", async () => {
    const out = await mapWithConcurrency(
      [10, 20, 30, 40, 50],
      3,
      // Délais inversés : 50 termine avant 10. mapWithConcurrency doit toujours
      // retourner [10*2, 20*2, ...] dans l'ordre des items.
      (n) => new Promise((resolve) => setTimeout(() => resolve(n * 2), 60 - n)),
    );
    expect(out.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([
      20, 40, 60, 80, 100,
    ]);
  });

  it("cap concurrence respecté : N workers max actifs simultanément", async () => {
    const inflight: number[] = [];
    let active = 0;
    let peak = 0;

    await mapWithConcurrency(
      Array.from({ length: 12 }, (_, i) => i),
      3,
      async (i) => {
        active += 1;
        peak = Math.max(peak, active);
        inflight.push(active);
        // Simule un délai async pour permettre aux workers de se chevaucher.
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
        return i;
      },
    );

    expect(peak).toBe(3);
    expect(inflight.every((n) => n <= 3)).toBe(true);
  });

  it("worker throw → result.status='rejected', autres items traités quand même", async () => {
    const out = await mapWithConcurrency(
      ["ok", "BOOM", "ok2"],
      2,
      async (s) => {
        if (s === "BOOM") throw new Error("oops");
        return s.toUpperCase();
      },
    );
    expect(out[0]).toEqual({ status: "fulfilled", value: "OK" });
    expect(out[1]?.status).toBe("rejected");
    expect((out[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    expect(out[2]).toEqual({ status: "fulfilled", value: "OK2" });
  });

  it("limit > items.length → workerCount clampé à items.length (pas de worker idle)", async () => {
    const out = await mapWithConcurrency([1, 2], 100, async (n) => n * 10);
    expect(out.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([10, 20]);
  });

  it("limit=1 → exécution sérielle, ordre d'invocation == ordre des items", async () => {
    const order: number[] = [];
    const d1 = defer<number>();
    const d2 = defer<number>();

    const promise = mapWithConcurrency([d1, d2], 1, async (deferred, idx) => {
      order.push(idx);
      return await deferred.promise;
    });

    // Tick : seul le worker 0 doit avoir démarré.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([0]);

    d1.resolve(100);
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([0, 1]);

    d2.resolve(200);
    const out = await promise;
    expect(out.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([100, 200]);
  });

  it("worker reçoit l'index correct (utile pour worker-crash logging)", async () => {
    const seen: Array<[string, number]> = [];
    await mapWithConcurrency(["a", "b", "c"], 5, async (item, idx) => {
      seen.push([item, idx]);
      return idx;
    });
    expect(seen.sort((a, b) => a[1] - b[1])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });
});
