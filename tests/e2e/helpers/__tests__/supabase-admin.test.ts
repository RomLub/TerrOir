import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  safeInsert,
  safeUpdate,
  safeDelete,
  safeUpsert,
  trackId,
  trackEmail,
  UnsafeWriteError,
  TestContext,
  __resetRawClient,
} from '../supabase-admin';
import { ProtectedEmailError } from '../guards';

// Mock @supabase/supabase-js : on ne touche pas la vraie DB ici
vi.mock('@supabase/supabase-js', () => {
  const fakeBuilder = () => {
    const builder: any = {
      _ops: [] as Array<{ method: string; args: unknown[] }>,
    };
    const record = (method: string) => (...args: unknown[]) => {
      builder._ops.push({ method, args });
      return builder;
    };
    builder.insert = record('insert');
    builder.update = record('update');
    builder.delete = record('delete');
    builder.upsert = record('upsert');
    builder.select = record('select');
    builder.eq = record('eq');
    builder.in = record('in');
    builder.then = (onFulfilled: any) => Promise.resolve({ data: [], error: null }).then(onFulfilled);
    return builder;
  };

  return {
    createClient: vi.fn(() => ({
      from: vi.fn(() => fakeBuilder()),
    })),
  };
});

const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';
const TEST_USER_ID_2 = '22222222-2222-2222-2222-222222222222';

function makeCtx(overrides: Partial<TestContext> = {}): TestContext {
  return {
    runId: 'r-test-run',
    testId: 'test-suite > sample',
    trackedIds: new Set<string>(),
    trackedEmails: new Set<string>(),
    ...overrides,
  };
}

describe('supabase-admin helpers', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
    __resetRawClient();
  });

  describe('safeInsert', () => {
    it('accepte un payload sans email', async () => {
      const ctx = makeCtx();
      await expect(
        safeInsert(ctx, 'audit_logs', { event: 'test', data: {} }),
      ).resolves.toBeDefined();
    });

    it('accepte un payload avec email valide', async () => {
      const ctx = makeCtx();
      await expect(
        safeInsert(ctx, 'users', { email: 'playwright-test-123@mailinator.com' }),
      ).resolves.toBeDefined();
    });

    it('refuse un payload avec email protégé', async () => {
      const ctx = makeCtx();
      await expect(
        safeInsert(ctx, 'users', { email: 'lubin.rom@gmail.com' }),
      ).rejects.toThrow(ProtectedEmailError);
    });

    it('refuse un payload array contenant un email non-safe', async () => {
      const ctx = makeCtx();
      await expect(
        safeInsert(ctx, 'users', [
          { email: 'playwright-test-1@mailinator.com' },
          { email: 'random@evil.com' },
        ]),
      ).rejects.toThrow(ProtectedEmailError);
    });
  });

  describe('safeUpdate', () => {
    it('refuse un update sans filtre', async () => {
      const ctx = makeCtx({ trackedIds: new Set([TEST_USER_ID]) });
      await expect(
        safeUpdate(ctx, 'users', { name: 'foo' }, {}),
      ).rejects.toThrow(UnsafeWriteError);
    });

    it('refuse un update sur id non tracké', async () => {
      const ctx = makeCtx({ trackedIds: new Set([TEST_USER_ID]) });
      await expect(
        safeUpdate(ctx, 'users', { name: 'foo' }, { id: TEST_USER_ID_2 }),
      ).rejects.toThrow(UnsafeWriteError);
    });

    it('accepte un update sur id tracké', async () => {
      const ctx = makeCtx({ trackedIds: new Set([TEST_USER_ID]) });
      await expect(
        safeUpdate(ctx, 'users', { name: 'foo' }, { id: TEST_USER_ID }),
      ).resolves.toBeDefined();
    });

    it('refuse un update avec nouvel email protégé dans le payload', async () => {
      const ctx = makeCtx({ trackedIds: new Set([TEST_USER_ID]) });
      await expect(
        safeUpdate(
          ctx,
          'users',
          { email: 'lubin.rom@gmail.com' },
          { id: TEST_USER_ID },
        ),
      ).rejects.toThrow(ProtectedEmailError);
    });

    it('refuse un update sur email protégé dans le filtre', async () => {
      const ctx = makeCtx();
      await expect(
        safeUpdate(ctx, 'users', { name: 'foo' }, { email: 'lubin.rom@gmail.com' }),
      ).rejects.toThrow(ProtectedEmailError);
    });

    it('accepte un update via filter user_id tracké', async () => {
      const ctx = makeCtx({ trackedIds: new Set([TEST_USER_ID]) });
      await expect(
        safeUpdate(ctx, 'sessions', { revoked: true }, { user_id: TEST_USER_ID }),
      ).resolves.toBeDefined();
    });
  });

  describe('safeDelete', () => {
    it('refuse un delete sans filtre', async () => {
      const ctx = makeCtx();
      await expect(safeDelete(ctx, 'users', {})).rejects.toThrow(UnsafeWriteError);
    });

    it('refuse un delete sur id non tracké', async () => {
      const ctx = makeCtx({ trackedIds: new Set([TEST_USER_ID]) });
      await expect(
        safeDelete(ctx, 'users', { id: TEST_USER_ID_2 }),
      ).rejects.toThrow(UnsafeWriteError);
    });

    it('accepte un delete sur id tracké', async () => {
      const ctx = makeCtx({ trackedIds: new Set([TEST_USER_ID]) });
      await expect(
        safeDelete(ctx, 'users', { id: TEST_USER_ID }),
      ).resolves.toBeDefined();
    });

    it('refuse un delete sur email protégé', async () => {
      const ctx = makeCtx();
      await expect(
        safeDelete(ctx, 'users', { email: 'lubin.rom@gmail.com' }),
      ).rejects.toThrow(ProtectedEmailError);
    });

    it('refuse un delete avec id IN [...] contenant un id non tracké', async () => {
      const ctx = makeCtx({ trackedIds: new Set([TEST_USER_ID]) });
      await expect(
        safeDelete(ctx, 'users', { id: [TEST_USER_ID, TEST_USER_ID_2] }),
      ).rejects.toThrow(UnsafeWriteError);
    });
  });

  describe('safeUpsert', () => {
    it('refuse un upsert avec email protégé', async () => {
      const ctx = makeCtx();
      await expect(
        safeUpsert(ctx, 'users', { email: 'lubin.rom@gmail.com' }),
      ).rejects.toThrow(ProtectedEmailError);
    });

    it('accepte un upsert avec email valide', async () => {
      const ctx = makeCtx();
      await expect(
        safeUpsert(ctx, 'users', { email: 'playwright-test-1@mailinator.com' }),
      ).resolves.toBeDefined();
    });
  });

  describe('tracking helpers', () => {
    it('trackId ajoute au Set', () => {
      const ctx = makeCtx();
      trackId(ctx, TEST_USER_ID);
      expect(ctx.trackedIds.has(TEST_USER_ID)).toBe(true);
    });

    it('trackEmail valide via assertSafeEmail puis ajoute', () => {
      const ctx = makeCtx();
      trackEmail(ctx, 'playwright-test-1@mailinator.com');
      expect(ctx.trackedEmails.has('playwright-test-1@mailinator.com')).toBe(true);
    });

    it('trackEmail refuse un email protégé', () => {
      const ctx = makeCtx();
      expect(() => trackEmail(ctx, 'lubin.rom@gmail.com')).toThrow(ProtectedEmailError);
    });
  });
});
