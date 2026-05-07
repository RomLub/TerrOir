// Next.js instrumentation hook — boot des configs Sentry server/edge.
// Ref Next.js : https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
//
// Cluster B Phase 3 (bugs-P1-3) : init Sentry au boot serveur (Node + Edge).
// Le SDK est no-op si NEXT_PUBLIC_SENTRY_DSN n'est pas defini (build/preview
// sans creds Sentry).

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
