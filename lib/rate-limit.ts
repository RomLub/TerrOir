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

// Bypass e2e (tests Playwright TerrOir) — TRIPLE GATE pour rendre
// l'activation accidentelle en preview/prod impossible :
//   1. NODE_ENV !== 'production'
//   2. RATE_LIMIT_BYPASS_TESTS === 'true'
//   3. PLAYWRIGHT_TEST === '1'
//
// PLAYWRIGHT_TEST est posé UNIQUEMENT par playwright.config.ts
// webServer.env (pas dans .env.example, pas dans la doc utilisateur).
// Triple intersection = activation impossible hors run Playwright local.
//
// Defense in depth : warning console une fois par process si le bypass
// se déclenche. Si jamais ce log apparaît dans Vercel prod logs (par
// erreur de config), alerte immédiate forensique.
let _bypassWarningLogged = false;
function isE2ETestBypassActive(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.RATE_LIMIT_BYPASS_TESTS === "true" &&
    process.env.PLAYWRIGHT_TEST === "1"
  );
}

function maybeWarnBypassActive(): void {
  if (_bypassWarningLogged) return;
  _bypassWarningLogged = true;
  console.warn(
    "[RATE_LIMIT_BYPASS] Active for tests — should NEVER appear in production logs",
  );
}

// Reset mémoire du flag bypass-warning. Test-only (cf. tests/lib/rate-limit/*).
// Pas exposé pour usage applicatif.
export function __resetBypassWarning(): void {
  _bypassWarningLogged = false;
}

// Helper consume : prend un identifier (IP ou autre clé) et retourne un
// résultat normalisé. Fail-open systématique :
//   - bypass e2e triple gate → success=true (court-circuit Upstash)
//   - limiter null  (env vars absentes) → success=true
//   - limiter throw (Redis down/timeout) → success=true + console.error
export async function consumeRateLimit(
  limiter: Ratelimit | null,
  identifier: string,
): Promise<RateLimitResult> {
  if (isE2ETestBypassActive()) {
    maybeWarnBypassActive();
    return { success: true, limit: 0, remaining: 0, reset: 0 };
  }
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

// sec-P2-3 (T9 2026-05-07) — Route /api/admin/producers/invite. Cap 10/min
// keying par admin user_id : un admin peut envoyer des invitations en
// rafale lors d'un onboarding batch (10/min absorbe ce cas). Au-delà =
// soit script abusif (admin compromis), soit malware admin bot. Defense in
// depth + audit log applicatif déjà en place via logAdminInviteEvent.
// Keying user_id (et non IP) car l'IP de bureau peut être partagée et la
// session admin est forte (login + isAdmin check).
let _adminInviteLimiter: Ratelimit | null | undefined;

// sec-P3-1 (T9 2026-05-07) — Route /api/producer-interests POST anon. Cap
// 5/min keying par IP : formulaire candidature producteur public, volume
// nominal très bas (1-3 soumissions/jour côté business). Au-delà = scripting,
// énumération du form, ou flood spam. Le helper upsertProducerInterest est
// idempotent (catch 23505 → UPDATE) donc pas de risque DB, mais le coût
// applicatif (écriture audit log + run de validation Zod) justifie le cap.
let _producerInterestLimiter: Ratelimit | null | undefined;

// F-003 (audit pré-launch 2026-05-10) — Webhook Stripe POST. Cap 100/min/IP :
// généreux pour absorber les retries Stripe (même event peut être rejoué
// 4-5x sur 5xx, ack 200 reset le compteur côté Stripe). Au-delà = soit
// flood post-leak signing secret (defense-in-depth derrière la signature
// HMAC), soit script abusif. La signature HMAC reste la défense principale
// (signing secret unique par endpoint Stripe). Fail-open obligatoire :
// JAMAIS bloquer un webhook légitime sur un incident infra Upstash.
let _stripeWebhookLimiter: Ratelimit | null | undefined;

// F-011 (audit pré-launch 2026-05-10) — Server action exportMyDataAction
// (RGPD art. 20 portabilité). Cap 5/24h keying userId : un user légitime
// exerce son droit ponctuellement (1-2 exports/an typique). Au-delà =
// scripting, abus, ou compromise de session. Coût élevé du build zip
// (5 queries DB + sérialisation CSV + zip) justifie un cap strict. Keying
// userId pour éviter NAT-collision et pour aligner avec exportComptaLimiter.
let _rgpdExportLimiter: Ratelimit | null | undefined;

// F-034 (audit P0 sweep 2026-05-11) — Route POST /api/orders/create. Cap
// 10/60s keying userId : 1 order/checkout nominal, retries 2-3 (réseau
// flaky, double-clic) absorbés par la dedup T-428 (5min fenêtre) ; le
// cap rate-limit applique une defensive layer côté énumération automatisée
// (script qui crée des orders en rafale pour saturer slots d'un producteur
// rival, ou pour scanner side-channels stock_depleted). Keying userId pour
// aligner avec doctrine Stripe write (getStripeCreatePaymentIntentRateLimit
// 10/60s userId) et éviter NAT-collision marchés où consumers partagent
// l'IP café/4G. Audit log applicatif rate_limit_exceeded côté caller pour
// détection forensique pattern d'attaque énumération slots.
let _ordersCreateLimiter: Ratelimit | null | undefined;

// F-056 (audit pré-launch 2026-05-11) — Cap secondaire OTP change-email
// keying l'adresse cible (newEmail). 3/h/email pour empêcher un compte
// compromis de harceler une boîte tierce en spammant des OTP "votre code
// est XXX" via le step=new (l'adresse cible reçoit l'email Resend). Le
// cap DB existant (`checkOtpRateLimit` 3/60s par userId+step) ne couvre
// pas ce vecteur : un attaquant peut alterner `newEmail` à chaque requête
// sous le même user. Keying email cible (et non IP, ni userId) car le
// dommage = nuisance vers la boîte tierce, pas vers l'attaquant.
let _otpNewEmailLimiter: Ratelimit | null | undefined;

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

export function getAdminInviteRateLimit(): Ratelimit | null {
  if (_adminInviteLimiter === undefined) {
    _adminInviteLimiter = createRateLimiter(10, "60 s", "admin_invite");
  }
  return _adminInviteLimiter;
}

export function getProducerInterestRateLimit(): Ratelimit | null {
  if (_producerInterestLimiter === undefined) {
    _producerInterestLimiter = createRateLimiter(
      5,
      "60 s",
      "producer_interest",
    );
  }
  return _producerInterestLimiter;
}

export function getStripeWebhookRateLimit(): Ratelimit | null {
  if (_stripeWebhookLimiter === undefined) {
    _stripeWebhookLimiter = createRateLimiter(
      100,
      "60 s",
      "stripe_webhook",
    );
  }
  return _stripeWebhookLimiter;
}

export function getRgpdExportRateLimit(): Ratelimit | null {
  if (_rgpdExportLimiter === undefined) {
    _rgpdExportLimiter = createRateLimiter(5, "24 h", "rgpd_export");
  }
  return _rgpdExportLimiter;
}

export function getOrdersCreateRateLimit(): Ratelimit | null {
  if (_ordersCreateLimiter === undefined) {
    _ordersCreateLimiter = createRateLimiter(10, "60 s", "orders_create");
  }
  return _ordersCreateLimiter;
}

export function getOtpNewEmailRateLimit(): Ratelimit | null {
  if (_otpNewEmailLimiter === undefined) {
    _otpNewEmailLimiter = createRateLimiter(3, "1 h", "otp_new_email");
  }
  return _otpNewEmailLimiter;
}
