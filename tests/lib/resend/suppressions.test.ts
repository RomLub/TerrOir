// Vitest pour lib/resend/suppressions.ts (Audit Email H-3 + M-5, 2026-05-05).
//
// Couverture :
//   - canSendTo : email absent table, email présent (chaque reason),
//     normalisation case+trim, error DB → fail-open (return true).
//   - addSuppression : UPSERT (PK email), reason+source_resend_id pass-through,
//     erreur DB → throw.
//   - incrementSoftBounce : insert initial (count=1, reason=soft_bounce_pending),
//     increment (count=2), threshold (count=3 → reason=soft_bounce_threshold),
//     no-op si déjà suppressed pour autre cause.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mock Supabase admin -----------------------------------------------------
// On capture les calls .from(table) et la chaîne .select/.eq/.maybeSingle
// + .upsert pour assertions. Builder thenable simple.

type SuppressionRow = {
  email: string;
  reason: string;
  soft_bounce_count: number;
  source_resend_id: string | null;
};

let lookupResult: { data: SuppressionRow | null; error: { message: string } | null };
let upsertCalls: Array<{ payload: unknown; onConflict: string | undefined }>;
let upsertError: { message: string } | null;

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table !== "email_suppressions") {
        throw new Error(`Unexpected table: ${table}`);
      }
      const builder: any = {};
      builder.select = () => builder;
      // T-110 : .ilike() est utilisé côté src pour case-insensitive lookups.
      // .eq() laissé en alias mock pour des tests existants éventuels.
      builder.eq = () => builder;
      builder.ilike = () => builder;
      builder.maybeSingle = () => Promise.resolve(lookupResult);
      builder.upsert = (
        payload: unknown,
        opts?: { onConflict?: string },
      ) => {
        upsertCalls.push({ payload, onConflict: opts?.onConflict });
        return Promise.resolve({ error: upsertError });
      };
      return builder;
    },
  }),
}));

import {
  canSendTo,
  addSuppression,
  incrementSoftBounce,
} from "@/lib/resend/suppressions";

beforeEach(() => {
  lookupResult = { data: null, error: null };
  upsertCalls = [];
  upsertError = null;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// canSendTo
// =============================================================================

describe("canSendTo", () => {
  it("retourne true si l'email n'est PAS dans email_suppressions", async () => {
    lookupResult = { data: null, error: null };
    const ok = await canSendTo("user@example.com");
    expect(ok).toBe(true);
  });

  it("retourne false si reason='hard_bounce'", async () => {
    lookupResult = {
      data: {
        email: "user@example.com",
        reason: "hard_bounce",
        soft_bounce_count: 0,
        source_resend_id: null,
      },
      error: null,
    };
    expect(await canSendTo("user@example.com")).toBe(false);
  });

  it("retourne false si reason='complained' (légal CASL)", async () => {
    lookupResult = {
      data: {
        email: "user@example.com",
        reason: "complained",
        soft_bounce_count: 0,
        source_resend_id: null,
      },
      error: null,
    };
    expect(await canSendTo("user@example.com")).toBe(false);
  });

  it("retourne false si reason='soft_bounce_threshold'", async () => {
    lookupResult = {
      data: {
        email: "user@example.com",
        reason: "soft_bounce_threshold",
        soft_bounce_count: 3,
        source_resend_id: null,
      },
      error: null,
    };
    expect(await canSendTo("user@example.com")).toBe(false);
  });

  it("retourne false si reason='manual'", async () => {
    lookupResult = {
      data: {
        email: "user@example.com",
        reason: "manual",
        soft_bounce_count: 0,
        source_resend_id: null,
      },
      error: null,
    };
    expect(await canSendTo("user@example.com")).toBe(false);
  });

  it("retourne true si reason='soft_bounce_pending' (staging counter, n'active pas le blocage)", async () => {
    lookupResult = {
      data: {
        email: "user@example.com",
        reason: "soft_bounce_pending",
        soft_bounce_count: 2,
        source_resend_id: null,
      },
      error: null,
    };
    expect(await canSendTo("user@example.com")).toBe(true);
  });

  it("normalise case + trim avant lookup (User@Example.com → user@example.com)", async () => {
    // Capture l'argument .ilike(email, value) pour vérifier la normalisation.
    // T-110 : lookup case-insensitive via .ilike().
    let capturedEmail: string | null = null;
    const mockSupabase = {
      from: () => ({
        select: () => ({
          ilike: (_col: string, value: string) => {
            capturedEmail = value;
            return { maybeSingle: () => Promise.resolve(lookupResult) };
          },
        }),
      }),
    };
    vi.doMock("@/lib/supabase/admin", () => ({
      createSupabaseAdminClient: () => mockSupabase,
    }));
    vi.resetModules();
    const { canSendTo: canSendToReimported } = await import(
      "@/lib/resend/suppressions"
    );
    await canSendToReimported("  User@Example.COM  ");
    expect(capturedEmail).toBe("user@example.com");
    vi.doUnmock("@/lib/supabase/admin");
    vi.resetModules();
  });

  it("retourne true (fail-open) si erreur DB — préfère envoyer plutôt que bloquer un OTP critique", async () => {
    lookupResult = {
      data: null,
      error: { message: "connection lost" },
    };
    expect(await canSendTo("user@example.com")).toBe(true);
  });
});

// =============================================================================
// addSuppression
// =============================================================================

describe("addSuppression", () => {
  it("UPSERT avec reason + source_resend_id + email normalisé", async () => {
    await addSuppression("User@Example.COM", "hard_bounce", "evt_123");
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]).toMatchObject({
      payload: expect.objectContaining({
        email: "user@example.com",
        reason: "hard_bounce",
        source_resend_id: "evt_123",
      }),
      onConflict: "email",
    });
  });

  it("source_resend_id null si non fourni", async () => {
    await addSuppression("user@example.com", "complained");
    expect(upsertCalls[0]?.payload).toMatchObject({
      source_resend_id: null,
    });
  });

  it("throw si erreur DB sur UPSERT", async () => {
    upsertError = { message: "permission denied" };
    await expect(
      addSuppression("user@example.com", "hard_bounce"),
    ).rejects.toThrow(/permission denied/);
  });
});

// =============================================================================
// incrementSoftBounce
// =============================================================================

describe("incrementSoftBounce", () => {
  it("première occurrence (row absente) → INSERT count=1 reason=soft_bounce_pending", async () => {
    lookupResult = { data: null, error: null };
    await incrementSoftBounce("user@example.com", "evt_soft_1");
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]?.payload).toMatchObject({
      email: "user@example.com",
      reason: "soft_bounce_pending",
      soft_bounce_count: 1,
      source_resend_id: "evt_soft_1",
    });
  });

  it("deuxième occurrence (count=1 → 2) → reason reste soft_bounce_pending", async () => {
    lookupResult = {
      data: {
        email: "user@example.com",
        reason: "soft_bounce_pending",
        soft_bounce_count: 1,
        source_resend_id: "evt_soft_1",
      },
      error: null,
    };
    await incrementSoftBounce("user@example.com", "evt_soft_2");
    expect(upsertCalls[0]?.payload).toMatchObject({
      reason: "soft_bounce_pending",
      soft_bounce_count: 2,
    });
  });

  it("troisième occurrence (seuil atteint, count=3) → reason bascule soft_bounce_threshold", async () => {
    lookupResult = {
      data: {
        email: "user@example.com",
        reason: "soft_bounce_pending",
        soft_bounce_count: 2,
        source_resend_id: "evt_soft_2",
      },
      error: null,
    };
    await incrementSoftBounce("user@example.com", "evt_soft_3");
    expect(upsertCalls[0]?.payload).toMatchObject({
      reason: "soft_bounce_threshold",
      soft_bounce_count: 3,
    });
  });

  it("no-op si déjà suppressed pour hard_bounce (envoi déjà bloqué)", async () => {
    lookupResult = {
      data: {
        email: "user@example.com",
        reason: "hard_bounce",
        soft_bounce_count: 0,
        source_resend_id: "evt_hard_x",
      },
      error: null,
    };
    await incrementSoftBounce("user@example.com", "evt_soft_z");
    expect(upsertCalls).toHaveLength(0);
  });

  it("no-op si déjà suppressed pour complained", async () => {
    lookupResult = {
      data: {
        email: "user@example.com",
        reason: "complained",
        soft_bounce_count: 0,
        source_resend_id: null,
      },
      error: null,
    };
    await incrementSoftBounce("user@example.com");
    expect(upsertCalls).toHaveLength(0);
  });
});
