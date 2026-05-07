// Cluster B Phase 3 (bugs-P1-3) — config Sentry client-side (browser).
//
// Init minimaliste : on est focus sur les exceptions backend (les 5 prefixes
// greppables sont tous serveur). Cote client on garde Sentry actif pour
// capturer les erreurs JS imprevues, mais sample rate bas + beforeSend
// anti-PII durci.

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
  tracesSampleRate: 0.0,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
  beforeSend(event) {
    if (event.request) {
      delete event.request.cookies;
      delete event.request.headers;
      delete event.request.query_string;
    }
    delete event.user;
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
