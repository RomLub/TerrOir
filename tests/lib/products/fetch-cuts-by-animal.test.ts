import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchCutsByAnimalSlug } from '@/lib/products/fetch-cuts-by-animal';

// Mock Supabase pour fetchCutsByAnimalSlug — 2 RTT séquentiels :
// 1. from('animals').select('id').eq('slug',x).maybeSingle()
// 2. from('cuts').select(...).eq('animal_id',y).order(...).order(...)
// Les réponses sont consommées dans l'ordre des `from()` calls.
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

describe('fetchCutsByAnimalSlug', () => {
  it('happy path : slug valide → 2 RTT (animals puis cuts), retourne les cuts', async () => {
    const cuts = [
      { id: 'k1', animal_id: 'a1', slug: 'joue', name: 'Joue', sort_order: 10 },
      { id: 'k2', animal_id: 'a1', slug: 'entrecote', name: 'Entrecôte', sort_order: 80 },
    ];
    const { client, captured } = makeMultiFromSupabase([
      { data: { id: 'a1' }, error: null },
      { data: cuts, error: null },
    ]);

    const result = await fetchCutsByAnimalSlug(client, 'boeuf');

    expect(result).toEqual(cuts);
    expect(captured.from).toEqual(['animals', 'cuts']);
  });

  it('slug animal invalide → [] sans 2e RTT', async () => {
    const { client, captured } = makeMultiFromSupabase([
      { data: null, error: null },
    ]);

    const result = await fetchCutsByAnimalSlug(client, 'pas-existant');

    expect(result).toEqual([]);
    // 1 seul RTT effectué (animals lookup), pas de query cuts.
    expect(captured.from).toEqual(['animals']);
  });

  it('cuts data null → []', async () => {
    const { client } = makeMultiFromSupabase([
      { data: { id: 'a1' }, error: null },
      { data: null, error: null },
    ]);

    const result = await fetchCutsByAnimalSlug(client, 'boeuf');
    expect(result).toEqual([]);
  });

  it('throw si Supabase renvoie une error sur la query cuts', async () => {
    const { client } = makeMultiFromSupabase([
      { data: { id: 'a1' }, error: null },
      { data: null, error: { message: 'rls denied' } },
    ]);

    await expect(fetchCutsByAnimalSlug(client, 'boeuf')).rejects.toMatchObject({
      message: 'rls denied',
    });
  });

  // TEST CONTRACTUEL : query cuts ordered sort_order ASC + name ASC pour
  // déterminisme (cohérent avec fetchProductCategories, fetchAnimals, fetchCuts).
  it('contrat : ORDER BY sort_order ASC puis name ASC sur la query cuts', async () => {
    const { client, captured } = makeMultiFromSupabase([
      { data: { id: 'a1' }, error: null },
      { data: [], error: null },
    ]);

    await fetchCutsByAnimalSlug(client, 'boeuf');

    expect(captured.order).toEqual([
      ['sort_order', { ascending: true }],
      ['name', { ascending: true }],
    ]);
  });

  // TEST CONTRACTUEL : la query cuts utilise l'animal_id RÉSOLU (pas le
  // slug brut). Régression silencieuse possible si quelqu'un remplace le
  // pattern resolution+filter par un inner join.
  it('contrat : query cuts filtre par animal_id résolu (pas par slug brut)', async () => {
    const { client, captured } = makeMultiFromSupabase([
      { data: { id: 'animal-uuid-resolved' }, error: null },
      { data: [], error: null },
    ]);

    await fetchCutsByAnimalSlug(client, 'boeuf');

    expect(captured.eq).toContainEqual(['slug', 'boeuf']);
    expect(captured.eq).toContainEqual(['animal_id', 'animal-uuid-resolved']);
  });
});
