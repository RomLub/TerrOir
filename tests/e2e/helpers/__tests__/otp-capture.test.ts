import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestContext, __resetRawClient } from '../supabase-admin';
import {
  generateOtpCode,
  hashOtp,
  __resetHmacKey,
} from '../otp-capture';

// Mock Supabase : le test ne touche pas une vraie DB.
// Pour seedOtp, on a besoin que safeInsert retourne un row avec un id,
// donc le mock builder retourne data={id: 'fake-row-id'} sur l'INSERT.
const insertedRows: Array<Record<string, unknown>> = [];
const deletedFilters: Array<Record<string, unknown>> = [];

vi.mock('@supabase/supabase-js', () => {
  const fakeBuilder = (op: 'insert' | 'update' | 'delete' | 'upsert' | null = null) => {
    const builder: any = { _op: op, _filter: {} };
    builder.insert = (payload: any) => {
      insertedRows.push(payload);
      const next = fakeBuilder('insert');
      next._payload = payload;
      return next;
    };
    builder.update = () => fakeBuilder('update');
    builder.delete = () => fakeBuilder('delete');
    builder.upsert = (payload: any) => {
      const next = fakeBuilder('upsert');
      next._payload = payload;
      return next;
    };
    builder.select = () => builder;
    builder.eq = (col: string, val: unknown) => {
      builder._filter[col] = val;
      if (builder._op === 'delete') {
        deletedFilters.push({ ...builder._filter });
      }
      return builder;
    };
    builder.in = (col: string, vals: unknown[]) => {
      builder._filter[col] = vals;
      return builder;
    };
    builder.order = () => builder;
    builder.limit = () => builder;
    builder.gte = () => builder;
    builder.maybeSingle = () => builder;
    builder.then = (onFulfilled: any) => {
      // Pour insert avec returning : retourner data avec un id
      if (builder._op === 'insert') {
        return Promise.resolve({
          data: [{ id: 'fake-otp-row-id-' + Date.now() }],
          error: null,
        }).then(onFulfilled);
      }
      return Promise.resolve({ data: [], error: null, count: 0 }).then(onFulfilled);
    };
    return builder;
  };

  return {
    createClient: vi.fn(() => ({
      from: vi.fn(() => fakeBuilder()),
    })),
  };
});

import { seedOtp } from '../otp-capture';

const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';

function makeCtx(overrides: Partial<TestContext> = {}): TestContext {
  return {
    runId: 'r-test-otp',
    testId: 'otp-capture-test',
    trackedIds: new Set<string>([TEST_USER_ID]),
    trackedEmails: new Set<string>(),
    ...overrides,
  };
}

describe('generateOtpCode', () => {
  it('produit une string de 6 chiffres', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{6}$/);
      expect(code.length).toBe(6);
    }
  });

  it('produit des codes différents (probabiliste)', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      codes.add(generateOtpCode());
    }
    expect(codes.size).toBeGreaterThanOrEqual(18);
  });
});

describe('hashOtp', () => {
  beforeEach(() => {
    process.env.EMAIL_CHANGE_OTP_SECRET = 'test-secret-32-chars-long-padding';
    __resetHmacKey();
  });

  it('produit un hash hex 64 caractères', async () => {
    const hash = await hashOtp('123456');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produit le même hash pour le même code (déterministe)', async () => {
    const h1 = await hashOtp('123456');
    const h2 = await hashOtp('123456');
    expect(h1).toBe(h2);
  });

  it('produit des hashs différents pour des codes différents', async () => {
    const h1 = await hashOtp('123456');
    const h2 = await hashOtp('654321');
    expect(h1).not.toBe(h2);
  });

  it('throw si EMAIL_CHANGE_OTP_SECRET absent', async () => {
    delete process.env.EMAIL_CHANGE_OTP_SECRET;
    __resetHmacKey();
    await expect(hashOtp('123456')).rejects.toThrow(/EMAIL_CHANGE_OTP_SECRET manquant/);
  });

  it('produit des hashs différents avec des secrets différents', async () => {
    process.env.EMAIL_CHANGE_OTP_SECRET = 'secret-A-padding-padding-padding';
    __resetHmacKey();
    const h1 = await hashOtp('123456');

    process.env.EMAIL_CHANGE_OTP_SECRET = 'secret-B-padding-padding-padding';
    __resetHmacKey();
    const h2 = await hashOtp('123456');

    expect(h1).not.toBe(h2);
  });
});

describe('seedOtp', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
    process.env.EMAIL_CHANGE_OTP_SECRET = 'test-secret-32-chars-long-padding';
    __resetRawClient();
    __resetHmacKey();
    insertedRows.length = 0;
    deletedFilters.length = 0;
  });

  it('génère un code à 6 chiffres si pas fourni', async () => {
    const ctx = makeCtx();
    const result = await seedOtp(ctx, {
      userId: TEST_USER_ID,
      step: 'current',
      email: 'playwright-test-1@mailinator.com',
    });
    expect(result.code).toMatch(/^\d{6}$/);
  });

  it('utilise le code fourni si présent', async () => {
    const ctx = makeCtx();
    const result = await seedOtp(ctx, {
      userId: TEST_USER_ID,
      step: 'current',
      email: 'playwright-test-1@mailinator.com',
      code: '999000',
    });
    expect(result.code).toBe('999000');
  });

  it('appelle DELETE avant INSERT pour (user_id, step)', async () => {
    const ctx = makeCtx();
    await seedOtp(ctx, {
      userId: TEST_USER_ID,
      step: 'current',
      email: 'playwright-test-1@mailinator.com',
    });
    expect(deletedFilters.length).toBeGreaterThanOrEqual(1);
    const lastDelete = deletedFilters[deletedFilters.length - 1];
    expect(lastDelete.user_id).toBe(TEST_USER_ID);
    expect(lastDelete.step).toBe('current');
  });

  it('INSERT contient le hash du code (vérifiable via hashOtp)', async () => {
    const ctx = makeCtx();
    const code = '123456';
    await seedOtp(ctx, {
      userId: TEST_USER_ID,
      step: 'current',
      email: 'playwright-test-1@mailinator.com',
      code,
    });
    const expectedHash = await hashOtp(code);
    const lastInsert = insertedRows[insertedRows.length - 1];
    expect((lastInsert as Record<string, unknown>).code_hash).toBe(expectedHash);
  });

  it('INSERT contient les bons user_id, step, email, attempts par défaut', async () => {
    const ctx = makeCtx();
    await seedOtp(ctx, {
      userId: TEST_USER_ID,
      step: 'new',
      email: 'playwright-test-1-new@mailinator.com',
    });
    const lastInsert = insertedRows[insertedRows.length - 1] as Record<string, unknown>;
    expect(lastInsert.user_id).toBe(TEST_USER_ID);
    expect(lastInsert.step).toBe('new');
    expect(lastInsert.email).toBe('playwright-test-1-new@mailinator.com');
    expect(lastInsert.attempts).toBe(0);
    expect(lastInsert.expires_at).toBeDefined();
  });

  it('expires_at par défaut = now + 600s (à ±5s près)', async () => {
    const ctx = makeCtx();
    const before = Date.now();
    await seedOtp(ctx, {
      userId: TEST_USER_ID,
      step: 'current',
      email: 'playwright-test-1@mailinator.com',
    });
    const after = Date.now();
    const lastInsert = insertedRows[insertedRows.length - 1] as Record<string, unknown>;
    const expiresAt = new Date(lastInsert.expires_at as string).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 600 * 1000 - 5000);
    expect(expiresAt).toBeLessThanOrEqual(after + 600 * 1000 + 5000);
  });

  it('expiresInSeconds custom est respecté', async () => {
    const ctx = makeCtx();
    const before = Date.now();
    await seedOtp(ctx, {
      userId: TEST_USER_ID,
      step: 'current',
      email: 'playwright-test-1@mailinator.com',
      expiresInSeconds: 120,
    });
    const lastInsert = insertedRows[insertedRows.length - 1] as Record<string, unknown>;
    const expiresAt = new Date(lastInsert.expires_at as string).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 120 * 1000 - 5000);
    expect(expiresAt).toBeLessThanOrEqual(before + 120 * 1000 + 5000);
  });

  it('attempts custom est respecté', async () => {
    const ctx = makeCtx();
    await seedOtp(ctx, {
      userId: TEST_USER_ID,
      step: 'current',
      email: 'playwright-test-1@mailinator.com',
      attempts: 3,
    });
    const lastInsert = insertedRows[insertedRows.length - 1] as Record<string, unknown>;
    expect(lastInsert.attempts).toBe(3);
  });

  it('refuse si userId pas dans trackedIds (via safeDelete validation)', async () => {
    const ctx = makeCtx({ trackedIds: new Set<string>() });
    await expect(
      seedOtp(ctx, {
        userId: TEST_USER_ID,
        step: 'current',
        email: 'playwright-test-1@mailinator.com',
      }),
    ).rejects.toThrow(/non tracké/);
  });

  it('track le rowId retourné dans ctx.trackedIds', async () => {
    const ctx = makeCtx();
    const sizeBefore = ctx.trackedIds.size;
    const { rowId } = await seedOtp(ctx, {
      userId: TEST_USER_ID,
      step: 'current',
      email: 'playwright-test-1@mailinator.com',
    });
    expect(ctx.trackedIds.has(rowId)).toBe(true);
    expect(ctx.trackedIds.size).toBe(sizeBefore + 1);
  });
});
