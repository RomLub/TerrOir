import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// =============================================================================
// Rate-limit infra (T-305 PR-A) — Upstash Redis + sliding window
// =============================================================================
// PR-A pose l'infra réutilisable : singleton Redis lazy, factory générique,
// 3 helpers preconfigurés (signup/login/recovery), fail-open systématique.
// PR-B intégrera les call sites (signup/login/recovery routes) et posera
// l'audit log applicatif (event 'rate_limit_exceeded') côté caller — la lib
// retourne juste un RateLimitResult, elle ne logue pas l'event audit
// elle-même (mauvais couplage).
//
// Caps audit T-305 (ajustables PR-B selon UX réel) :
//   signup     5/min IP
//   login      5/min IP
//   recovery   3/min IP
//
// Fail-open : si UPSTASH_REDIS_REST_URL/TOKEN absent OU Redis throw au
// runtime, on renvoie success=true. Rationnel : un incident Upstash ne doit
// pas bloquer la signup/login en prod (DOS auto-infligé). Le warn/error
// console alimentera les alertes Vercel pour réaction hors-bande.
// =============================================================================

let redisInstance: Redis | null = null;
let envChecked = false;

function getRedis(): Redis | null {
  if (envChecked) return redisInstance;
  envChecked = true;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.warn(
      "[RATE_LIMIT_WARN] UPSTASH_REDIS_REST_URL/TOKEN absent — fail-open mode (rate limit désactivé)",
    );
    return null;
  }
  redisInstance = new Redis({ url, token });
  return redisInstance;
}

// Window typé (cohérent @upstash/ratelimit Duration). Restreint aux unités
// raisonnables pour rate-limit auth (pas de "1 d" attendu).
export type RateLimitWindow = `${number} ${"ms" | "s" | "m" | "h"}`;

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
};

// Factory générique : crée un Ratelimit configuré ou null si Redis indispo.
// Le prefix scope les clés Redis par flow (évite collision signup/login/etc).
export function createRateLimiter(
  requests: number,
  window: RateLimitWindow,
  prefix: string,
): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(requests, window),
    prefix: `ratelimit:${prefix}`,
    analytics: true,
  });
}

// Helper consume : prend un identifier (IP ou autre clé) et retourne un
// résultat normalisé. Fail-open systématique :
//   - limiter null  (env vars absentes) → success=true
//   - limiter throw (Redis down/timeout) → success=true + console.error
export async function consumeRateLimit(
  limiter: Ratelimit | null,
  identifier: string,
): Promise<RateLimitResult> {
  if (!limiter) {
    return { success: true, limit: 0, remaining: 0, reset: 0 };
  }
  try {
    const result = await limiter.limit(identifier);
    return {
      success: result.success,
      limit: result.limit,
      remaining: result.remaining,
      reset: result.reset,
    };
  } catch (err) {
    console.error(
      `[RATE_LIMIT_REDIS_ERROR] identifier=${identifier} error=${(err as Error).message}`,
    );
    return { success: true, limit: 0, remaining: 0, reset: 0 };
  }
}

// Helpers preconfigurés selon caps audit T-305. Lazy + memoized : pas de
// client Redis créé tant qu'aucun helper n'est appelé. La memoization évite
// de recréer le Ratelimit à chaque appel route handler.
//
// Audit Auth 2026-05-05 M-5 : magic_link séparé de login (3/120s vs 5/60s).
// Rationnel : login mdp et magic link partageaient le même cap, ce qui
// permettait à un attaquant de consommer le quota login pour tous les
// users derrière une IP NAT en floodant le magic link.
let _signupLimiter: Ratelimit | null | undefined;
let _loginLimiter: Ratelimit | null | undefined;
let _magicLinkLimiter: Ratelimit | null | undefined;
let _recoveryLimiter: Ratelimit | null | undefined;

export function getSignupRateLimit(): Ratelimit | null {
  if (_signupLimiter === undefined) {
    _signupLimiter = createRateLimiter(5, "60 s", "signup");
  }
  return _signupLimiter;
}

export function getLoginRateLimit(): Ratelimit | null {
  if (_loginLimiter === undefined) {
    _loginLimiter = createRateLimiter(5, "60 s", "login");
  }
  return _loginLimiter;
}

export function getMagicLinkRateLimit(): Ratelimit | null {
  if (_magicLinkLimiter === undefined) {
    _magicLinkLimiter = createRateLimiter(3, "120 s", "magic_link");
  }
  return _magicLinkLimiter;
}

export function getRecoveryRateLimit(): Ratelimit | null {
  if (_recoveryLimiter === undefined) {
    _recoveryLimiter = createRateLimiter(3, "60 s", "recovery");
  }
  return _recoveryLimiter;
}
