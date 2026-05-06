import type { SupabaseClient } from "@supabase/supabase-js";
import { vi } from "vitest";

// Mock SupabaseClient partagé pour les tests des helpers admin
// catégorisation produit (lib/products/admin/{categories,animals,cuts}).
//
// Pattern aligné sur tests/lib/gms-prices/admin-write.test.ts (helpers
// prennent client en arg → injection directe d'un mock, pas besoin de
// vi.mock du module supabase).
//
// Supporte les patterns query nécessaires :
//   - select(cols).order(...).order(...)            → await builder = list
//   - select(cols).eq(col, val).maybeSingle()       → get
//   - select(cols, {count, head}).eq(col, val)      → countDependencies
//   - insert(payload).select('id').single()         → create
//   - update(payload).eq(col, val)                  → await builder = update
//   - delete().eq(col, val)                         → await builder = delete

export type MockResp = {
  data?: unknown;
  error?: unknown;
  // count peut être null en retour PostgREST quand la table est inaccessible
  // ou que la query échoue partiellement. Les helpers traitent null comme 0.
  count?: number | null;
};

export type MockOp =
  | "select" // list / get
  | "select-count" // countDependencies
  | "insert"
  | "update"
  | "delete";

export type CapturedCalls = {
  fromCalls: string[];
  selects: Array<{ table: string; cols: string; head: boolean }>;
  inserts: Array<{ table: string; payload: unknown }>;
  updates: Array<{ table: string; payload: unknown }>;
  deletes: Array<{ table: string }>;
  eqs: Array<{ table: string; col: string; val: unknown }>;
};

export function makeCaptured(): CapturedCalls {
  return {
    fromCalls: [],
    selects: [],
    inserts: [],
    updates: [],
    deletes: [],
    eqs: [],
  };
}

export class MockBus {
  captured: CapturedCalls = makeCaptured();
  private responses: Record<string, Partial<Record<MockOp, MockResp[]>>> = {};

  push(table: string, op: MockOp, ...resps: MockResp[]) {
    this.responses[table] = this.responses[table] ?? {};
    this.responses[table][op] = [
      ...(this.responses[table][op] ?? []),
      ...resps,
    ];
  }

  consume(table: string, op: MockOp): MockResp {
    const queue = this.responses[table]?.[op];
    if (queue && queue.length > 0) return queue.shift()!;
    // Fallback raisonnable : succès vide. La plupart des tests pushent
    // explicitement un résultat, ce fallback évite juste un crash si oubli.
    return { data: null, error: null };
  }

  reset() {
    this.captured = makeCaptured();
    this.responses = {};
  }

  buildClient(): SupabaseClient {
    const bus = this;
    return {
      from: (table: string) => {
        bus.captured.fromCalls.push(table);
        let op: MockOp = "select";
        let isCount = false;
        // Use any here: simulating PostgREST builder is impossible to type
        // accurately — the prod code does the type assertions itself.
        const builder: Record<string, unknown> = {};
        builder.select = (
          cols: string,
          opts?: { count?: string; head?: boolean },
        ) => {
          bus.captured.selects.push({
            table,
            cols,
            head: !!opts?.head,
          });
          if (opts?.count === "exact" && opts?.head) {
            isCount = true;
          }
          return builder;
        };
        builder.insert = (payload: unknown) => {
          op = "insert";
          bus.captured.inserts.push({ table, payload });
          return builder;
        };
        builder.update = (payload: unknown) => {
          op = "update";
          bus.captured.updates.push({ table, payload });
          return builder;
        };
        builder.delete = () => {
          op = "delete";
          bus.captured.deletes.push({ table });
          return builder;
        };
        builder.eq = (col: string, val: unknown) => {
          bus.captured.eqs.push({ table, col, val });
          return builder;
        };
        builder.order = () => builder;
        builder.maybeSingle = () =>
          Promise.resolve(bus.consume(table, op));
        builder.single = () => Promise.resolve(bus.consume(table, op));
        // Thenable pour await direct (list, count, update, delete).
        // Les ops insert/select-via-single ne passent pas par then.
        builder.then = (onF: (r: MockResp) => unknown) =>
          Promise.resolve(
            bus.consume(table, isCount ? "select-count" : op),
          ).then(onF);
        return builder;
      },
    } as unknown as SupabaseClient;
  }
}

// Helper pour spy sur console.error/warn dans tous les tests, pattern
// partagé avec admin-write.test.ts.
export function silenceConsole() {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  return { errorSpy, warnSpy };
}
