/**
 * E2E security/orders-postgrest-attack — verrouille la critique #1 de l'audit
 * pré-launch 2026-05-10 (F-001).
 *
 * Reproduit littéralement le path d'attaque décrit dans l'audit :
 *
 *   "Un consumer authentifié peut, via PostgREST direct
 *    (PATCH /orders?id=eq.<own>), passer son order à `completed`
 *    (CHECK constraint laisse passer), modifier `montant_total` à 1€
 *    (le trigger compute_order_commission recalculera 0,06 / 0,94€),
 *    forcer `stripe_payment_intent_id` arbitraire, écraser
 *    `code_commande`/`completed_at`. Bypass complet du paiement Stripe."
 *
 * Le fix livré (commit 20260510100000) est une policy UPDATE
 * `orders service_role update only` avec USING=false WITH CHECK=false sur le
 * rôle `authenticated`. Toute transition d'état orders passe désormais par
 * RPC SECURITY DEFINER (cancel_order, confirm_order_by_producer, etc.).
 *
 * Vs le test SQL-integration `orders-block-owner-update.test.ts` (local
 * Supabase only), ce test e2e/security tape contre le projet Supabase prod
 * configuré dans `.env.test.local` — il valide donc l'état réel déployé.
 *
 * Pattern cloné de `rls-consumer-isolation.spec.ts` (RLS SELECT) — on tape
 * PostgREST en mode anon client `signInWithPassword` consumer.
 */

import { createClient } from '@supabase/supabase-js';
import { test, expect } from '../helpers/test-context';
import { seedConsumer, seedProducer, seedOrder } from '../helpers/db-seed';
import { cleanupOrdersForProducers } from '../helpers/order-lifecycle';
import { getRawAdminClient } from '../helpers/supabase-admin';

// CHECK constraint orders_code_commande_format_check :
// ^TRR-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5,7}$
const CODE_COMMANDE_CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function randomCommandeCode(): string {
  let suffix = '';
  for (let i = 0; i < 7; i++) {
    suffix += CODE_COMMANDE_CHARSET[
      Math.floor(Math.random() * CODE_COMMANDE_CHARSET.length)
    ];
  }
  return `TRR-${suffix}`;
}

function makeAnonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

test.describe('Security — F-001 orders RLS UPDATE blocked (PostgREST attack)', () => {
  test('consumer authentifié : PATCH /orders own_order — toutes mutations silencieusement ignorées', async ({
    ctx,
  }) => {
    test.setTimeout(120_000);

    const consumer = await seedConsumer(ctx, { suffix: 'f001-attack' });
    const producer = await seedProducer(ctx, {
      suffix: 'f001-prod',
      statut: 'public',
    });

    try {
      const order = await seedOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        codeCommande: randomCommandeCode(),
        statut: 'pending',
        montant: 50,
      });

      const client = makeAnonClient();
      const { error: signInErr } = await client.auth.signInWithPassword({
        email: consumer.email,
        password: consumer.password,
      });
      expect(signInErr, `Consumer login failed: ${signInErr?.message}`).toBeNull();

      // Attaque 1 — passer l'order à 'completed' (bypass paiement)
      const attack1 = await client
        .from('orders')
        .update({ statut: 'completed' })
        .eq('id', order.orderId)
        .select();
      expect(
        attack1.error,
        `PATCH statut should not error (USING=false silencieux): ${attack1.error?.message}`,
      ).toBeNull();
      expect(
        attack1.data ?? [],
        `BYPASS F-001 : PATCH statut=completed a affecté ${(attack1.data ?? []).length} row(s)`,
      ).toEqual([]);

      // Attaque 2 — réduire montant_total à 1€ (le trigger recalcule commission)
      const attack2 = await client
        .from('orders')
        .update({ montant_total: 1 })
        .eq('id', order.orderId)
        .select();
      expect(attack2.error).toBeNull();
      expect(
        attack2.data ?? [],
        `BYPASS F-001 : PATCH montant_total=1 a affecté ${(attack2.data ?? []).length} row(s)`,
      ).toEqual([]);

      // Attaque 3 — forger un stripe_payment_intent_id arbitraire
      const attack3 = await client
        .from('orders')
        .update({ stripe_payment_intent_id: 'pi_attacker_forged_F001' })
        .eq('id', order.orderId)
        .select();
      expect(attack3.error).toBeNull();
      expect(
        attack3.data ?? [],
        `BYPASS F-001 : PATCH stripe_payment_intent_id a affecté ${(attack3.data ?? []).length} row(s)`,
      ).toEqual([]);

      // Attaque 4 — écraser completed_at (forcer apparence de pickup validé)
      const attack4 = await client
        .from('orders')
        .update({ completed_at: new Date().toISOString() })
        .eq('id', order.orderId)
        .select();
      expect(attack4.error).toBeNull();
      expect(
        attack4.data ?? [],
        `BYPASS F-001 : PATCH completed_at a affecté ${(attack4.data ?? []).length} row(s)`,
      ).toEqual([]);

      // Attaque 5 — écraser code_commande (anti-fraude reconciliation)
      const attack5 = await client
        .from('orders')
        .update({ code_commande: 'EVILX' })
        .eq('id', order.orderId)
        .select();
      expect(attack5.error).toBeNull();
      expect(
        attack5.data ?? [],
        `BYPASS F-001 : PATCH code_commande a affecté ${(attack5.data ?? []).length} row(s)`,
      ).toEqual([]);

      await client.auth.signOut();

      // Verify côté service_role : la row est restée intacte sur 5 colonnes
      // sensibles testées + un échantillon de colonnes dérivées.
      const admin = getRawAdminClient();
      const { data: rowAfter, error: readErr } = await admin
        .from('orders')
        .select(
          'statut, montant_total, stripe_payment_intent_id, completed_at, code_commande',
        )
        .eq('id', order.orderId)
        .single();
      expect(readErr).toBeNull();
      expect(rowAfter?.statut).toBe('pending');
      expect(Number(rowAfter?.montant_total)).toBe(50);
      expect(rowAfter?.stripe_payment_intent_id).toBeNull();
      expect(rowAfter?.completed_at).toBeNull();
      expect(rowAfter?.code_commande).toBe(order.codeCommande);
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });

  test('producer authentifié : PATCH /orders own_producer_order — UPDATE également bloqué', async ({
    ctx,
  }) => {
    // Vérification miroir : la policy USING=false WITH CHECK=false bloque
    // aussi le producer, pas seulement le consumer. Sans ça, un producer
    // compromis pourrait écraser confirmed_at/completed_at/transfer_id et
    // forcer un payout indu.
    test.setTimeout(120_000);

    const consumer = await seedConsumer(ctx, { suffix: 'f001-cons-mirror' });
    const producer = await seedProducer(ctx, {
      suffix: 'f001-prod-mirror',
      statut: 'public',
    });

    try {
      const order = await seedOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        codeCommande: randomCommandeCode(),
        statut: 'confirmed',
        montant: 100,
      });

      const client = makeAnonClient();
      const { error: signInErr } = await client.auth.signInWithPassword({
        email: producer.user.email,
        password: producer.user.password,
      });
      expect(
        signInErr,
        `Producer login failed: ${signInErr?.message}`,
      ).toBeNull();

      // Attaque producer : passer à completed sans passer par RPC
      // complete_pickup_by_producer (qui vérifie code retrait + audit log)
      const { data, error } = await client
        .from('orders')
        .update({ statut: 'completed', completed_at: new Date().toISOString() })
        .eq('id', order.orderId)
        .select();
      expect(error).toBeNull();
      expect(
        data ?? [],
        `BYPASS F-001 (producer) : PATCH statut a affecté ${(data ?? []).length} row(s)`,
      ).toEqual([]);

      await client.auth.signOut();

      const admin = getRawAdminClient();
      const { data: rowAfter } = await admin
        .from('orders')
        .select('statut, completed_at')
        .eq('id', order.orderId)
        .single();
      expect(rowAfter?.statut).toBe('confirmed');
      expect(rowAfter?.completed_at).toBeNull();
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });
});
