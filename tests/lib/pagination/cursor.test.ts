import { describe, expect, it, vi } from 'vitest';
import {
  applyCursor,
  buildCursorUrl,
  parseCursor,
} from '@/lib/pagination/cursor';

describe('parseCursor', () => {
  it('retourne null/null quand aucun param présent', () => {
    const sp = new URLSearchParams();
    expect(parseCursor(sp)).toEqual({ before: null, beforeId: null });
  });

  it('retourne null/null quand only before sans before_id', () => {
    const sp = new URLSearchParams({ before: '2026-05-01T10:00:00Z' });
    expect(parseCursor(sp)).toEqual({ before: null, beforeId: null });
  });

  it('retourne null/null quand only before_id sans before', () => {
    const sp = new URLSearchParams({ before_id: 'abc-123' });
    expect(parseCursor(sp)).toEqual({ before: null, beforeId: null });
  });

  it('retourne le couple parsé quand les deux params présents', () => {
    const sp = new URLSearchParams({
      before: '2026-05-01T10:00:00Z',
      before_id: '11111111-2222-3333-4444-555555555555',
    });
    expect(parseCursor(sp)).toEqual({
      before: '2026-05-01T10:00:00Z',
      beforeId: '11111111-2222-3333-4444-555555555555',
    });
  });
});

describe('buildCursorUrl', () => {
  it('construit ?before=...&before_id=...', () => {
    const url = buildCursorUrl('/compte/commandes', {
      created_at: '2026-05-01T10:00:00Z',
      id: '11111111-2222-3333-4444-555555555555',
    });
    expect(url).toBe(
      '/compte/commandes?before=2026-05-01T10%3A00%3A00Z&before_id=11111111-2222-3333-4444-555555555555',
    );
  });

  it('encode correctement les caractères spéciaux du timestamp', () => {
    const url = buildCursorUrl('/x', {
      created_at: '2026-05-01T10:00:00.123+02:00',
      id: 'aaaa',
    });
    // Les `:` et `+` doivent être URL-encodés, mais `.` et chiffres restent.
    expect(url).toContain('before=2026-05-01T10%3A00%3A00.123%2B02%3A00');
    expect(url).toContain('before_id=aaaa');
  });
});

describe('applyCursor', () => {
  it('retourne la query inchangée quand aucun cursor', () => {
    const lt = vi.fn();
    const or = vi.fn();
    const query = { lt, or };
    const result = applyCursor(query, { before: null, beforeId: null });
    expect(result).toBe(query);
    expect(lt).not.toHaveBeenCalled();
    expect(or).not.toHaveBeenCalled();
  });

  it('appelle .or() avec le tie-breaker sur (created_at, id) quand cursor fourni', () => {
    const next = { lt: vi.fn(), or: vi.fn() };
    const or = vi.fn(() => next);
    const lt = vi.fn();
    const query = { lt, or };
    const result = applyCursor(query, {
      before: '2026-05-01T10:00:00Z',
      beforeId: '11111111-2222-3333-4444-555555555555',
    });
    expect(or).toHaveBeenCalledTimes(1);
    expect(or).toHaveBeenCalledWith(
      'created_at.lt.2026-05-01T10:00:00Z,and(created_at.eq.2026-05-01T10:00:00Z,id.lt.11111111-2222-3333-4444-555555555555)',
    );
    expect(result).toBe(next);
    expect(lt).not.toHaveBeenCalled();
  });

  it('ignore un cursor partiel (before sans beforeId)', () => {
    const query = { lt: vi.fn(), or: vi.fn() };
    const result = applyCursor(query, {
      before: '2026-05-01T10:00:00Z',
      beforeId: null,
    });
    expect(result).toBe(query);
    expect(query.or).not.toHaveBeenCalled();
  });
});
