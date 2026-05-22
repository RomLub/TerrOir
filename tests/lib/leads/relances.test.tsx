import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mocks des dépendances I/O. La logique métier (sélection palier, dedup,
// abandon, idempotence) est testée contre un mock Supabase chaînable.
vi.mock("@/lib/env/urls", () => ({ NEXT_PUBLIC_APP_URL: "https://www.test.fr" }));

const { mockSend, mockGenPrefill, mockGenOptOut, mockLog } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockGenPrefill: vi.fn(),
  mockGenOptOut: vi.fn(),
  mockLog: vi.fn(),
}));
vi.mock("@/lib/resend/send", () => ({ sendTemplate: mockSend }));
vi.mock("@/lib/leads/prefill-token", () => ({ generatePrefillToken: mockGenPrefill }));
vi.mock("@/lib/rgpd/opt-out-token", () => ({ generateOptOutToken: mockGenOptOut }));
vi.mock("@/lib/audit-logs/log-producer-interests-event", () => ({
  logProducerInterestsEvent: mockLog,
}));

import { runLeadsFollowups } from "@/lib/leads/relances";

type Resolver = (state: MockState) => { data: unknown; error: unknown } | undefined;
interface MockState {
  schema: string;
  table: string;
  op: "select" | "insert" | "update" | "delete";
  columns: string | null;
  row: Record<string, unknown> | null;
  filters: Record<string, { op: string; v: unknown }>;
}

function makeClient(resolver: Resolver) {
  const calls: MockState[] = [];
  function builder(schema: string, table: string) {
    const s: MockState = { schema, table, op: "select", columns: null, row: null, filters: {} };
    const b: Record<string, unknown> = {
      select(cols: string) {
        if (s.op === "select") s.columns = cols;
        return b;
      },
      insert(row: Record<string, unknown>) {
        s.op = "insert";
        s.row = row;
        return b;
      },
      update(row: Record<string, unknown>) {
        s.op = "update";
        s.row = row;
        return b;
      },
      eq(k: string, v: unknown) { s.filters[k] = { op: "eq", v }; return b; },
      is(k: string, v: unknown) { s.filters[k] = { op: "is", v }; return b; },
      lt(k: string, v: unknown) { s.filters[k] = { op: "lt", v }; return b; },
      lte(k: string, v: unknown) { s.filters[k] = { op: "lte", v }; return b; },
      in(k: string, v: unknown) { s.filters[k] = { op: "in", v }; return b; },
      then(resolve: (r: unknown) => void, reject: (e: unknown) => void) {
        calls.push({ ...s, filters: { ...s.filters } });
        const r = resolver(s) ?? { data: null, error: null };
        return Promise.resolve(r).then(resolve, reject);
      },
    };
    return b;
  }
  const client = {
    from: (t: string) => builder("public", t),
    schema: (sc: string) => ({ from: (t: string) => builder(sc, t) }),
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
  return { client, calls };
}

const NOW = Date.UTC(2026, 5, 1, 6, 0, 0); // 2026-06-01T06:00:00Z
const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString();

beforeEach(() => {
  mockSend.mockReset().mockResolvedValue({ ok: true, id: "e1" });
  mockGenPrefill.mockReset().mockReturnValue({
    token: "tok-new",
    expiresAt: new Date(NOW + 30 * 86400000),
  });
  mockGenOptOut.mockReset().mockReturnValue({ token: "opt", expiresAt: new Date() });
  mockLog.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

function isEligibleSelect(s: MockState): boolean {
  return (
    s.table === "producer_interests" &&
    s.op === "select" &&
    (s.columns ?? "").includes("current_step")
  );
}
function isAbandonSelect(s: MockState): boolean {
  return (
    s.table === "producer_interests" &&
    s.op === "select" &&
    s.columns === "id, email, created_at"
  );
}

describe("runLeadsFollowups — relances", () => {
  it("lead spontané créé il y a 25j, aucune relance → envoie R3 (plus haut palier dû)", async () => {
    const lead = {
      id: "lead-1",
      prenom: "Jean",
      email: "jean@y.fr",
      created_at: daysAgo(25),
      current_step: 1,
      prefill_token: null,
      prefill_token_expires_at: null,
    };
    const { client, calls } = makeClient((s) => {
      if (isEligibleSelect(s)) return { data: [lead], error: null };
      if (s.table === "producer_interest_followups" && s.op === "select")
        return { data: [], error: null };
      if (isAbandonSelect(s)) return { data: [], error: null };
      return { data: null, error: null };
    });

    const res = await runLeadsFollowups(client, { nowMs: NOW });

    expect(res.relancesSent).toBe(1);
    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend.mock.calls[0][0].template).toBe("lead_relance_3");
    // followup auto inséré avec relance_step=3
    const fuInsert = calls.find(
      (c) => c.table === "producer_interest_followups" && c.op === "insert",
    );
    expect(fuInsert?.row).toMatchObject({ is_automatic: true, relance_step: 3 });
    // current_step bumpé à 4
    const stepUpdate = calls.find(
      (c) => c.table === "producer_interests" && c.op === "update" && c.row?.current_step === 4,
    );
    expect(stepUpdate).toBeTruthy();
    expect(mockLog.mock.calls[0][0].eventType).toBe(
      "producer_interest_auto_relance_sent",
    );
  });

  it("idempotence : les 3 relances déjà envoyées → pas de renvoi (re-run no-op)", async () => {
    const lead = {
      id: "lead-1",
      prenom: null,
      email: "jean@y.fr",
      created_at: daysAgo(25),
      current_step: 4,
      prefill_token: "tok-old",
      prefill_token_expires_at: new Date(NOW + 10 * 86400000).toISOString(),
    };
    const { client } = makeClient((s) => {
      if (isEligibleSelect(s)) return { data: [lead], error: null };
      if (s.table === "producer_interest_followups" && s.op === "select")
        return {
          data: [
            { lead_id: "lead-1", relance_step: 1 },
            { lead_id: "lead-1", relance_step: 2 },
            { lead_id: "lead-1", relance_step: 3 },
          ],
          error: null,
        };
      if (isAbandonSelect(s)) return { data: [], error: null };
      return { data: null, error: null };
    });

    const res = await runLeadsFollowups(client, { nowMs: NOW });
    expect(res.relancesSent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("R1 déjà envoyée à J+11 → envoie R2 (palier suivant dû)", async () => {
    const lead = {
      id: "lead-1",
      prenom: null,
      email: "jean@y.fr",
      created_at: daysAgo(11),
      current_step: 2,
      prefill_token: null,
      prefill_token_expires_at: null,
    };
    const { client } = makeClient((s) => {
      if (isEligibleSelect(s)) return { data: [lead], error: null };
      if (s.table === "producer_interest_followups" && s.op === "select")
        return { data: [{ lead_id: "lead-1", relance_step: 1 }], error: null };
      if (isAbandonSelect(s)) return { data: [], error: null };
      return { data: null, error: null };
    });

    const res = await runLeadsFollowups(client, { nowMs: NOW });
    expect(res.relancesSent).toBe(1);
    expect(mockSend.mock.calls[0][0].template).toBe("lead_relance_2");
  });

  it("lead créé il y a 1j → aucun palier dû", async () => {
    const lead = {
      id: "lead-1",
      prenom: null,
      email: "jean@y.fr",
      created_at: daysAgo(1),
      current_step: 1,
      prefill_token: null,
      prefill_token_expires_at: null,
    };
    const { client } = makeClient((s) => {
      if (isEligibleSelect(s)) return { data: [lead], error: null };
      if (s.table === "producer_interest_followups" && s.op === "select")
        return { data: [], error: null };
      if (isAbandonSelect(s)) return { data: [], error: null };
      return { data: null, error: null };
    });
    const res = await runLeadsFollowups(client, { nowMs: NOW });
    expect(res.relancesSent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("runLeadsFollowups — abandon auto J+40", () => {
  it("lead 45j sans compte/sign-in et sans demande publi → abandonné", async () => {
    const cand = { id: "lead-9", email: "old@y.fr", created_at: daysAgo(45) };
    const { client, calls } = makeClient((s) => {
      if (isEligibleSelect(s)) return { data: [], error: null };
      if (s.table === "producer_interest_followups" && s.op === "select")
        return { data: [], error: null };
      if (isAbandonSelect(s)) return { data: [cand], error: null };
      if (s.schema === "auth" && s.table === "users") return { data: [], error: null };
      if (s.table === "producers" && s.op === "select") return { data: [], error: null };
      return { data: null, error: null };
    });

    const res = await runLeadsFollowups(client, { nowMs: NOW });
    expect(res.abandoned).toBe(1);
    const upd = calls.find(
      (c) => c.table === "producer_interests" && c.op === "update" && c.row?.abandoned_at,
    );
    expect(upd?.row).toMatchObject({ abandoned_reason: "no_sign_in_after_3_relances" });
    expect(mockLog.mock.calls.some((c) => c[0].eventType === "producer_interest_abandoned_auto")).toBe(true);
  });

  it("lead 45j mais a déjà signé in → PAS abandonné", async () => {
    const cand = { id: "lead-9", email: "active@y.fr", created_at: daysAgo(45) };
    const { client, calls } = makeClient((s) => {
      if (isEligibleSelect(s)) return { data: [], error: null };
      if (s.table === "producer_interest_followups" && s.op === "select")
        return { data: [], error: null };
      if (isAbandonSelect(s)) return { data: [cand], error: null };
      if (s.schema === "auth" && s.table === "users")
        return {
          data: [{ id: "u9", email: "active@y.fr", last_sign_in_at: daysAgo(2) }],
          error: null,
        };
      if (s.table === "producers" && s.op === "select")
        return { data: [{ user_id: "u9", publication_requested_at: null }], error: null };
      return { data: null, error: null };
    });

    const res = await runLeadsFollowups(client, { nowMs: NOW });
    expect(res.abandoned).toBe(0);
    expect(
      calls.find((c) => c.table === "producer_interests" && c.op === "update"),
    ).toBeFalsy();
  });
});
