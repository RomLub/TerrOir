// Helper de logging client : no-op en production pour ne pas polluer la
// DevTools console des utilisateurs. Conserve console.error tel quel
// ailleurs (les erreurs réelles restent visibles en prod). Ne touche
// PAS aux logs serveur (lib/**, app/api/**) qui vont vers Vercel Logs.

const isDev = process.env.NODE_ENV !== "production";

type ClientLogLevel = "log" | "warn" | "error";

export function clientLog(level: ClientLogLevel, ...args: unknown[]): void {
  if (!isDev) return;
  // eslint-disable-next-line no-console
  console[level](...args);
}
