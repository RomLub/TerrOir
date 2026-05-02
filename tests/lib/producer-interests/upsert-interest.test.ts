// Tests vitest pour lib/producer-interests/upsert-interest.ts —
// création + UPSERT sur conflit email.
//
// Stratégie : mock SupabaseClient injecté via argument (pattern aligné
// tests/lib/stock-alerts/create-alert.test.ts). Capture les appels
// from/insert/update/select/eq/single dans `captured` et permet
// d'enqueuer des réponses par (table, op).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { upsertProducerInterest } from "@/lib/producer-interests/upsert-interest";

type Resp = { data?: unknown; error?: unknown };
type Op = "select" | "update" | "insert" | "pending";

type Captured = {
  fromCalls: string[];
  selects: Array<{ table: string; cols: string }>;
  updates: Array<{ table: string; payload: unknown }>;
  inserts: Array<{ table: string; payload: unknown }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
  ilikeCalls: Array<{ table: string; col: string; val: unknown }>;
};

let captured: Captured;
let responses: Record<
  string,
  Partial<Record<"select" | "update" | "insert", Resp[]>>
>;

function consume(table: string, op: Op): Resp {
  if (op !== "pending") {
    const queue = responses[table]?.[op];
    if (queue && queue.length > 0) return queue.shift()!;
  }
  return { data: null, error: null };
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
      builder.ilike = (col: string, val: unknown) => {
        captured.ilikeCalls.push({ table, col, val });
        return builder;
      };
      builder.single = () => Promise.resolve(consume(table, builder._op));
      return builder;
    },
  } as unknown as SupabaseClient;
}

const ROW_ID = "row-uuid-1";
const VALID_INPUT = {
  prenom: "Jean",
  nom: "Dupont",
  email: "jean.dupont@example.com",
  telephone: "0612345678",
  nom_exploitation: "Ferme du Pré",
  commune: "Le Mans",
  message: "Je veux rejoindre",
};

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = {
    fromCalls: [],
    selects: [],
    updates: [],
    inserts: [],
    eqCalls: [],
    ilikeCalls: [],
  };
  responses = {};
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("upsertProducerInterest — INSERT initial (pas de row existant)", () => {
  it("succès → ok:true + status='created' + id, payload INSERT correct", async () => {
    pushResp("producer_interests", "insert", {
      data: { id: ROW_ID },
      error: null,
    });
    const client = buildMockClient();
    const res = await upsertProducerInterest(client, VALID_INPUT);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.id).toBe(ROW_ID);
    expect(res.data.status).toBe("created");
    // Payload INSERT inclut tous les champs business + statut='new'
    const payload = captured.inserts[0].payload as Record<string, unknown>;
    expect(payload.prenom).toBe("Jean");
    expect(payload.nom).toBe("Dupont");
    expect(payload.email).toBe("jean.dupont@example.com");
    expect(payload.telephone).toBe("0612345678");
    expect(payload.nom_exploitation).toBe("Ferme du Pré");
    expect(payload.commune).toBe("Le Mans");
    expect(payload.message).toBe("Je veux rejoindre");
    expect(payload.statut).toBe("new");
    // Pas d'UPDATE déclenché
    expect(captured.updates).toHaveLength(0);
  });

  it("normalisation email : trim + lowercase avant INSERT (defense-in-depth)", async () => {
    pushResp("producer_interests", "insert", {
      data: { id: ROW_ID },
      error: null,
    });
    const client = buildMockClient();
    await upsertProducerInterest(client, {
      ...VALID_INPUT,
      email: "  Jean.Dupont@Example.COM  ",
    });
    const payload = captured.inserts[0].payload as Record<string, unknown>;
    expect(payload.email).toBe("jean.dupont@example.com");
  });

  it("message null accepté tel quel dans le payload", async () => {
    pushResp("producer_interests", "insert", {
      data: { id: ROW_ID },
      error: null,
    });
    const client = buildMockClient();
    await upsertProducerInterest(client, { ...VALID_INPUT, message: null });
    const payload = captured.inserts[0].payload as Record<string, unknown>;
    expect(payload.message).toBeNull();
  });

  it("erreur DB non-conflit → ok:false + error.message + console.error, pas de fallback UPDATE", async () => {
    pushResp("producer_interests", "insert", {
      data: null,
      error: { message: "connection lost", code: "08000" },
    });
    const client = buildMockClient();
    const res = await upsertProducerInterest(client, VALID_INPUT);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("connection lost");
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(captured.fromCalls).toEqual(["producer_interests"]); // pas de fallback UPDATE
    expect(captured.updates).toHaveLength(0);
  });

  it("INSERT renvoie data=null sans error → ok:true (le helper se fie à errCode)", async () => {
    // Cas dégénéré : Supabase ne devrait jamais retourner data=null sans error
    // sur .single() avec INSERT. Mais si ça arrive, on veut au moins un
    // comportement défini : helper bascule UPDATE car !insertError évalue
    // false (insertError null) → la branche succès demande aussi `inserted`
    // truthy. Si null, on tombe dans la branche conflit avec errCode
    // undefined, donc retour ok:false generic.
    pushResp("producer_interests", "insert", {
      data: null,
      error: null,
    });
    const client = buildMockClient();
    const res = await upsertProducerInterest(client, VALID_INPUT);
    expect(res.ok).toBe(false);
  });
});

describe("upsertProducerInterest — conflit UNIQUE (email déjà présent)", () => {
  it("conflit 23505 → UPDATE granulaire + status='updated', payload UPDATE ne contient PAS statut/source/created_at/especes", async () => {
    pushResp("producer_interests", "insert", {
      data: null,
      error: { message: "duplicate key value", code: "23505" },
    });
    pushResp("producer_interests", "update", {
      data: { id: ROW_ID },
      error: null,
    });
    const client = buildMockClient();
    const res = await upsertProducerInterest(client, VALID_INPUT);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.id).toBe(ROW_ID);
    expect(res.data.status).toBe("updated");
    // T-110 : UPDATE matche sur email via .ilike (case-insensitive),
    // pas .eq. Le helper normalise déjà côté input mais .ilike garantit
    // que la WHERE matche aussi des rows historiques en casse mixte.
    expect(captured.ilikeCalls).toEqual([
      { table: "producer_interests", col: "email", val: "jean.dupont@example.com" },
    ]);
    expect(
      captured.eqCalls.find(
        (c) => c.table === "producer_interests" && c.col === "email",
      ),
    ).toBeUndefined();
    // Payload UPDATE : champs business présents, champs préservés ABSENTS
    const payload = captured.updates[0].payload as Record<string, unknown>;
    expect(payload.prenom).toBe("Jean");
    expect(payload.nom).toBe("Dupont");
    expect(payload.telephone).toBe("0612345678");
    expect(payload.nom_exploitation).toBe("Ferme du Pré");
    expect(payload.commune).toBe("Le Mans");
    expect(payload.message).toBe("Je veux rejoindre");
    // Champs PRÉSERVÉS (pas dans le payload)
    expect(payload).not.toHaveProperty("statut");
    expect(payload).not.toHaveProperty("source");
    expect(payload).not.toHaveProperty("created_at");
    expect(payload).not.toHaveProperty("especes");
    expect(payload).not.toHaveProperty("email"); // email non mis à jour, sert juste de match
    expect(captured.fromCalls).toEqual([
      "producer_interests",
      "producer_interests",
    ]);
  });

  it("conflit 23505 puis UPDATE échoue → ok:false + console.error", async () => {
    pushResp("producer_interests", "insert", {
      data: null,
      error: { message: "duplicate key value", code: "23505" },
    });
    pushResp("producer_interests", "update", {
      data: null,
      error: { message: "permission denied", code: "42501" },
    });
    const client = buildMockClient();
    const res = await upsertProducerInterest(client, VALID_INPUT);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("permission denied");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("conflit 23505 puis UPDATE retourne data=null sans error → ok:false (cas dégénéré)", async () => {
    pushResp("producer_interests", "insert", {
      data: null,
      error: { message: "duplicate key value", code: "23505" },
    });
    pushResp("producer_interests", "update", {
      data: null,
      error: null,
    });
    const client = buildMockClient();
    const res = await upsertProducerInterest(client, VALID_INPUT);
    expect(res.ok).toBe(false);
  });
});
