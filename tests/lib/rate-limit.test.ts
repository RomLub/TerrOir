import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// server-only throw côté browser ; en test environment, mock le pour éviter
// le throw au top-level import.
vi.mock("server-only", () => ({}));

// --- Mocks ----------------------------------------------------------------
// On mock @upstash/ratelimit + @upstash/redis pour ne pas appeler le vrai
// service en CI. Pattern hoisted pour être disponible avant les vi.mock.

const { mockLimit, MockRatelimitClass, MockRedisClass, mockSlidingWindow } =
  vi.hoisted(() => {
    const mockLimit = vi.fn();
    const mockSlidingWindow = vi
      .fn()
      .mockReturnValue({ algo: "sliding-window" });
    function MockRatelimit(this: Record<string, unknown>, config: unknown) {
      this.limit = mockLimit;
      this.config = config;
    }
    (MockRatelimit as unknown as { slidingWindow: typeof mockSlidingWindow }).slidingWindow =
      mockSlidingWindow;
    function MockRedis(this: Record<string, unknown>, config: unknown) {
      this.config = config;
    }
    return {
      mockLimit,
      MockRatelimitClass: vi.fn(MockRatelimit),
      MockRedisClass: vi.fn(MockRedis),
      mockSlidingWindow,
    };
  });

// Réattacher slidingWindow au mock final (vi.fn wrap perd les props static).
(MockRatelimitClass as unknown as { slidingWindow: typeof mockSlidingWindow }).slidingWindow =
  mockSlidingWindow;

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: MockRatelimitClass,
}));

vi.mock("@upstash/redis", () => ({
  Redis: MockRedisClass,
}));

// --- Setup / teardown -----------------------------------------------------

beforeEach(() => {
  // Reset state singleton du module (envChecked, redisInstance, _*Limiter).
  vi.resetModules();
  mockLimit.mockReset();
  mockSlidingWindow.mockClear();
  mockSlidingWindow.mockReturnValue({ algo: "sliding-window" });
  MockRatelimitClass.mockClear();
  MockRedisClass.mockClear();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe("rate-limit (T-305 PR-A infra)", () => {
  it("env vars manquantes → getSignupRateLimit retourne null + console.warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("@/lib/rate-limit");

    expect(mod.getSignupRateLimit()).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("UPSTASH_REDIS_REST_URL/TOKEN absent"),
    );
    expect(MockRedisClass).not.toHaveBeenCalled();
  });

  it("env vars set → getSignupRateLimit retourne instance Ratelimit avec prefix correct", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://x.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
    const mod = await import("@/lib/rate-limit");

    const limiter = mod.getSignupRateLimit();

    expect(limiter).not.toBeNull();
    expect(MockRedisClass).toHaveBeenCalledWith({
      url: "https://x.upstash.io",
      token: "tok",
    });
    expect(MockRatelimitClass).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: "ratelimit:signup", analytics: true }),
    );
    expect(mockSlidingWindow).toHaveBeenCalledWith(5, "60 s");
  });

  it("getSignupRateLimit appelé 2× → même instance (memoized + Redis instancié 1 seule fois)", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://x.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
    const mod = await import("@/lib/rate-limit");

    const a = mod.getSignupRateLimit();
    const b = mod.getSignupRateLimit();

    expect(a).toBe(b);
    expect(MockRatelimitClass).toHaveBeenCalledTimes(1);
    expect(MockRedisClass).toHaveBeenCalledTimes(1);
  });

  it("getLoginRateLimit configuré 5/60s prefix ratelimit:login", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://x.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
    const mod = await import("@/lib/rate-limit");

    mod.getLoginRateLimit();

    expect(MockRatelimitClass).toHaveBeenLastCalledWith(
      expect.objectContaining({ prefix: "ratelimit:login" }),
    );
    expect(mockSlidingWindow).toHaveBeenCalledWith(5, "60 s");
  });

  it("getRecoveryRateLimit configuré 3/60s prefix ratelimit:recovery", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://x.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
    const mod = await import("@/lib/rate-limit");

    mod.getRecoveryRateLimit();

    expect(MockRatelimitClass).toHaveBeenLastCalledWith(
      expect.objectContaining({ prefix: "ratelimit:recovery" }),
    );
    expect(mockSlidingWindow).toHaveBeenCalledWith(3, "60 s");
  });

  it("consumeRateLimit avec limiter null → fail-open success=true (env vars absentes)", async () => {
    const mod = await import("@/lib/rate-limit");

    const result = await mod.consumeRateLimit(null, "1.2.3.4");

    expect(result).toEqual({ success: true, limit: 0, remaining: 0, reset: 0 });
    expect(mockLimit).not.toHaveBeenCalled();
  });

  it("consumeRateLimit avec limiter qui throw → fail-open success=true + console.error", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://x.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
    mockLimit.mockRejectedValue(new Error("redis down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("@/lib/rate-limit");

    const limiter = mod.getSignupRateLimit();
    const result = await mod.consumeRateLimit(limiter, "1.2.3.4");

    expect(result.success).toBe(true);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("redis down"),
    );
  });

  it("consumeRateLimit happy path within cap → success=true + remaining décrémenté", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://x.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
    const reset = Date.now() + 60_000;
    mockLimit.mockResolvedValue({
      success: true,
      limit: 5,
      remaining: 4,
      reset,
    });
    const mod = await import("@/lib/rate-limit");

    const limiter = mod.getSignupRateLimit();
    const result = await mod.consumeRateLimit(limiter, "1.2.3.4");

    expect(result).toEqual({ success: true, limit: 5, remaining: 4, reset });
    expect(mockLimit).toHaveBeenCalledWith("1.2.3.4");
  });

  it("consumeRateLimit happy path over cap → success=false + remaining=0", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://x.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
    const reset = Date.now() + 60_000;
    mockLimit.mockResolvedValue({
      success: false,
      limit: 5,
      remaining: 0,
      reset,
    });
    const mod = await import("@/lib/rate-limit");

    const limiter = mod.getSignupRateLimit();
    const result = await mod.consumeRateLimit(limiter, "1.2.3.4");

    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);
  });
});
