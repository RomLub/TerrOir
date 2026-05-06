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
//
// Audit Stripe pré-launch W-2 (2026-05-05) : extension aux 3 endpoints
// Stripe write — keying par userId (session obligatoire sur les 3 routes).
// Caps choisis pour absorber les retries légitimes (réseau flaky, double-clic
// React) sans bloquer les flows nominaux :
//   create_payment_intent  10/60s — 1 PI/checkout, retries 2-3 typiques.
//   refund                  5/60s — admin/producer manuel, 2-3/min en pratique.
//   connect_onboard         3/60s — 1 onboard/producer, retry erreur OK.
let _signupLimiter: Ratelimit | null | undefined;
let _loginLimiter: Ratelimit | null | undefined;
let _magicLinkLimiter: Ratelimit | null | undefined;
let _recoveryLimiter: Ratelimit | null | undefined;
let _stripeCreatePaymentIntentLimiter: Ratelimit | null | undefined;
let _stripeRefundLimiter: Ratelimit | null | undefined;
let _stripeConnectOnboardLimiter: Ratelimit | null | undefined;
// Page /contact (P0 légales 2026-05-06) : cap volontairement bas (3/h/IP)
// car spam form public à fort coût (envoi email Resend + bruit dans la
// boîte support contact@terroir-local.fr). Honeypot anti-bot côté route
// reste la première ligne de défense ; le rate-limit absorbe les spammers
// qui contournent le honeypot.
let _contactFormLimiter: Ratelimit | null | undefined;
// T-083 : page /admin/audit-logs lookup email → user_id. Cap 30/min/admin
// pour limiter l'usage en oracle énumération même si l'admin est de
// confiance (defense-in-depth + détection forensique d'abus côté audit
// log meta event 'admin_audit_logs_email_lookup'). Pas IP-keyed : tous
// les admins partagent le réseau bureau quand co-localisés.
let _auditLogsEmailLookupLimiter: Ratelimit | null | undefined;
// T-219 : route /api/geocode (cache CP→lat/lng). Cap 30/min/IP — un
// utilisateur légitime saisit quelques CPs par session ; au-delà = soit
// énumération de CPs (trilatération inverse, cf. T-236), soit script abus.
// Identifier IP éphémère côté Upstash (TTL = window), pas de persistance
// applicative DB. Continuité T-200 r1 : pas de profilage user, pas de
// jointure user→cp côté geocode_cache.
let _geocodeLimiter: Ratelimit | null | undefined;
// T-236 : route /api/producers/search. Cap 30/min/IP — pendant l'usage
// nominal (carte consumer + filtre rayon), 1-3 requêtes par session
// utilisateur typique. Au-delà = balayage de CPs visant à trianguler la
// position d'un producteur via les distances retournées (attaque de
// trilatération inverse, cf. T-227 backlog). Couplé au flou roundCoord ~1km
// déjà appliqué côté search route et fetchPublicProducerBySlug, ce cap
// rend économiquement non rentable l'attaque (au plus 30 mesures/min/IP,
// chacune bruitée par l'arrondi). Identifier IP éphémère, pas de log par-IP.
let _producersSearchLimiter: Ratelimit | null | undefined;
// Pickup validation (saisie code retrait producer). Cap 10/min keying par
// producerId : un producer en marché peut valider plusieurs commandes à la
// suite (10/min absorbe la cadence "queue de clients" sans bloquer le
// flow nominal), au-delà = soit script qui énumère des codes, soit double-
// clic réseau flaky. Keying producerId (et non IP) car plusieurs producers
// peuvent partager un NAT en marché. Defense in depth + audit log
// 'pickup_attempt_rate_limited' côté caller pour détection forensique.
let _pickupValidationLimiter: Ratelimit | null | undefined;

// Export comptable (consumer/producer). Cap 5/min keying par userId : un
// utilisateur consulte son historique 1-2 fois par session, max 3-5/min en
// pratique (changement de période, retry réseau). Au-delà = scripting,
// extraction massive. Keying userId pour éviter NAT-collision et garantir
// l'isolation par compte (cohérent caps Stripe write keying userId).
let _exportComptaLimiter: Ratelimit | null | undefined;

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

export function getStripeCreatePaymentIntentRateLimit(): Ratelimit | null {
  if (_stripeCreatePaymentIntentLimiter === undefined) {
    _stripeCreatePaymentIntentLimiter = createRateLimiter(
      10,
      "60 s",
      "stripe_create_payment_intent",
    );
  }
  return _stripeCreatePaymentIntentLimiter;
}

export function getStripeRefundRateLimit(): Ratelimit | null {
  if (_stripeRefundLimiter === undefined) {
    _stripeRefundLimiter = createRateLimiter(5, "60 s", "stripe_refund");
  }
  return _stripeRefundLimiter;
}

export function getStripeConnectOnboardRateLimit(): Ratelimit | null {
  if (_stripeConnectOnboardLimiter === undefined) {
    _stripeConnectOnboardLimiter = createRateLimiter(
      3,
      "60 s",
      "stripe_connect_onboard",
    );
  }
  return _stripeConnectOnboardLimiter;
}

export function getContactFormRateLimit(): Ratelimit | null {
  if (_contactFormLimiter === undefined) {
    _contactFormLimiter = createRateLimiter(3, "1 h", "contact_form");
  }
  return _contactFormLimiter;
}

export function getAuditLogsEmailLookupRateLimit(): Ratelimit | null {
  if (_auditLogsEmailLookupLimiter === undefined) {
    _auditLogsEmailLookupLimiter = createRateLimiter(
      30,
      "60 s",
      "audit_logs_email_lookup",
    );
  }
  return _auditLogsEmailLookupLimiter;
}

export function getGeocodeRateLimit(): Ratelimit | null {
  if (_geocodeLimiter === undefined) {
    _geocodeLimiter = createRateLimiter(30, "60 s", "geocode");
  }
  return _geocodeLimiter;
}

export function getProducersSearchRateLimit(): Ratelimit | null {
  if (_producersSearchLimiter === undefined) {
    _producersSearchLimiter = createRateLimiter(
      30,
      "60 s",
      "producers_search",
    );
  }
  return _producersSearchLimiter;
}

export function getPickupValidationRateLimit(): Ratelimit | null {
  if (_pickupValidationLimiter === undefined) {
    _pickupValidationLimiter = createRateLimiter(
      10,
      "60 s",
      "pickup_validation",
    );
  }
  return _pickupValidationLimiter;
}

export function getExportComptaRateLimit(): Ratelimit | null {
  if (_exportComptaLimiter === undefined) {
    _exportComptaLimiter = createRateLimiter(5, "60 s", "export_compta");
  }
  return _exportComptaLimiter;
}
