import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchPublicProducts } from '@/lib/products/fetch-products-public';

// Mock Supabase multi-from pour fetchPublicProducts.
//
// Selon les filtres actifs, le helper fait 1 à 4 from() séquentiels :
// - 0-3 RTT pour resolveSlugToReference (un par filtre actif)
// - 1 RTT pour la query principale products
//
// Les réponses sont consommées dans l'ordre — chaque test fournit un
// tableau de Response correspondant à la séquence attendue.
type Response = { data: unknown; error: unknown };
type Captured = {
  from: string[];
  select: string[];
  eq: Array<[string, unknown]>;
  order: Array<[string, { ascending?: boolean }]>;
};

function makeMultiFromSupabase(responses: Response[]): {
  client: SupabaseClient;
  captured: Captured;
} {
  let callIdx = 0;
  const captured: Captured = { from: [], select: [], eq: [], order: [] };

  const makeBuilder = (response: Response) => {
    const builder: any = {};
    builder.select = (cols: string) => {
      captured.select.push(cols);
      return builder;
    };
    builder.eq = (col: string, val: unknown) => {
      captured.eq.push([col, val]);
      return builder;
    };
    builder.order = (col: string, opts: { ascending?: boolean }) => {
      captured.order.push([col, opts]);
      return builder;
    };
    builder.maybeSingle = () => Promise.resolve(response);
    builder.then = (resolve: any, reject: any) =>
      Promise.resolve(response).then(resolve, reject);
    return builder;
  };

  const client = {
    from: (table: string) => {
      captured.from.push(table);
      const response = responses[callIdx] ?? { data: null, error: null };
      callIdx++;
      return makeBuilder(response);
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

const NULL_FILTERS = { cut: null, animal: null, category: null };

// ---------- Sans filtre ---------------------------------------------------

describe('fetchPublicProducts — sans filtre', () => {
  it('happy path : retourne tous produits + resolved tout null', async () => {
    const products = [{ id: 'p1', nom: 'Filet', prix: 35 }];
    const { client, captured } = makeMultiFromSupabase([
      { data: products, error: null },
    ]);

    const result = await fetchPublicProducts(client, NULL_FILTERS);

    expect(result.products).toEqual(products);
    expect(result.resolved).toEqual({ category: null, animal: null, cut: null });
    expect(captured.from).toEqual(['products']);
  });

  it('data null → products: []', async () => {
    const { client } = makeMultiFromSupabase([{ data: null, error: null }]);
    const result = await fetchPublicProducts(client, NULL_FILTERS);
    expect(result.products).toEqual([]);
  });

  it('throw si Supabase renvoie une error', async () => {
    const { client } = makeMultiFromSupabase([
      { data: null, error: { message: 'rls denied' } },
    ]);
    await expect(fetchPublicProducts(client, NULL_FILTERS)).rejects.toMatchObject({
      message: 'rls denied',
    });
  });
});

// ---------- Avec filtres -------------------------------------------------

describe('fetchPublicProducts — filtres résolus', () => {
  it('?cut=entrecote : 2 RTT (cuts puis products), filtre cut_id appliqué + resolved.cut peuplé', async () => {
    const { client, captured } = makeMultiFromSupabase([
      { data: { id: 'cut-uuid', name: 'Entrecôte' }, error: null },
      { data: [], error: null },
    ]);

    const result = await fetchPublicProducts(client, {
      cut: 'entrecote',
      animal: null,
      category: null,
    });

    expect(captured.from).toEqual(['cuts', 'products']);
    expect(captured.eq).toContainEqual(['cut_id', 'cut-uuid']);
    expect(result.resolved.cut).toEqual({
      slug: 'entrecote',
      id: 'cut-uuid',
      name: 'Entrecôte',
    });
  });

  it('3 filtres combinés : 4 RTT, 3 .eq() FK chaînés', async () => {
    const { client, captured } = makeMultiFromSupabase([
      { data: { id: 'cat-uuid', name: 'Viande' }, error: null },
      { data: { id: 'animal-uuid', name: 'Bœuf' }, error: null },
      { data: { id: 'cut-uuid', name: 'Entrecôte' }, error: null },
      { data: [], error: null },
    ]);

    const result = await fetchPublicProducts(client, {
      cut: 'entrecote',
      animal: 'boeuf',
      category: 'viande',
    });

    expect(captured.from).toEqual(['product_categories', 'animals', 'cuts', 'products']);
    expect(captured.eq).toContainEqual(['category_id', 'cat-uuid']);
    expect(captured.eq).toContainEqual(['animal_id', 'animal-uuid']);
    expect(captured.eq).toContainEqual(['cut_id', 'cut-uuid']);
    expect(result.resolved.category?.name).toBe('Viande');
    expect(result.resolved.animal?.name).toBe('Bœuf');
    expect(result.resolved.cut?.name).toBe('Entrecôte');
  });
});

// ---------- Slugs invalides ----------------------------------------------

describe('fetchPublicProducts — slugs invalides', () => {
  it('cut slug introuvable → {products: [], resolved tous null}, pas de query products', async () => {
    const { client, captured } = makeMultiFromSupabase([
      { data: null, error: null },
    ]);

    const result = await fetchPublicProducts(client, {
      cut: 'pas-existant',
      animal: null,
      category: null,
    });

    expect(result.products).toEqual([]);
    expect(result.resolved).toEqual({ category: null, animal: null, cut: null });
    expect(captured.from).toEqual(['cuts']);
  });

  it('category résolue mais animal invalide → empty + resolved partiel', async () => {
    const { client, captured } = makeMultiFromSupabase([
      { data: { id: 'cat-uuid', name: 'Viande' }, error: null },
      { data: null, error: null },
    ]);

    const result = await fetchPublicProducts(client, {
      cut: null,
      animal: 'pas-existant',
      category: 'viande',
    });

    expect(result.products).toEqual([]);
    expect(result.resolved.category).toEqual({
      slug: 'viande',
      id: 'cat-uuid',
      name: 'Viande',
    });
    expect(result.resolved.animal).toBeNull();
    expect(result.resolved.cut).toBeNull();
    expect(captured.from).toEqual(['product_categories', 'animals']);
  });
});

// ---------- Contrat de sécurité (anti-leak RLS-bypass) -------------------

describe('fetchPublicProducts — contrat sécurité', () => {
  // TEST CONTRACTUEL CRITIQUE : prévient la régression silencieuse du
  // filtre producer.statut='public'. Validation empirique pré-commit C1
  // (2026-05-01) : query sans ce filtre exposerait 13 produits non-public
  // sur 16 (vérifié sur prod TerrOir avec un script tsx temporaire).
  it('select contient producers!inner(slug, nom_exploitation) SANS le mot statut', async () => {
    const { client, captured } = makeMultiFromSupabase([
      { data: [], error: null },
    ]);

    await fetchPublicProducts(client, NULL_FILTERS);

    const select = captured.select[0] ?? '';
    expect(select).toContain('producers!inner(slug, nom_exploitation)');
    // 'statut' ne doit PAS apparaître dans le select (filtre via eq sur
    // l'embed, pas via projection — on évite de transférer un champ inutile).
    expect(select).not.toContain('statut');
  });

  it('filtre .eq("producers.statut", "public") appliqué (pas no-op)', async () => {
    const { client, captured } = makeMultiFromSupabase([
      { data: [], error: null },
    ]);

    await fetchPublicProducts(client, NULL_FILTERS);

    expect(captured.eq).toContainEqual(['producers.statut', 'public']);
    expect(captured.eq).toContainEqual(['active', true]);
  });

  it('select contient les embeds référentiels pour le badge ProductCard', async () => {
    const { client, captured } = makeMultiFromSupabase([
      { data: [], error: null },
    ]);

    await fetchPublicProducts(client, NULL_FILTERS);

    const select = captured.select[0] ?? '';
    expect(select).toContain('product_categories(slug, name)');
    expect(select).toContain('animals(slug, name)');
    expect(select).toContain('cuts(slug, name)');
  });

  it('order by created_at DESC sur la query products', async () => {
    const { client, captured } = makeMultiFromSupabase([
      { data: [], error: null },
    ]);

    await fetchPublicProducts(client, NULL_FILTERS);

    expect(captured.order).toContainEqual(['created_at', { ascending: false }]);
  });
});
