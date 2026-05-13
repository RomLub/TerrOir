import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Tests getInvitationConversionStats — assertions ratio + edge cases.

type CountResp = { count: number | null; error: unknown };

const queue: CountResp[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => {
      const b: any = {};
      b.select = () => b;
      b.eq = () => b;
      b.gte = () => b;
      b.then = (onFulfilled: (r: CountResp) => unknown) => {
        const r = queue.shift() ?? { count: 0, error: null };
        return onFulfilled(r);
      };
      return b;
    },
  }),
}));

import { getInvitationConversionStats } from "@/lib/audit-logs/invitation-conversion-stats";

beforeEach(() => {
  queue.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getInvitationConversionStats", () => {
  it("calcule un taux propre quand sent > 0", async () => {
    queue.push({ count: 10, error: null }); // sent
    queue.push({ count: 4, error: null }); // completed

    const stats = await getInvitationConversionStats();
    expect(stats.invitationsSent).toBe(10);
    expect(stats.onboardingsCompleted).toBe(4);
    expect(stats.conversionRatePct).toBe(40);
    expect(stats.windowDays).toBe(30);
  });

  it("conversionRatePct = null quand sent = 0 (évite div/0)", async () => {
    queue.push({ count: 0, error: null });
    queue.push({ count: 0, error: null });

    const stats = await getInvitationConversionStats();
    expect(stats.invitationsSent).toBe(0);
    expect(stats.conversionRatePct).toBeNull();
  });

  it("arrondi à 1 décimale (33.3 % au lieu de 33.333…)", async () => {
    queue.push({ count: 3, error: null });
    queue.push({ count: 1, error: null });

    const stats = await getInvitationConversionStats();
    expect(stats.conversionRatePct).toBe(33.3);
  });

  it("respecte windowDays custom", async () => {
    queue.push({ count: 5, error: null });
    queue.push({ count: 2, error: null });

    const stats = await getInvitationConversionStats({ windowDays: 90 });
    expect(stats.windowDays).toBe(90);
    expect(stats.conversionRatePct).toBe(40);
  });
});
