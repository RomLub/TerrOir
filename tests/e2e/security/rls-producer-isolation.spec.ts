/**
 * E2E security/rls-producer-isolation — vérifie que la RLS Postgres protège
 * un producer A vs un producer B, ET que le trigger T-218 + T-218-bis bloque
 * un producer qui tenterait de modifier ses propres colonnes admin-only
 * (lat/lng, statut, etc.) via la REST PostgREST directe.
 *
 * Vs producer-rls-isolation.spec.ts à la racine (qui teste les pages SSR via
 * admin client serveur), ici on tape DIRECTEMENT contre la REST PostgREST en
 * mode `signInWithPassword` du producer authentifié.
 *
 * Couverture (2 tests) :
 *   1. RLS isolation orders : producer B authentifié ne voit PAS les orders
 *      du producer A (policy "orders parties read" filtre owns_producer).
 *   2. Trigger T-218-bis : producer A authentifié tente UPDATE de ses propres
 *      lat/lng → bloqué par trigger avec errcode 42501 (admin-only column).
 */

import { createClient } from '@supabase/supabase-js';
import { test, expect } from '../helpers/test-context';
import { seedConsumer, seedProducer, seedOrder } from '../helpers/db-seed';
import { cleanupOrdersForProducers } from '../helpers/order-lifecycle';

function makeAnonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

test.describe('Security — RLS producer isolation (anon client)', () => {
  test('orders : producer B authentifié ne voit PAS les orders du producer A', async ({
    ctx,
  }) => {
    test.setTimeout(90_000);

    const producerA = await seedProducer(ctx, {
      suffix: 'rls-prodisoa',
      statut: 'public',
    });
    const producerB = await seedProducer(ctx, {
      suffix: 'rls-prodisob',
      statut: 'public',
    });
    const consumer = await seedConsumer(ctx, { suffix: 'rls-prodiso-cons' });

    try {
      const orderA = await seedOrder(ctx, {
        producerId: producerA.producerId,
        consumerId: consumer.id,
        codeCommande: `RLSPI-${Date.now()}-A`,
      });

      const client = makeAnonClient();
      const { error: signInErr } = await client.auth.signInWithPassword({
        email: producerB.user.email,
        password: producerB.user.password,
      });
      expect(
        signInErr,
        `Producer B login failed: ${signInErr?.message}`,
      ).toBeNull();

      // 1. SELECT orders WHERE producer_id = A : 0 row (B n'owns pas A).
      const { data: ordersByProd, error: ordersErr } = await client
        .from('orders')
        .select('id, code_commande, producer_id')
        .eq('producer_id', producerA.producerId);
      expect(ordersErr, ordersErr?.message).toBeNull();
      expect(
        ordersByProd ?? [],
        `LEAK: Producer B ne doit pas voir orders du producer A`,
      ).toEqual([]);

      // 2. SELECT direct par order id de A : 0 row (RLS filtre AVANT id eq).
      const { data: orderById } = await client
        .from('orders')
        .select('id, code_commande')
        .eq('id', orderA.orderId);
      expect(
        orderById ?? [],
        `LEAK: SELECT par id de l'order de producer A doit retourner vide pour B`,
      ).toEqual([]);

      await client.auth.signOut();
    } finally {
      await cleanupOrdersForProducers([producerA.producerId, producerB.producerId]);
    }
  });

  test('trigger T-218-bis : producer A ne peut PAS UPDATE ses propres latitude/longitude', async ({
    ctx,
  }) => {
    test.setTimeout(60_000);

    const producerA = await seedProducer(ctx, {
      suffix: 'rls-trig-lat',
      statut: 'public',
    });

    const client = makeAnonClient();
    const { error: signInErr } = await client.auth.signInWithPassword({
      email: producerA.user.email,
      password: producerA.user.password,
    });
    expect(signInErr, signInErr?.message).toBeNull();

    // T-218-bis : "producers.latitude is admin-only" — trigger raise
    // exception 42501. PostgREST renvoie une error 4xx (pas un row updated).
    const { data: latData, error: latErr } = await client
      .from('producers')
      .update({ latitude: 47.123456 })
      .eq('id', producerA.producerId)
      .select('id, latitude');

    expect(
      latErr,
      `UPDATE latitude par owner DOIT être bloqué par trigger T-218-bis`,
    ).not.toBeNull();
    // Le code peut varier (42501 explicite, ou simplement le code transmis
    // par PostgREST). On vérifie qu'au moins le message contient l'indice.
    const latErrMsg = `${latErr?.message ?? ''} ${latErr?.code ?? ''}`;
    expect(
      latErrMsg.toLowerCase(),
      `Erreur attendue mentionnant admin-only ou 42501. Got: ${latErrMsg}`,
    ).toMatch(/admin-only|42501|t-218|permission/i);
    // Pas de mutation appliquée
    expect(
      latData ?? [],
      `Aucune row ne doit être renvoyée comme updated`,
    ).toEqual([]);

    // Idem pour longitude
    const { error: lngErr } = await client
      .from('producers')
      .update({ longitude: -1.234567 })
      .eq('id', producerA.producerId);
    expect(
      lngErr,
      `UPDATE longitude par owner DOIT être bloqué par trigger T-218-bis`,
    ).not.toBeNull();

    // Idem pour statut (T-218 cœur, premier check du trigger).
    const { error: statutErr } = await client
      .from('producers')
      .update({ statut: 'active' })
      .eq('id', producerA.producerId);
    expect(
      statutErr,
      `UPDATE statut par owner DOIT être bloqué par trigger T-218`,
    ).not.toBeNull();

    await client.auth.signOut();
  });
});
