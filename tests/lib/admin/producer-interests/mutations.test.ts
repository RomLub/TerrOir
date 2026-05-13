// Tests vitest pour lib/admin/producer-interests/mutations.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  updateProducerInterestStatut,
  deleteProducerInterest,
} from "@/lib/admin/producer-interests/mutations";

type Resp = { data?: unknown; error?: unknown };

let response: Resp;
let captured: {
  fromCalls: string[];
  updates: unknown[];
  deletes: number;
  eqCalls: Array<{ col: string; val: unknown }>;
};

function buildMockClient(): SupabaseClient {
  return {
    from: (table: string) => {
      captured.fromCalls.push(table);
      const builder: Record<string, unknown> & {
        then: (resolve: (v: Resp) => void) => unknown;
      } = {
        then: (resolve: (v: Resp) => void) => {
          resolve(response);
          return undefined;
        },
      };
      builder.update = (payload: unknown) => {
        captured.updates.push(payload);
        return builder;
      };
      builder.delete = () => {
        captured.deletes += 1;
        return builder;
      };
      builder.eq = (col: string, val: unknown) => {
        captured.eqCalls.push({ col, val });
        return builder;
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = { fromCalls: [], updates: [], deletes: 0, eqCalls: [] };
  response = { data: null, error: null };
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  vi.restoreAllMocks();
});

describe("updateProducerInterestStatut", () => {
  it("succès → ok:true", async () => {
    response = { data: null, error: null };
    const res = await updateProducerInterestStatut(buildMockClient(), "id-1", {
      statut: "contacted",
    });
    expect(res).toEqual({ ok: true, data: null });
    expect(captured.fromCalls).toEqual(["producer_interests"]);
    expect(captured.updates[0]).toEqual({ statut: "contacted" });
    expect(captured.eqCalls[0]).toEqual({ col: "id", val: "id-1" });
  });

  it("erreur Supabase → ok:false avec message", async () => {
    response = { data: null, error: { message: "constraint violation" } };
    const res = await updateProducerInterestStatut(buildMockClient(), "id-2", {
      statut: "onboarded",
    });
    expect(res).toEqual({ ok: false, error: "constraint violation" });
  });
});

describe("deleteProducerInterest", () => {
  it("succès → ok:true", async () => {
    response = { data: null, error: null };
    const res = await deleteProducerInterest(buildMockClient(), "id-1");
    expect(res).toEqual({ ok: true, data: null });
    expect(captured.deletes).toBe(1);
    expect(captured.eqCalls[0]).toEqual({ col: "id", val: "id-1" });
  });

  it("erreur Supabase → ok:false avec message", async () => {
    response = { data: null, error: { message: "fk violation" } };
    const res = await deleteProducerInterest(buildMockClient(), "id-2");
    expect(res).toEqual({ ok: false, error: "fk violation" });
  });
});
