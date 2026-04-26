import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { syncStripeAccountFlags } from "@/lib/stripe/sync-account-flags";

// Mock Supabase modélisé par chaîne unique :
//   admin.from('producers').update({...}).eq('stripe_account_id', X).select('id')
//
// Le builder est thenable (méthode `.then`) pour qu'un `await` direct sur la
// chaîne (sans `.maybeSingle()`) résolve la réponse stubée.
type Resp = { data?: unknown; error?: unknown };

type Captured = {
  // Tables visitées via `from(...)` — attendu : ['producers'] uniquement.
  from: string[];
  // Payloads d'update — attendu : un seul objet contenant les 3 flags Stripe.
  update: unknown[];
  // Filtres .eq — attendu : un seul ['stripe_account_id', account.id].
  eq: Array<[string, unknown]>;
  // Args .select — attendu : ['id'] (pour récupérer les rows touchées).
  select: string[];
};

const DEFAULT_RESP: Resp = {
  data: [{ id: "producer-42" }],
  error: null,
};

function makeSupabase(response: Resp = DEFAULT_RESP): {
  client: SupabaseClient;
  captured: Captured;
} {
  const captured: Captured = {
    from: [],
    update: [],
    eq: [],
    select: [],
  };

  const builder: any = {};
  builder.update = (payload: unknown) => {
    captured.update.push(payload);
    return builder;
  };
  builder.eq = (col: string, val: unknown) => {
    captured.eq.push([col, val]);
    return builder;
  };
  builder.select = (cols: string) => {
    captured.select.push(cols);
    return builder;
  };
  builder.then = (onFulfilled: (r: Resp) => unknown) => onFulfilled(response);

  const client = {
    from: (table: string) => {
      captured.from.push(table);
      return builder;
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

// Fabrique un Stripe.Account minimal — seuls les 3 booléens lus par la
// fonction sont expressifs ; le reste est cast pour satisfaire le type.
function makeAccount(opts: {
  id?: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}): Stripe.Account {
  return {
    id: opts.id ?? "acct_test",
    charges_enabled: opts.chargesEnabled,
    payouts_enabled: opts.payoutsEnabled,
    details_submitted: opts.detailsSubmitted,
  } as unknown as Stripe.Account;
}

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

describe("syncStripeAccountFlags — account fully onboarded", () => {
  it("UPDATE les 3 flags à true et retourne updated=true + producerId", async () => {
    const { client, captured } = makeSupabase();
    const account = makeAccount({
      id: "acct_full",
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    const result = await syncStripeAccountFlags(account, client);

    expect(result).toEqual({ updated: true, producerId: "producer-42" });
    expect(captured.from).toEqual(["producers"]);
    expect(captured.update).toEqual([
      {
        stripe_charges_enabled: true,
        stripe_payouts_enabled: true,
        stripe_details_submitted: true,
      },
    ]);
    expect(captured.eq).toEqual([["stripe_account_id", "acct_full"]]);
    expect(captured.select).toEqual(["id"]);
  });

  it("émet le log [STRIPE_ACCOUNT_UPDATED] avec account.id et les 3 flags", async () => {
    const { client } = makeSupabase();
    const account = makeAccount({
      id: "acct_full",
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    await syncStripeAccountFlags(account, client);

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const logged = String(consoleLogSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("[STRIPE_ACCOUNT_UPDATED]");
    expect(logged).toContain("account=acct_full");
    expect(logged).toContain("charges=true");
    expect(logged).toContain("payouts=true");
    expect(logged).toContain("details=true");
  });
});

describe("syncStripeAccountFlags — account partial (KYC soumis mais charges KO)", () => {
  it("écrit les flags conformes aux valeurs Stripe, pas d'agrégat onboarding_completed", async () => {
    const { client, captured } = makeSupabase();
    const account = makeAccount({
      id: "acct_partial",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: true,
    });

    const result = await syncStripeAccountFlags(account, client);

    expect(result.updated).toBe(true);
    expect(captured.update).toEqual([
      {
        stripe_charges_enabled: false,
        stripe_payouts_enabled: false,
        stripe_details_submitted: true,
      },
    ]);
  });
});

describe("syncStripeAccountFlags — account réinitialisé (3 flags Stripe à false)", () => {
  it("UPDATE les 3 flags à false (cas reset Stripe ou compte créé sans onboarding)", async () => {
    const { client, captured } = makeSupabase();
    const account = makeAccount({
      id: "acct_reset",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    });

    const result = await syncStripeAccountFlags(account, client);

    expect(result.updated).toBe(true);
    expect(captured.update).toEqual([
      {
        stripe_charges_enabled: false,
        stripe_payouts_enabled: false,
        stripe_details_submitted: false,
      },
    ]);
  });
});

describe("syncStripeAccountFlags — coercion booléenne défensive", () => {
  it("traite undefined / null des champs Stripe.Account comme false (jamais NaN, jamais throw)", async () => {
    const { client, captured } = makeSupabase();
    // Stripe SDK type ces 3 champs comme `boolean` mais le runtime peut
    // retourner undefined sur des comptes très neufs ou dans des états de
    // transition — la double-négation (!!) garantit qu'on n'écrit jamais
    // undefined/null sur des colonnes NOT NULL.
    const account = {
      id: "acct_minimal",
      // charges_enabled/payouts_enabled/details_submitted volontairement absents
    } as unknown as Stripe.Account;

    const result = await syncStripeAccountFlags(account, client);

    expect(result.updated).toBe(true);
    expect(captured.update).toEqual([
      {
        stripe_charges_enabled: false,
        stripe_payouts_enabled: false,
        stripe_details_submitted: false,
      },
    ]);
  });
});

describe("syncStripeAccountFlags — producer absent (UPDATE 0 rows)", () => {
  it("retourne updated=false + producerId=null sans throw (cas orphelin / RGPD)", async () => {
    const { client, captured } = makeSupabase({
      data: [],
      error: null,
    });
    const account = makeAccount({
      id: "acct_orphan",
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    const result = await syncStripeAccountFlags(account, client);

    expect(result).toEqual({ updated: false, producerId: null });
    // L'UPDATE est tout de même émis (Supabase ne sait pas a priori si la
    // WHERE matchera). Pas de warn — c'est un cas normal côté Stripe.
    expect(captured.update).toHaveLength(1);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});

describe("syncStripeAccountFlags — erreur PostgREST", () => {
  it("log [STRIPE_ACCOUNT_UPDATED_ERR] et retourne updated=false sans throw", async () => {
    const { client } = makeSupabase({
      data: null,
      error: { message: "RLS policy violation" },
    });
    const account = makeAccount({
      id: "acct_rls_denied",
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    const result = await syncStripeAccountFlags(account, client);

    expect(result).toEqual({ updated: false, producerId: null });
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    const warned = String(consoleWarnSpy.mock.calls[0]?.[0] ?? "");
    expect(warned).toContain("[STRIPE_ACCOUNT_UPDATED_ERR]");
    expect(warned).toContain("account=acct_rls_denied");
    expect(warned).toContain("RLS policy violation");
  });

  it("ne throw PAS même si error.message est absent (defensive)", async () => {
    const { client } = makeSupabase({
      data: null,
      error: {} as Record<string, unknown>,
    });
    const account = makeAccount({
      id: "acct_unknown_err",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    });

    await expect(
      syncStripeAccountFlags(account, client),
    ).resolves.toEqual({ updated: false, producerId: null });
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });
});
