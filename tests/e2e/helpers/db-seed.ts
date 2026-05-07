/**
 * Seed helpers E2E — façade unifiée pour la création de données de test.
 *
 * Wrappe les helpers spécialisés existants (user-lifecycle, producer-
 * lifecycle, order-lifecycle) sous une API cohérente `seedX`. Les tests
 * peuvent importer depuis un seul module sans avoir à connaître la
 * répartition par lifecycle file.
 *
 * Pour les besoins exotiques (combinaisons multi-entités, cas limites),
 * importer directement les helpers sources reste possible.
 */

import type { TestContext } from './supabase-admin';
import { createTestUser, type TestUser } from './user-lifecycle';
import { createTestProducer, type TestProducer } from './producer-lifecycle';
import { createTestOrder, type TestOrderRefs } from './order-lifecycle';
import { getRawAdminClient, trackRowId } from './supabase-admin';

export type { TestUser, TestProducer, TestOrderRefs };

interface SeedConsumerOptions {
  suffix?: string;
  password?: string;
  emailConfirmed?: boolean;
}

export async function seedConsumer(
  ctx: TestContext,
  options: SeedConsumerOptions = {},
): Promise<TestUser> {
  return createTestUser(ctx, { ...options, suffix: options.suffix ?? 'consumer' });
}

interface SeedProducerOptions {
  suffix?: string;
  statut?: 'draft' | 'public' | 'active';
  nomExploitation?: string;
}

export async function seedProducer(
  ctx: TestContext,
  options: SeedProducerOptions = {},
): Promise<TestProducer> {
  return createTestProducer(ctx, options);
}

interface SeedProductOptions {
  producerId: string;
  nom?: string;
  prix?: number;
  unite?: string;
  stockDisponible?: number;
  stockIllimite?: boolean;
  active?: boolean;
}

export async function seedProduct(
  ctx: TestContext,
  options: SeedProductOptions,
): Promise<{ id: string; nom: string }> {
  const admin = getRawAdminClient();
  const ts = Date.now();
  const nom = options.nom ?? `playwright-test-product-${ts}`;
  const { data, error } = await admin
    .from('products')
    .insert({
      producer_id: options.producerId,
      nom,
      description: 'Produit créé par seedProduct (e2e)',
      prix: options.prix ?? 9.99,
      unite: options.unite ?? 'piece',
      stock_disponible: options.stockDisponible ?? 100,
      stock_illimite: options.stockIllimite ?? false,
      active: options.active ?? true,
    })
    .select('id, nom')
    .single();
  if (error || !data) {
    throw new Error(`seedProduct insert failed: ${error?.message ?? 'no data'}`);
  }
  trackRowId(ctx, data.id as string);
  return { id: data.id as string, nom: data.nom as string };
}

interface SeedOrderOptions {
  producerId: string;
  consumerId: string;
  codeCommande?: string;
  productNom?: string;
  statut?: 'pending' | 'confirmed' | 'completed';
  montant?: number;
  daysAhead?: number;
}

export async function seedOrder(
  ctx: TestContext,
  options: SeedOrderOptions,
): Promise<TestOrderRefs> {
  return createTestOrder(ctx, options);
}
