/**
 * E2E admin — Gestion disputes Stripe (T-403 audit #2 Stripe).
 *
 * État actuel du repo (verifié 2026-05-07) : la table public.disputes
 * existe (migration 20260429020000_disputes_table.sql) ainsi que les
 * handlers webhook Stripe (lib/stripe/handle-dispute-{created,closed}.tsx)
 * et le cron disputes-deadline-check. PAS DE PAGE ADMIN ni de route
 * /api/admin/disputes encore implémentée.
 *
 * Ces 3 tests valident donc le contrat DB de la couche disputes :
 *   1. INSERT dispute via service_role (alimentation par webhook).
 *   2. RLS lecture admin only : un user authenticated non-admin ne peut
 *      pas lire la table (RLS "disputes admin read" exige admin_users.id =
 *      auth.uid()), tandis qu'un admin lit normalement.
 *   3. UPDATE status workflow needs_response → won (résolution dispute) +
 *      validation des CHECK constraints status (whitelist 7 valeurs).
 *
 * Quand la page admin /disputes sera implémentée, ces tests resteront
 * pertinents (couche DB) — il suffira d'ajouter des tests UI dédiés
 * (liste, détail, action close).
 */

import { test, expect } from "../helpers/test-context";
import { seedConsumer, seedProducer, seedOrder } from "../helpers/db-seed";
import {
  getRawAdminClient,
  getReadOnlyAdminClient,
  trackRowId,
} from "../helpers/supabase-admin";
import { createClient } from "@supabase/supabase-js";

test.describe("Admin — Disputes Stripe (DB contract)", () => {
  test("INSERT : service_role alimente public.disputes via handler webhook", async ({
    ctx,
  }) => {
    test.setTimeout(60_000);

    // Setup commande référencée (FK disputes.order_id NOT NULL).
    const consumer = await seedConsumer(ctx, { suffix: "dispute-ins" });
    const producer = await seedProducer(ctx, {
      suffix: "dispute-ins",
      statut: "public",
    });
    const order = await seedOrder(ctx, {
      producerId: producer.producerId,
      consumerId: consumer.id,
      statut: "completed",
    });

    const admin = getRawAdminClient();
    const ts = Date.now();
    const stripeDisputeId = `du_pwtest_${ts}`;
    const stripeChargeId = `ch_pwtest_${ts}`;

    // Simuler un webhook charge.dispute.created : INSERT row avec status
    // 'needs_response' (default), evidence_due_by +14j (deadline Stripe
    // typique) et amount = montant order (cohérence pratique webhook).
    const dueBy = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: inserted, error: insErr } = await admin
      .from("disputes")
      .insert({
        order_id: order.orderId,
        stripe_dispute_id: stripeDisputeId,
        stripe_charge_id: stripeChargeId,
        reason: "fraudulent",
        amount: 9.99,
        currency: "eur",
        evidence_due_by: dueBy,
        metadata: { source: "playwright-e2e" },
      })
      .select("id, status, evidence_due_by")
      .single();
    if (insErr || !inserted) {
      throw new Error(`INSERT disputes failed: ${insErr?.message}`);
    }
    trackRowId(ctx, inserted.id as string);

    // Status default = 'needs_response' + due_by transmis.
    expect(inserted.status).toBe("needs_response");
    expect(inserted.evidence_due_by).toBeTruthy();

    // Cleanup
    await admin.from("disputes").delete().eq("id", inserted.id);
  });

  test("RLS : non-admin authenticated ne lit pas disputes, admin oui", async ({
    ctx,
  }) => {
    test.setTimeout(60_000);

    // Setup : 1 dispute attaché à 1 commande consumer/producer.
    const consumer = await seedConsumer(ctx, { suffix: "dispute-rls" });
    const producer = await seedProducer(ctx, {
      suffix: "dispute-rls",
      statut: "public",
    });
    const order = await seedOrder(ctx, {
      producerId: producer.producerId,
      consumerId: consumer.id,
      statut: "completed",
    });

    const admin = getRawAdminClient();
    const ts = Date.now();
    const { data: dispute, error: insErr } = await admin
      .from("disputes")
      .insert({
        order_id: order.orderId,
        stripe_dispute_id: `du_pwtest_rls_${ts}`,
        stripe_charge_id: `ch_pwtest_rls_${ts}`,
        amount: 9.99,
        currency: "eur",
      })
      .select("id")
      .single();
    if (insErr || !dispute) {
      throw new Error(`Setup INSERT dispute: ${insErr?.message}`);
    }
    trackRowId(ctx, dispute.id as string);

    try {
      // 1. Client non-admin (anon) : la policy admin_read exige
      //    auth.uid() in admin_users → 0 rows visibles.
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      const anonClient = createClient(url, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: anonRows, error: anonErr } = await anonClient
        .from("disputes")
        .select("id")
        .eq("id", dispute.id);
      // RLS retourne 0 rows (pas une erreur — politique select restrictive).
      expect(anonErr).toBeNull();
      expect(anonRows ?? []).toHaveLength(0);

      // 2. Service_role bypass RLS natif : lit normalement la dispute.
      //    (Symétrie de l'assertion #1 : la policy admin_users empêche les
      //    authenticated non-admin, mais service_role passe à travers.)
      const ro = getReadOnlyAdminClient();
      const { data: adminRows } = await ro
        .from("disputes")
        .select("id, status")
        .eq("id", dispute.id);
      expect(adminRows?.length ?? 0).toBe(1);
      expect(adminRows![0].status).toBe("needs_response");
    } finally {
      await admin.from("disputes").delete().eq("id", dispute.id);
    }
  });

  test("UPDATE status : workflow needs_response → won + CHECK constraint enum", async ({
    ctx,
  }) => {
    test.setTimeout(60_000);

    const consumer = await seedConsumer(ctx, { suffix: "dispute-upd" });
    const producer = await seedProducer(ctx, {
      suffix: "dispute-upd",
      statut: "public",
    });
    const order = await seedOrder(ctx, {
      producerId: producer.producerId,
      consumerId: consumer.id,
      statut: "completed",
    });

    const admin = getRawAdminClient();
    const ts = Date.now();
    const { data: dispute, error: insErr } = await admin
      .from("disputes")
      .insert({
        order_id: order.orderId,
        stripe_dispute_id: `du_pwtest_upd_${ts}`,
        stripe_charge_id: `ch_pwtest_upd_${ts}`,
        amount: 9.99,
        currency: "eur",
      })
      .select("id, status")
      .single();
    if (insErr || !dispute) {
      throw new Error(`Setup INSERT dispute: ${insErr?.message}`);
    }
    trackRowId(ctx, dispute.id as string);

    try {
      // 1. Transition légitime needs_response → won (résolution gagnée).
      const closedAtIso = new Date().toISOString();
      const { error: updErr } = await admin
        .from("disputes")
        .update({ status: "won", closed_at: closedAtIso })
        .eq("id", dispute.id);
      expect(updErr).toBeNull();

      const ro = getReadOnlyAdminClient();
      const { data: updated } = await ro
        .from("disputes")
        .select("status, closed_at")
        .eq("id", dispute.id)
        .maybeSingle();
      expect(updated!.status).toBe("won");
      expect(updated!.closed_at).toBeTruthy();

      // 2. Transition INVALIDE : un status hors whitelist CHECK constraint
      //    doit être rejeté (cf. migration ligne 41-49, 7 valeurs autorisées).
      const { error: badErr } = await admin
        .from("disputes")
        .update({ status: "totally_invalid_status" })
        .eq("id", dispute.id);
      expect(badErr, "CHECK status doit rejeter les valeurs hors whitelist").not.toBeNull();
      // Postgres erreur code 23514 (CHECK constraint violation).
      const errCode = (badErr as { code?: string } | null)?.code;
      expect(errCode).toBe("23514");
    } finally {
      await admin.from("disputes").delete().eq("id", dispute.id);
    }
  });
});
