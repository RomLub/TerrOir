import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestContext } from '../supabase-admin';
import { ProtectedEmailError } from '../guards';

// Mock Supabase comme dans supabase-admin.test.ts
vi.mock('@supabase/supabase-js', () => {
  const fakeBuilder = () => {
    const builder: any = {};
    const chain = () => builder;
    builder.insert = chain;
    builder.update = chain;
    builder.delete = chain;
    builder.upsert = chain;
    builder.select = chain;
    builder.eq = chain;
    builder.in = chain;
    builder.then = (onFulfilled: any) =>
      Promise.resolve({ data: [], error: null }).then(onFulfilled);
    return builder;
  };

  let createUserCalls = 0;

  return {
    createClient: vi.fn(() => ({
      from: vi.fn(() => fakeBuilder()),
      auth: {
        admin: {
          createUser: vi.fn(({ email }: { email: string }) => {
            createUserCalls++;
            return Promise.resolve({
              data: {
                user: {
                  id: `00000000-0000-0000-0000-${String(createUserCalls).padStart(12, '0')}`,
                  email,
                },
              },
              error: null,
            });
          }),
          deleteUser: vi.fn(() => Promise.resolve({ data: null, error: null })),
        },
      },
    })),
  };
});

import { __resetRawClient } from '../supabase-admin';
import { createTestUser, cleanupTestUser, cleanupAllTrackedUsers } from '../user-lifecycle';

function makeCtx(): TestContext {
  return {
    runId: 'r-test',
    testId: 'lifecycle-test',
    trackedUserIds: new Set<string>(),
    trackedRowIds: new Set<string>(),
    trackedEmails: new Set<string>(),
  };
}

describe('createTestUser', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
    __resetRawClient();
  });

  it('crée un user avec email matchant le pattern', async () => {
    const ctx = makeCtx();
    const user = await createTestUser(ctx);
    expect(user.email).toMatch(/^playwright-test-\d+@mailinator\.com$/);
    expect(user.id).toBeTruthy();
    expect(user.password).toHaveLength(18); // 'A1' + 16 chars
  });

  it('push id et email dans les Sets trackés', async () => {
    const ctx = makeCtx();
    const user = await createTestUser(ctx);
    expect(ctx.trackedUserIds.has(user.id)).toBe(true);
    expect(ctx.trackedEmails.has(user.email)).toBe(true);
  });

  it('accepte un suffix dans options', async () => {
    const ctx = makeCtx();
    const user = await createTestUser(ctx, { suffix: 'happypath' });
    expect(user.email).toContain('-happypath@');
  });

  it('accepte un password override', async () => {
    const ctx = makeCtx();
    const user = await createTestUser(ctx, { password: 'CustomPwd123!' });
    expect(user.password).toBe('CustomPwd123!');
  });
});

describe('cleanupTestUser', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
    __resetRawClient();
  });

  it('refuse de cleanup un user non tracké', async () => {
    const ctx = makeCtx();
    await expect(
      cleanupTestUser(ctx, '99999999-9999-9999-9999-999999999999'),
    ).rejects.toThrow(/non tracké/);
  });

  it('cleanup un user tracké sans throw', async () => {
    const ctx = makeCtx();
    const user = await createTestUser(ctx);
    await expect(cleanupTestUser(ctx, user.id)).resolves.not.toThrow();
  });
});

describe('cleanupAllTrackedUsers', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
    __resetRawClient();
  });

  it('cleanup tous les users trackés et clear les Sets', async () => {
    const ctx = makeCtx();
    await createTestUser(ctx, { suffix: 'a' });
    await createTestUser(ctx, { suffix: 'b' });
    expect(ctx.trackedUserIds.size).toBe(2);

    await cleanupAllTrackedUsers(ctx);
    expect(ctx.trackedUserIds.size).toBe(0);
    expect(ctx.trackedRowIds.size).toBe(0);
    expect(ctx.trackedEmails.size).toBe(0);
  });
});
