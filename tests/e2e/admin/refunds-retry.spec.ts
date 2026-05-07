/**
 * E2E admin — Refunds retry incidents (T-102 chantier 2026-05-02).
 *
 * État actuel du repo (verifié 2026-05-07) : les tables refund_incidents
 * + refund_incident_attempts existent (migration 20260501231300) et la
 * RPC public.record_refund_attempt est la SOURCE-OF-TRUTH pour les
 * mutations (migration 20260502064800). Pas de page admin
 * /admin/refunds/incidents ni de route POST /api/admin/refunds/retry/[id]
 * encore implémentée.
 *
 * Ces 2 tests valident donc le contrat de la RPC + la lifecycle
 * status pending → retrying que les chantiers UI à venir consommeront :
 *   1. Premier échec safe_to_retry → status='pending', retry_count=1,
 *      INSERT refund_incident_attempts attempt_number=1, outcome='failed'.
 *   2. Court-circuit classification='permanent' → status='exhausted'
 *      direct dès le 1er échec + resolved_at posé.
 *
 * Lifecycle complète testée par tests Vitest dédiés (lib/refund-incidents
 * tests). Ici on valide seulement les 2 transitions clés que la future
 * UI admin de retry manuel devra exposer.
 */

import { test, expect } from "../helpers/test-context";
import { seedConsumer, seedProducer, seedOrder } from "../helpers/db-seed";
import { getRawAdminClient, trackRowId } from "../helpers/supabase-admin";

test.describe("Admin — Refunds retry incidents (DB contract)", () => {
  test("RPC record_refund_attempt : 1er échec safe_to_retry → status=pending, retry_count=1", async ({
    ctx,
  }) => {
    test.setTimeout(60_000);

    const consumer = await seedConsumer(ctx, { suffix: "refund-pending" });
    const producer = await seedProducer(ctx, {
      suffix: "refund-pending",
      statut: "public",
    });
    const order = await seedOrder(ctx, {
      producerId: producer.producerId,
      consumerId: consumer.id,
      statut: "completed",
    });

    const admin = getRawAdminClient();
    const ts = Date.now();
    const piId = `pi_pwtest_${ts}`;

    // Appel RPC : simuler un 1er échec refund admin avec classification
    // safe_to_retry (erreur transient Stripe → retentable).
    const { data: rpcRows, error: rpcErr } = await admin.rpc(
      "record_refund_attempt",
      {
        p_order_id: order.orderId,
        p_kind: "admin",
        p_payment_intent_id: piId,
        p_consumer_id: consumer.id,
        p_blocked_reason: null,
        p_outcome: "failed",
        p_stripe_error_code: "lock_timeout",
        p_stripe_error_type: "api_error",
        p_stripe_error_message: "Lock timeout, please retry",
        p_stripe_request_id: `req_pwtest_${ts}`,
        p_stripe_refund_id: null,
        p_classification: "safe_to_retry",
        p_first_failed_event_at: new Date().toISOString(),
      },
    );
    expect(rpcErr).toBeNull();
    expect(rpcRows).toBeTruthy();
    const incidentId = (
      rpcRows as Array<{ incident_id: string; incident_status: string }>
    )[0].incident_id;
    trackRowId(ctx, incidentId);

    // DB : refund_incidents = pending, retry_count=1, kind=admin, last_error
    // posé.
    const { data: incident } = await admin
      .from("refund_incidents")
      .select(
        "id, status, retry_count, kind, last_error_code, last_error_message, resolved_at",
      )
      .eq("id", incidentId)
      .maybeSingle();
    expect(incident).not.toBeNull();
    expect(incident!.status).toBe("pending");
    expect(incident!.retry_count).toBe(1);
    expect(incident!.kind).toBe("admin");
    expect(incident!.last_error_code).toBe("lock_timeout");
    expect(incident!.resolved_at).toBeNull();

    // INSERT attempt#1 immutable, outcome=failed.
    const { data: attempts } = await admin
      .from("refund_incident_attempts")
      .select("attempt_number, outcome, stripe_error_code")
      .eq("refund_incident_id", incidentId)
      .order("attempt_number", { ascending: true });
    expect(attempts?.length ?? 0).toBe(1);
    expect(attempts![0].attempt_number).toBe(1);
    expect(attempts![0].outcome).toBe("failed");
    expect(attempts![0].stripe_error_code).toBe("lock_timeout");

    // Cleanup : cascade refund_incident_attempts → refund_incidents
    await admin.from("refund_incidents").delete().eq("id", incidentId);
  });

  test("RPC court-circuit : classification=permanent → status=exhausted dès le 1er coup + resolved_at posé", async ({
    ctx,
  }) => {
    test.setTimeout(60_000);

    const consumer = await seedConsumer(ctx, { suffix: "refund-perm" });
    const producer = await seedProducer(ctx, {
      suffix: "refund-perm",
      statut: "public",
    });
    const order = await seedOrder(ctx, {
      producerId: producer.producerId,
      consumerId: consumer.id,
      statut: "completed",
    });

    const admin = getRawAdminClient();
    const ts = Date.now();
    const piId = `pi_pwtest_perm_${ts}`;

    // Appel RPC avec classification='permanent' : court-circuit T-102.2.b
    // Q4 — 1er passage avec permanent passe direct status='exhausted' +
    // resolved_at=now() (évite 1-3 retries inutiles côté cron).
    const { data: rpcRows, error: rpcErr } = await admin.rpc(
      "record_refund_attempt",
      {
        p_order_id: order.orderId,
        p_kind: "timeout",
        p_payment_intent_id: piId,
        p_consumer_id: consumer.id,
        p_blocked_reason: null,
        p_outcome: "failed",
        p_stripe_error_code: "charge_already_refunded",
        p_stripe_error_type: "invalid_request_error",
        p_stripe_error_message: "Charge already refunded",
        p_stripe_request_id: `req_pwtest_perm_${ts}`,
        p_stripe_refund_id: null,
        p_classification: "permanent",
        p_first_failed_event_at: new Date().toISOString(),
      },
    );
    expect(rpcErr).toBeNull();
    const incidentId = (
      rpcRows as Array<{ incident_id: string; incident_status: string }>
    )[0].incident_id;
    trackRowId(ctx, incidentId);

    // DB : status=exhausted dès le 1er coup, retry_count=1, resolved_at posé.
    const { data: incident } = await admin
      .from("refund_incidents")
      .select(
        "id, status, retry_count, kind, last_error_code, resolved_at",
      )
      .eq("id", incidentId)
      .maybeSingle();
    expect(incident).not.toBeNull();
    expect(incident!.status).toBe("exhausted");
    expect(incident!.retry_count).toBe(1);
    expect(incident!.kind).toBe("timeout");
    expect(incident!.last_error_code).toBe("charge_already_refunded");
    // resolved_at posé sur transition vers terminal status.
    expect(incident!.resolved_at).toBeTruthy();

    // Attempt#1 outcome=failed avec stripe_error_code permanent.
    const { data: attempts } = await admin
      .from("refund_incident_attempts")
      .select("attempt_number, outcome, stripe_error_code")
      .eq("refund_incident_id", incidentId);
    expect(attempts?.length ?? 0).toBe(1);
    expect(attempts![0].attempt_number).toBe(1);
    expect(attempts![0].outcome).toBe("failed");

    await admin.from("refund_incidents").delete().eq("id", incidentId);
  });
});
