import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchProductCategories,
  fetchAnimals,
  fetchCuts,
} from '@/lib/products/fetch-references';

// Mock Supabase client minimal pour les fetchers T-220 PR-B.
// Supporte la chaîne :  from(t).select(cols).order(c, o).order(c, o)
// (les helpers chaînent DEUX `.order()` — sort_order puis name pour
// déterminisme). Le builder est thenable : `await` peut être appelé à
// n'importe quel niveau de la chaîne, ce qui colle au pattern PostgREST.
type Captured = {
  from: string[];
  select: string[];
  order: Array<[string, { ascending?: boolean }]>;
};

function makeSupabase(response: { data: unknown; error: unknown }): {
  client: SupabaseClient;
  captured: Captured;
} {
  const captured: Captured = { from: [], select: [], order: [] };

  const builder: any = {};
  builder.select = (cols: string) => {
    captured.select.push(cols);
    return builder;
  };
  builder.order = (col: string, opts: { ascending?: boolean }) => {
    captured.order.push([col, opts]);
    return builder;
  };
  // Thenable : permet d'awaiter le builder à n'importe quel niveau.
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

// ---------- fetchProductCategories ----------------------------------------

describe('fetchProductCategories', () => {
  it('happy path : requête product_categories avec select + 2 order ASC, retourne les rows', async () => {
    const rows = [
      { id: 'c1', slug: 'viande', name: 'Viande', sort_order: 10 },
      { id: 'c2', slug: 'autres', name: 'Autres', sort_order: 70 },
    ];
    const { client, captured } = makeSupabase({ data: rows, error: null });

    const res = await fetchProductCategories(client);

    expect(res).toEqual(rows);
    expect(captured.from).toEqual(['product_categories']);
    expect(captured.select).toEqual(['id, slug, name, sort_order']);
    expect(captured.order).toEqual([
      ['sort_order', { ascending: true }],
      ['name', { ascending: true }],
    ]);
  });

  it('retourne [] si data est null (cas Supabase défensif)', async () => {
    const { client } = makeSupabase({ data: null, error: null });

    const res = await fetchProductCategories(client);

    expect(res).toEqual([]);
  });

  it('throw si Supabase renvoie une error', async () => {
    const { client } = makeSupabase({
      data: null,
      error: { message: 'rls denied' },
    });

    await expect(fetchProductCategories(client)).rejects.toMatchObject({
      message: 'rls denied',
    });
  });
});

// ---------- fetchAnimals ---------------------------------------------------

describe('fetchAnimals', () => {
  it('happy path : requête animals avec select + 2 order ASC, retourne les rows', async () => {
    const rows = [
      { id: 'a1', slug: 'boeuf', name: 'Bœuf', sort_order: 10 },
      { id: 'a2', slug: 'lapin', name: 'Lapin', sort_order: 60 },
    ];
    const { client, captured } = makeSupabase({ data: rows, error: null });

    const res = await fetchAnimals(client);

    expect(res).toEqual(rows);
    expect(captured.from).toEqual(['animals']);
    expect(captured.select).toEqual(['id, slug, name, sort_order']);
    expect(captured.order).toEqual([
      ['sort_order', { ascending: true }],
      ['name', { ascending: true }],
    ]);
  });

  it('retourne [] si data est null', async () => {
    const { client } = makeSupabase({ data: null, error: null });

    const res = await fetchAnimals(client);

    expect(res).toEqual([]);
  });

  it('throw si Supabase renvoie une error', async () => {
    const { client } = makeSupabase({
      data: null,
      error: { message: 'connection refused' },
    });

    await expect(fetchAnimals(client)).rejects.toMatchObject({
      message: 'connection refused',
    });
  });
});

// ---------- fetchCuts ------------------------------------------------------

describe('fetchCuts', () => {
  it('happy path : requête cuts avec select incluant animal_id + 2 order ASC, retourne les rows', async () => {
    const rows = [
      { id: 'k1', animal_id: 'a1', slug: 'joue', name: 'Joue', sort_order: 10 },
      { id: 'k2', animal_id: 'a1', slug: 'colis-mixte', name: 'Colis mixte', sort_order: 300 },
    ];
    const { client, captured } = makeSupabase({ data: rows, error: null });

    const res = await fetchCuts(client);

    expect(res).toEqual(rows);
    expect(captured.from).toEqual(['cuts']);
    // animal_id obligatoire dans le select : sans lui, le filtre client-side
    // par animal sélectionné (cf. nouveau/page.tsx filteredCuts) ne marche pas.
    expect(captured.select).toEqual(['id, animal_id, slug, name, sort_order']);
    expect(captured.order).toEqual([
      ['sort_order', { ascending: true }],
      ['name', { ascending: true }],
    ]);
  });

  it('retourne [] si data est null', async () => {
    const { client } = makeSupabase({ data: null, error: null });

    const res = await fetchCuts(client);

    expect(res).toEqual([]);
  });

  it('throw si Supabase renvoie une error', async () => {
    const { client } = makeSupabase({
      data: null,
      error: { message: 'timeout' },
    });

    await expect(fetchCuts(client)).rejects.toMatchObject({
      message: 'timeout',
    });
  });
});
