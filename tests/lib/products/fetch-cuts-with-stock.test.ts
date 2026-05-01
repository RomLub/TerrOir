import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchCutsWithStock } from '@/lib/products/fetch-cuts-with-stock';

// Mock Supabase pour fetchCutsWithStock — 1 seul from('products') avec
// builder thenable (cf. tests/lib/products/fetch-references.test.ts pour
// le pattern). Capture from/select/eq pour assertions contractuelles.
type Captured = {
  from: string[];
  select: string[];
  eq: Array<[string, unknown]>;
};

function makeSupabase(response: { data: unknown; error: unknown }): {
  client: SupabaseClient;
  captured: Captured;
} {
  const captured: Captured = { from: [], select: [], eq: [] };
  const builder: any = {};
  builder.select = (cols: string) => {
    captured.select.push(cols);
    return builder;
  };
  builder.eq = (col: string, val: unknown) => {
    captured.eq.push([col, val]);
    return builder;
  };
  builder.then = (resolve: any, reject: any) =>
    Promise.resolve(response).then(resolve, reject);

  const client = {
    from: (table: string) => {
      captured.from.push(table);
      return builder;
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

describe('fetchCutsWithStock', () => {
  it('happy path : retourne Set<string> dédupliqué', async () => {
    const rows = [
      { cuts: { slug: 'entrecote' } },
      { cuts: { slug: 'entrecote' } }, // doublon — testé via Set
      { cuts: { slug: 'joue' } },
      { cuts: { slug: 'colis-mixte' } },
    ];
    const { client } = makeSupabase({ data: rows, error: null });

    const result = await fetchCutsWithStock(client);

    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(3);
    expect(result.has('entrecote')).toBe(true);
    expect(result.has('joue')).toBe(true);
    expect(result.has('colis-mixte')).toBe(true);
  });

  it('empty data → Set vide', async () => {
    const { client } = makeSupabase({ data: [], error: null });
    const result = await fetchCutsWithStock(client);
    expect(result.size).toBe(0);
  });

  it('data null → Set vide', async () => {
    const { client } = makeSupabase({ data: null, error: null });
    const result = await fetchCutsWithStock(client);
    expect(result.size).toBe(0);
  });

  it('rows sans cuts (cuts null) ignorées sans throw', async () => {
    const rows = [
      { cuts: { slug: 'entrecote' } },
      { cuts: null }, // cas défensif (ne devrait jamais arriver avec !inner)
    ];
    const { client } = makeSupabase({ data: rows, error: null });
    const result = await fetchCutsWithStock(client);
    expect(result.size).toBe(1);
    expect(result.has('entrecote')).toBe(true);
  });

  it('throw si Supabase renvoie une error', async () => {
    const { client } = makeSupabase({
      data: null,
      error: { message: 'rls denied' },
    });
    await expect(fetchCutsWithStock(client)).rejects.toMatchObject({
      message: 'rls denied',
    });
  });

  // TEST CONTRACTUEL : pattern PostgREST inner join + filtre RLS-bypass.
  // Prévient régression silencieuse au refacto (cf. validation empirique
  // pré-commit C1 : 13 produits non-public seraient leakés sans ce filtre).
  it('contrat : query products avec inner joins cuts + producers + filtre statut public', async () => {
    const { client, captured } = makeSupabase({ data: [], error: null });

    await fetchCutsWithStock(client);

    expect(captured.from).toEqual(['products']);
    const select = captured.select[0] ?? '';
    expect(select).toContain('cuts!inner(slug)');
    expect(select).toContain('producers!inner(id)');
    // 'statut' n'est PAS sélectionné (filtre via eq, pas projection).
    expect(select).not.toContain('statut');
    expect(captured.eq).toContainEqual(['active', true]);
    expect(captured.eq).toContainEqual(['producers.statut', 'public']);
  });
});
