import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchPublicProducts,
  PRODUCTS_PAGE_LIMIT_DEFAULT,
  PRODUCTS_PAGE_LIMIT_MAX,
} from '@/lib/products/fetch-products-public';

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
  ilike: Array<[string, unknown]>;
  order: Array<[string, { ascending?: boolean }]>;
  lt: Array<[string, unknown]>;
  limit: number[];
};

function makeMultiFromSupabase(responses: Response[]): {
  client: SupabaseClient;
  captured: Captured;
} {
  let callIdx = 0;
  const captured: Captured = {
    from: [],
    select: [],
    eq: [],
    ilike: [],
    order: [],
    lt: [],
    limit: [],
  };

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
    builder.ilike = (col: string, val: unknown) => {
      captured.ilike.push([col, val]);
      return builder;
    };
    builder.order = (col: string, opts: { ascending?: boolean }) => {
      captured.order.push([col, opts]);
      return builder;
    };
    builder.lt = (col: string, val: unknown) => {
      captured.lt.push([col, val]);
      return builder;
    };
    builder.limit = (n: number) => {
      captured.limit.push(n);
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

const NULL_FILTERS = { cut: null, animal: null, category: null, q: null };

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
      q: null,
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
      q: null,
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
      q: null,
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
      q: null,
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

// ---------- F-049 Pagination ---------------------------------------------

describe('fetchPublicProducts — pagination cursor (F-049)', () => {
  it('sans cursor : premier batch, limit default appliqué, nextCursor null si page partielle', async () => {
    const products = [
      { id: 'p1', nom: 'A', created_at: '2026-05-10T10:00:00Z' },
      { id: 'p2', nom: 'B', created_at: '2026-05-09T10:00:00Z' },
    ];
    const { client, captured } = makeMultiFromSupabase([
      { data: products, error: null },
    ]);

    const result = await fetchPublicProducts(client, NULL_FILTERS);

    expect(result.products).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
    expect(captured.limit).toEqual([PRODUCTS_PAGE_LIMIT_DEFAULT]);
    expect(captured.lt).toEqual([]);
  });

  it('cursor fourni : applique .lt("created_at", cursor)', async () => {
    const { client, captured } = makeMultiFromSupabase([
      { data: [], error: null },
    ]);

    await fetchPublicProducts(client, NULL_FILTERS, {
      cursor: '2026-05-01T00:00:00Z',
      limit: 30,
    });

    expect(captured.lt).toContainEqual(['created_at', '2026-05-01T00:00:00Z']);
    expect(captured.limit).toEqual([30]);
  });

  it('page pleine (count === limit) : nextCursor = created_at du dernier item', async () => {
    const products = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      nom: `prod ${i}`,
      created_at: `2026-05-${String(10 - i).padStart(2, '0')}T10:00:00Z`,
    }));
    const { client } = makeMultiFromSupabase([{ data: products, error: null }]);

    const result = await fetchPublicProducts(client, NULL_FILTERS, { limit: 5 });

    expect(result.products).toHaveLength(5);
    expect(result.nextCursor).toBe('2026-05-06T10:00:00Z');
  });

  it('limite > MAX clampée à MAX', async () => {
    const { client, captured } = makeMultiFromSupabase([
      { data: [], error: null },
    ]);

    await fetchPublicProducts(client, NULL_FILTERS, { limit: 9999 });

    expect(captured.limit).toEqual([PRODUCTS_PAGE_LIMIT_MAX]);
  });
});

// ---------- F-051 Parallélisation slug resolution ------------------------

describe('fetchPublicProducts — résolutions slug parallèles (F-051)', () => {
  it('3 filtres actifs : les 3 SELECT slug sont lancés AVANT le SELECT products', async () => {
    // On valide la séquence : product_categories, animals, cuts puis products.
    // (Promise.all préserve l'ordre de spawn, qui correspond à l'ordre cat/animal/cut.)
    const { client, captured } = makeMultiFromSupabase([
      { data: { id: 'cat-uuid', name: 'Viande' }, error: null },
      { data: { id: 'animal-uuid', name: 'Bœuf' }, error: null },
      { data: { id: 'cut-uuid', name: 'Entrecôte' }, error: null },
      { data: [], error: null },
    ]);

    await fetchPublicProducts(client, {
      cut: 'entrecote',
      animal: 'boeuf',
      category: 'viande',
      q: null,
    });

    // Ordre exact préservé via Promise.all sequential spawn.
    expect(captured.from).toEqual([
      'product_categories',
      'animals',
      'cuts',
      'products',
    ]);
  });
});

describe('fetchPublicProducts — recherche simple par nom', () => {
  it('?q=poulet applique un filtre ilike sur le nom produit', async () => {
    const { client, captured } = makeMultiFromSupabase([
      { data: [], error: null },
    ]);

    await fetchPublicProducts(client, {
      cut: null,
      animal: null,
      category: null,
      q: 'poulet',
    });

    expect(captured.ilike).toContainEqual(['nom', '%poulet%']);
  });

  it('échappe les wildcards ILIKE dans q', async () => {
    const { client, captured } = makeMultiFromSupabase([
      { data: [], error: null },
    ]);

    await fetchPublicProducts(client, {
      cut: null,
      animal: null,
      category: null,
      q: '50%_promo',
    });

    expect(captured.ilike).toContainEqual(['nom', '%50\\%\\_promo%']);
  });
});
