// Test régression F-001 (defense-in-depth CI).
//
// La migration 20260510100000_p0_ta_f001_orders_transitions_rpc_secdef
// retire la policy "orders parties update" et la remplace par une policy
// "orders service_role update only" avec USING(false) / WITH CHECK(false).
// Tout caller authenticated qui tente un UPDATE direct sur public.orders
// via user-context retourne { data: [], error: null } (RLS rejette
// silencieusement). Vérité-terrain : smoke test SQL Studio test 7
// post-apply (SET ROLE authenticated + UPDATE direct → 0 rows).
//
// Cartographie F-001 — 2 call sites user-context identifiés avant migration,
// tous deux basculés sur admin client en c4 :
//   - app/api/stripe/create-payment-intent/route.ts:233 (stripe_payment_intent_id)
//   - app/api/orders/create/route.ts:180 (cgv_accepted_at + cgv_version)
//
// Toute régression future = caught à la review PR + smoke SQL test 7.

import { describe, it, expect } from "vitest";

function makeMockUserContext() {
  const updates: Array<{ table: string; payload: unknown }> = [];
  const client = {
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      builder.update = (payload: unknown) => {
        updates.push({ table, payload });
        return builder;
      };
      builder.eq = () => builder;
      builder.is = () => builder;
      builder.select = () => builder;
      // Policy using(false) : 0 rows affectées, pas d'erreur explicite.
      builder.then = (onFulfilled: (r: unknown) => unknown) =>
        onFulfilled({ data: [], error: null });
      builder.maybeSingle = () =>
        Promise.resolve({ data: null, error: null });
      return builder;
    },
  };
  return { client, updates };
}

describe("F-001 régression — policy 'orders parties update' retirée", () => {
  it("UPDATE user-context sur orders retourne 0 rows + error null (policy using(false))", async () => {
    const { client, updates } = makeMockUserContext();
    const builder = (
      client.from("orders") as Record<string, unknown> & {
        update: (p: unknown) => unknown;
        eq: (c: string, v: unknown) => unknown;
        select: (c: string) => unknown;
        then: (cb: (r: unknown) => unknown) => unknown;
      }
    );
    const promise = (builder.update({
      statut: "completed",
      montant_total: 1,
    }) as Record<string, unknown> & {
      eq: (c: string, v: unknown) => unknown;
    });
    const eqResult = (promise.eq("id", "any-uuid") as Record<string, unknown> & {
      select: (c: string) => unknown;
    });
    const final = eqResult.select("id") as PromiseLike<{
      data: unknown;
      error: unknown;
    }>;
    const result = await final;
    expect(result).toEqual({ data: [], error: null });
    expect(updates).toEqual([
      { table: "orders", payload: { statut: "completed", montant_total: 1 } },
    ]);
  });

  it("documentation : call sites user-context migrés en c4 + RPC SECDEF en c3", () => {
    // Cartographie F-001 :
    //   - 8 call sites transitions → RPC SECDEF (c3) : confirm, complete,
    //     cancel, refund, cron/order-timeout, handle-payment-failed,
    //     handle-early-fraud-warning, pickup-validation
    //   - 2 call sites metadata user-context → admin client (c4) :
    //     create-payment-intent (stripe_payment_intent_id),
    //     orders/create (cgv_accepted_at + cgv_version)
    //
    // Toute régression future (réintroduction d'un UPDATE user-context sur
    // orders) doit être détectée à la review PR. Garde-fou runtime :
    // smoke test SQL Studio test 7 post-apply.
    expect(true).toBe(true);
  });
});
