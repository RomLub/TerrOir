// Tests vitest pour lib/gms-prices/admin-write.ts — Phase B (interface admin).
//
// Stratégie : helpers prennent SupabaseClient en argument → on injecte un
// mock client qui capture toutes les opérations (from/insert/update/eq/select/
// single) et permet d'enqueuer des réponses par (table, op). Pas besoin de
// mocker @/lib/supabase/admin (les helpers ne l'instancient pas eux-mêmes).
//
// Pattern aligné sur tests/app/api/admin/producers/invite/route.test.ts mais
// simplifié (pas d'auth/email/lead — juste des opérations DB).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import {
  createGmsPrice,
  updateGmsPrice,
  archiveGmsPrice,
  recordMonthlyUpdate,
  type GmsPriceCreateInput,
  type GmsPriceUpdateInput,
  type GmsPriceMonthlyUpdateInput,
} from "@/lib/gms-prices/admin-write";

type Resp = { data?: unknown; error?: unknown };
type Op = "select" | "update" | "insert" | "pending";

type Captured = {
  fromCalls: string[];
  selects: Array<{ table: string; cols: string }>;
  updates: Array<{ table: string; payload: unknown }>;
  inserts: Array<{ table: string; payload: unknown }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
};

let captured: Captured;
let responses: Record<
  string,
  Partial<Record<"select" | "update" | "insert", Resp[]>>
>;

function defaultResp(_table: string, _op: Op): Resp {
  return { data: null, error: null };
}

function consume(table: string, op: Op): Resp {
  if (op !== "pending") {
    const queue = responses[table]?.[op];
    if (queue && queue.length > 0) return queue.shift()!;
  }
  return defaultResp(table, op);
}

function pushResp(
  table: string,
  op: "select" | "update" | "insert",
  ...resps: Resp[]
) {
  responses[table] = responses[table] ?? {};
  responses[table][op] = [...(responses[table][op] ?? []), ...resps];
}

function buildMockClient(): SupabaseClient {
  return {
    from: (table: string) => {
      captured.fromCalls.push(table);
      const builder: Record<string, unknown> & { _op: Op } = { _op: "pending" };
      builder.select = (cols: string) => {
        captured.selects.push({ table, cols });
        if (builder._op === "pending") builder._op = "select";
        return builder;
      };
      builder.update = (payload: unknown) => {
        captured.updates.push({ table, payload });
        builder._op = "update";
        return builder;
      };
      builder.insert = (payload: unknown) => {
        captured.inserts.push({ table, payload });
        builder._op = "insert";
        return builder;
      };
      builder.eq = (col: string, val: unknown) => {
        captured.eqCalls.push({ table, col, val });
        return builder;
      };
      builder.single = () => Promise.resolve(consume(table, builder._op));
      builder.maybeSingle = () => Promise.resolve(consume(table, builder._op));
      builder.then = (onFulfilled: (r: Resp) => unknown) =>
        onFulfilled(consume(table, builder._op));
      return builder;
    },
  } as unknown as SupabaseClient;
}

const ADMIN_ID = "admin-uuid-1";
const REF_ID = "ref-uuid-1";

const VALID_CREATE: GmsPriceCreateInput = {
  slug: "test-ref",
  filiere: "bovin",
  libelle: "Test ref",
  description_courte: "desc",
  prix_gms_kg: 12.5,
  prix_terroir_kg_min: 16.0,
  prix_terroir_kg_max: 22.0,
  prix_terroir_kg_moyen: 19.0,
  mois_reference: "2026-04",
  source: "Test source",
  source_url: null,
  ordre_affichage: 1,
  notes_admin: null,
};

const VALID_UPDATE: GmsPriceUpdateInput = {
  libelle: "Test ref updated",
  description_courte: "desc updated",
  source: "Test source updated",
  source_url: "https://example.com",
  ordre_affichage: 2,
  notes_admin: "note",
};

const VALID_MONTHLY: GmsPriceMonthlyUpdateInput = {
  prix_gms_kg: 13.5,
  prix_terroir_kg_min: 17.0,
  prix_terroir_kg_max: 23.0,
  prix_terroir_kg_moyen: 20.0,
  mois_reference: "2026-05",
  source: "Test source 2026-05",
  source_url: null,
};

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = {
    fromCalls: [],
    selects: [],
    updates: [],
    inserts: [],
    eqCalls: [],
  };
  responses = {};
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createGmsPrice", () => {
  it("succès → ok:true + id retourné, payload contient updated_by + active=true", async () => {
    pushResp("gms_prices", "insert", {
      data: { id: REF_ID },
      error: null,
    });
    const client = buildMockClient();
    const res = await createGmsPrice(client, VALID_CREATE, ADMIN_ID);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.id).toBe(REF_ID);
    expect(captured.inserts).toHaveLength(1);
    const payload = captured.inserts[0].payload as Record<string, unknown>;
    expect(payload.slug).toBe("test-ref");
    expect(payload.filiere).toBe("bovin");
    expect(payload.updated_by).toBe(ADMIN_ID);
    expect(payload.active).toBe(true);
  });

  it("DB error → ok:false + error.message, console.error", async () => {
    pushResp("gms_prices", "insert", {
      data: null,
      error: { message: "constraint violation" },
    });
    const client = buildMockClient();
    const res = await createGmsPrice(client, VALID_CREATE, ADMIN_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("constraint violation");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("DB renvoie data=null sans error → ok:false (cas dégénéré)", async () => {
    pushResp("gms_prices", "insert", { data: null, error: null });
    const client = buildMockClient();
    const res = await createGmsPrice(client, VALID_CREATE, ADMIN_ID);
    expect(res.ok).toBe(false);
  });
});

describe("updateGmsPrice", () => {
  it("succès → ok:true, payload inclut updated_by + updated_at + champs édition", async () => {
    pushResp("gms_prices", "update", { data: null, error: null });
    const client = buildMockClient();
    const res = await updateGmsPrice(client, REF_ID, VALID_UPDATE, ADMIN_ID);
    expect(res.ok).toBe(true);
    expect(captured.updates).toHaveLength(1);
    const payload = captured.updates[0].payload as Record<string, unknown>;
    expect(payload.libelle).toBe("Test ref updated");
    expect(payload.updated_by).toBe(ADMIN_ID);
    expect(typeof payload.updated_at).toBe("string");
    // slug, filiere, prix_*, active intentionnellement absents (cf. A3)
    expect(payload.slug).toBeUndefined();
    expect(payload.filiere).toBeUndefined();
    expect(payload.prix_gms_kg).toBeUndefined();
    expect(payload.active).toBeUndefined();
    // eq sur id
    expect(captured.eqCalls).toContainEqual({
      table: "gms_prices",
      col: "id",
      val: REF_ID,
    });
  });

  it("DB error → ok:false + error.message", async () => {
    pushResp("gms_prices", "update", {
      data: null,
      error: { message: "row not found" },
    });
    const client = buildMockClient();
    const res = await updateGmsPrice(client, REF_ID, VALID_UPDATE, ADMIN_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("row not found");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe("archiveGmsPrice", () => {
  it("active=false → payload.active=false + updated_by", async () => {
    pushResp("gms_prices", "update", { data: null, error: null });
    const client = buildMockClient();
    const res = await archiveGmsPrice(client, REF_ID, false, ADMIN_ID);
    expect(res.ok).toBe(true);
    const payload = captured.updates[0].payload as Record<string, unknown>;
    expect(payload.active).toBe(false);
    expect(payload.updated_by).toBe(ADMIN_ID);
    expect(typeof payload.updated_at).toBe("string");
  });

  it("active=true (réactivation) → payload.active=true", async () => {
    pushResp("gms_prices", "update", { data: null, error: null });
    const client = buildMockClient();
    const res = await archiveGmsPrice(client, REF_ID, true, ADMIN_ID);
    expect(res.ok).toBe(true);
    const payload = captured.updates[0].payload as Record<string, unknown>;
    expect(payload.active).toBe(true);
  });

  it("DB error → ok:false", async () => {
    pushResp("gms_prices", "update", {
      data: null,
      error: { message: "db down" },
    });
    const client = buildMockClient();
    const res = await archiveGmsPrice(client, REF_ID, false, ADMIN_ID);
    expect(res.ok).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe("recordMonthlyUpdate (workflow update mensuel atomicité applicative)", () => {
  it("UPDATE live OK + INSERT history OK → ok:true + history_recorded=true", async () => {
    pushResp("gms_prices", "update", { data: null, error: null });
    pushResp("gms_prices_history", "insert", { data: null, error: null });
    const client = buildMockClient();
    const res = await recordMonthlyUpdate(
      client,
      REF_ID,
      VALID_MONTHLY,
      ADMIN_ID,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.history_recorded).toBe(true);

    // Ordre des opérations : UPDATE live D'ABORD, puis INSERT history.
    expect(captured.fromCalls).toEqual(["gms_prices", "gms_prices_history"]);

    // Payload UPDATE live : prix_* + mois_reference + source + updated_by
    const livePayload = captured.updates[0].payload as Record<string, unknown>;
    expect(livePayload.prix_gms_kg).toBe(13.5);
    expect(livePayload.mois_reference).toBe("2026-05");
    expect(livePayload.updated_by).toBe(ADMIN_ID);
    expect(typeof livePayload.updated_at).toBe("string");

    // Payload INSERT history : reference_id + prix subset + mois + source
    const historyPayload = captured.inserts[0].payload as Record<
      string,
      unknown
    >;
    expect(historyPayload.reference_id).toBe(REF_ID);
    expect(historyPayload.prix_gms_kg).toBe(13.5);
    expect(historyPayload.prix_terroir_kg_moyen).toBe(20.0);
    expect(historyPayload.mois_reference).toBe("2026-05");
    // history n'a pas de updated_by ni de prix_terroir_kg_min/max (schema)
    expect(historyPayload.updated_by).toBeUndefined();
    expect(historyPayload.prix_terroir_kg_min).toBeUndefined();
    expect(historyPayload.prix_terroir_kg_max).toBeUndefined();
  });

  it("UPDATE live FAIL → ok:false, INSERT history JAMAIS tenté", async () => {
    pushResp("gms_prices", "update", {
      data: null,
      error: { message: "live update fail" },
    });
    const client = buildMockClient();
    const res = await recordMonthlyUpdate(
      client,
      REF_ID,
      VALID_MONTHLY,
      ADMIN_ID,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("live update fail");
    // Pas d'INSERT history (sortie immédiate)
    expect(captured.fromCalls).toEqual(["gms_prices"]);
    expect(captured.inserts).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("UPDATE live OK + INSERT history FAIL → ok:true + history_recorded=false (warning)", async () => {
    pushResp("gms_prices", "update", { data: null, error: null });
    pushResp("gms_prices_history", "insert", {
      data: null,
      error: { message: "unique constraint" },
    });
    const client = buildMockClient();
    const res = await recordMonthlyUpdate(
      client,
      REF_ID,
      VALID_MONTHLY,
      ADMIN_ID,
    );
    // Live OK côté public → on retourne ok:true mais signale history_recorded=false
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.history_recorded).toBe(false);
    expect(captured.fromCalls).toEqual(["gms_prices", "gms_prices_history"]);
    expect(consoleWarnSpy).toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
