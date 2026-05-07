// Cluster B Phase 3 (bugs-P1-3) — config Sentry server-side (Node runtime).
//
// Capturee via Sentry.captureException dans lib/ops/alert.tsx (helper
// sendOpsAlert) sur les 5 prefixes greppables critiques. NEXT_PUBLIC_SENTRY_DSN
// doit etre defini cote Vercel (Production + Preview + Development) ; en
// son absence l'init no-op (Sentry SDK swallow).
//
// Doctrine anti-PII (T-200 r1 + T-249) :
//   - beforeSend hook strip systematique : email, phone, latitude, longitude,
//     code_postal, consumer_id, payment_intent_id, address.
//   - producer_id reste autorise (signal diagnostic backend pure).

import * as Sentry from "@sentry/nextjs";

const PII_KEYS = new Set<string>([
  "email",
  "phone",
  "telephone",
  "latitude",
  "longitude",
  "lat",
  "lng",
  "code_postal",
  "cp",
  "consumer_id",
  "consumer_name",
  "consumer_email",
  "payment_intent_id",
  "address",
  "adresse",
]);

function stripPiiRecursive(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(stripPiiRecursive);
  if (typeof obj !== "object") return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (PII_KEYS.has(k)) continue;
    out[k] = stripPiiRecursive(v);
  }
  return out;
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Tracing minimum : on est focus sur les exceptions ops, pas le perf
  // monitoring. Bump si on instrumente la latency post-Live.
  tracesSampleRate: 0.0,
  // Profiling off : pas de besoin et reduit la facture data Sentry.
  profilesSampleRate: 0.0,
  // Active uniquement en prod pour ne pas polluer les runs locaux ou les
  // tests vitest. NEXT_PUBLIC_SENTRY_DSN absent = SDK no-op.
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
  beforeSend(event) {
    // Strip headers/cookies/query — eviter accidentellement un email/CP
    // dans une URL de path consumer.
    if (event.request) {
      delete event.request.cookies;
      delete event.request.headers;
      delete event.request.query_string;
    }
    // Strip user-context : on ne ID pas les users dans Sentry par doctrine
    // anti-tracking (cf. CLAUDE.md "Doctrine anti-PII tracking").
    delete event.user;
    // Strip PII recursive sur extras + tags + breadcrumbs.
    if (event.extra) {
      event.extra = stripPiiRecursive(event.extra) as typeof event.extra;
    }
    if (event.tags) {
      event.tags = stripPiiRecursive(event.tags) as typeof event.tags;
    }
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map((b) => ({
        ...b,
        data: b.data ? (stripPiiRecursive(b.data) as typeof b.data) : b.data,
      }));
    }
    return event;
  },
});
