import { describe, it, expect } from 'vitest';
import { parseProductsSearchParams } from '@/lib/products/parse-search-params';

describe('parseProductsSearchParams — happy path', () => {
  it('3 filtres slugs valides retournés tels quels', () => {
    expect(
      parseProductsSearchParams({
        cut: 'entrecote',
        animal: 'boeuf',
        category: 'viande',
      }),
    ).toEqual({ cut: 'entrecote', animal: 'boeuf', category: 'viande' });
  });

  it('searchParams undefined → 3 nulls', () => {
    expect(parseProductsSearchParams(undefined)).toEqual({
      cut: null,
      animal: null,
      category: null,
    });
  });

  it('searchParams vide → 3 nulls', () => {
    expect(parseProductsSearchParams({})).toEqual({
      cut: null,
      animal: null,
      category: null,
    });
  });

  it('autres clés ignorées (ne pollue pas les 3 filtres connus)', () => {
    expect(
      parseProductsSearchParams({ cut: 'entrecote', random: 'value' }),
    ).toEqual({ cut: 'entrecote', animal: null, category: null });
  });
});

describe('parseProductsSearchParams — sanitization slug', () => {
  it('slug avec caractères interdits → null (préserve les autres filtres valides)', () => {
    const result = parseProductsSearchParams({
      cut: 'ENTRECOTE!',
      animal: 'boeuf',
      category: 'viande/bio',
    });
    expect(result.cut).toBeNull();
    expect(result.animal).toBe('boeuf');
    expect(result.category).toBeNull();
  });

  it('slug vide string → null', () => {
    expect(parseProductsSearchParams({ cut: '' }).cut).toBeNull();
  });

  it('slug whitespace-only → null', () => {
    expect(parseProductsSearchParams({ cut: '   ' }).cut).toBeNull();
  });

  it('slug array → null (Next.js peut passer array si ?cut=a&cut=b)', () => {
    expect(parseProductsSearchParams({ cut: ['a', 'b'] }).cut).toBeNull();
  });

  it('majuscules rejetées (regex strict kebab-case)', () => {
    expect(parseProductsSearchParams({ cut: 'Entrecote' }).cut).toBeNull();
  });

  it('underscores rejetés', () => {
    expect(parseProductsSearchParams({ cut: 'entre_cote' }).cut).toBeNull();
  });

  it('tirets multiples consécutifs rejetés', () => {
    expect(parseProductsSearchParams({ cut: 'entre--cote' }).cut).toBeNull();
  });

  it('tiret en début ou fin rejetés', () => {
    expect(parseProductsSearchParams({ cut: '-entrecote' }).cut).toBeNull();
    expect(parseProductsSearchParams({ cut: 'entrecote-' }).cut).toBeNull();
  });
});
