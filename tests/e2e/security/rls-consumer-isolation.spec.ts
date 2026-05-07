/**
 * E2E security/rls-consumer-isolation — vérifie que la RLS Postgres protège
 * effectivement les données d'un consumer A vs un consumer B au niveau du
 * client anon (sans bypass).
 *
 * Vs producer-rls-isolation.spec.ts à la racine (qui teste les pages SSR via
 * l'admin client serveur), ici on tape DIRECTEMENT contre la REST PostgREST
 * en mode `signInWithPassword` consumer, pour s'assurer que la couche RLS
 * tient face à un attaquant qui aurait extrait l'anon key (publique) ET un
 * jeton d'un user A légitime tentant de lire les données d'un user B.
 *
 * Couverture (2 tests) :
 *   1. orders + order_items : consumer B authentifié ne voit PAS les commandes
 *      ni les items de A (policy "orders parties read" = consumer_id=auth.uid()
 *      OR owns_producer(producer_id)).
 *   2. notifications : consumer B authentifié ne voit PAS les notifications
 *      adressées à A (policy "notifications owner read" = user_id=auth.uid()).
 */

import { createClient } from '@supabase/supabase-js';
import { test, expect } from '../helpers/test-context';
import { seedConsumer, seedProducer, seedOrder } from '../helpers/db-seed';
import { cleanupOrdersForProducers } from '../helpers/order-lifecycle';
import { getRawAdminClient, trackRowId } from '../helpers/supabase-admin';

function makeAnonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

test.describe('Security — RLS consumer isolation (anon client)', () => {
  test('orders + order_items : consumer B ne voit PAS les commandes du consumer A', async ({
    ctx,
  }) => {
    test.setTimeout(90_000);

    const consumerA = await seedConsumer(ctx, { suffix: 'rls-cons-a' });
    const consumerB = await seedConsumer(ctx, { suffix: 'rls-cons-b' });
    const producer = await seedProducer(ctx, {
      suffix: 'rls-cons-prod',
      statut: 'public',
    });

    try {
      const orderA = await seedOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumerA.id,
        codeCommande: `RLSCA-${Date.now()}`,
      });

      const client = makeAnonClient();
      const { error: signInErr } = await client.auth.signInWithPassword({
        email: consumerB.email,
        password: consumerB.password,
      });
      expect(signInErr, `Consumer B login failed: ${signInErr?.message}`).toBeNull();

      // 1. SELECT sur orders WHERE consumer_id = A.id : 0 row visible
      //    (RLS policy "orders parties read" filtre auth.uid() = consumer_id
      //    OR owns_producer(producer_id) — B n'est ni A ni le producer).
      const { data: ordersLeak, error: ordersErr } = await client
        .from('orders')
        .select('id, code_commande, consumer_id')
        .eq('consumer_id', consumerA.id);
      expect(ordersErr, `orders SELECT should not error: ${ordersErr?.message}`).toBeNull();
      expect(
        ordersLeak ?? [],
        `LEAK: Consumer B ne devrait PAS voir les orders du Consumer A. Got: ${JSON.stringify(ordersLeak)}`,
      ).toEqual([]);

      // 2. SELECT direct par id de l'order de A : 0 row (RLS court-circuite
      //    avant le filter id, on ne triche pas en passant un id connu).
      const { data: orderById } = await client
        .from('orders')
        .select('id, code_commande')
        .eq('id', orderA.orderId);
      expect(
        orderById ?? [],
        `LEAK: SELECT par id de l'order A ne doit rien retourner pour B`,
      ).toEqual([]);

      // 3. SELECT sur order_items via order_id de A : 0 row (policy
      //    "order_items via order" délègue à can_access_order(order_id)).
      const { data: itemsLeak } = await client
        .from('order_items')
        .select('id, order_id')
        .eq('order_id', orderA.orderId);
      expect(
        itemsLeak ?? [],
        `LEAK: order_items du order A ne doit rien retourner pour B`,
      ).toEqual([]);

      await client.auth.signOut();
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });

  test('notifications : consumer B ne voit PAS les notifications du consumer A', async ({
    ctx,
  }) => {
    test.setTimeout(90_000);

    const consumerA = await seedConsumer(ctx, { suffix: 'rls-notif-a' });
    const consumerB = await seedConsumer(ctx, { suffix: 'rls-notif-b' });

    // INSERT direct via service_role (bypass RLS) d'une notification destinée
    // à A. La policy "notifications owner read" doit empêcher B de la lire.
    const admin = getRawAdminClient();
    const marker = `rls-leak-marker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data: notifRow, error: insErr } = await admin
      .from('notifications')
      .insert({
        user_id: consumerA.id,
        type: 'email',
        template: 'rls-isolation-test',
        statut: 'sent',
        metadata: { marker },
      })
      .select('id')
      .single();
    expect(insErr, `seed notification failed: ${insErr?.message}`).toBeNull();
    if (notifRow) trackRowId(ctx, notifRow.id as string);

    const client = makeAnonClient();
    const { error: signInErr } = await client.auth.signInWithPassword({
      email: consumerB.email,
      password: consumerB.password,
    });
    expect(signInErr, `Consumer B login failed: ${signInErr?.message}`).toBeNull();

    // SELECT toutes les notifications visibles à B : ne doit PAS contenir
    // celle de A (notif.user_id = A.id, policy filtre user_id = auth.uid()).
    const { data: notifsForB, error: selErr } = await client
      .from('notifications')
      .select('id, user_id, metadata')
      .eq('user_id', consumerA.id);
    expect(selErr, `notifications SELECT should not error: ${selErr?.message}`).toBeNull();
    expect(
      notifsForB ?? [],
      `LEAK: Consumer B ne doit pas voir les notifications de Consumer A`,
    ).toEqual([]);

    // Vérification croisée : A authentifié voit BIEN la notif (preuve que
    // la donnée existe vraiment, on ne teste pas un "404 universel").
    await client.auth.signOut();
    const { error: signInAErr } = await client.auth.signInWithPassword({
      email: consumerA.email,
      password: consumerA.password,
    });
    expect(signInAErr, `Consumer A login failed: ${signInAErr?.message}`).toBeNull();

    const { data: notifsForA } = await client
      .from('notifications')
      .select('id, user_id, metadata')
      .eq('user_id', consumerA.id);
    expect(
      (notifsForA ?? []).length,
      `Consumer A doit voir au moins sa notification`,
    ).toBeGreaterThanOrEqual(1);

    await client.auth.signOut();
  });
});
