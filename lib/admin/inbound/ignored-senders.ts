// Chantier 9 — pré-filtre du bruit à l'ingestion (cf. arbitrage Romain). La
// boîte pollée (admin@) est la boîte principale : elle mélange les mails
// publics/producteurs/consommateurs (utiles) avec le bruit infra (Stripe,
// Resend, Vercel, OVH, GitHub…) + les bounces + le propre outbound TerrOir.
// On n'insère PAS le bruit dans inbound_emails (le checkpoint avance quand
// même). Blacklist configurable ici.

// Domaines expéditeurs ignorés (match par suffixe → couvre les sous-domaines,
// ex. bounces.stripe.com, notifications.github.com).
export const IGNORED_SENDER_DOMAINS: string[] = [
  "stripe.com",
  "resend.dev",
  "resend.com",
  "vercel.com",
  "vercel.app",
  "ovh.net",
  "ovh.com",
  "github.com",
  "githubusercontent.com",
  "sentry.io",
  "twilio.com",
  "upstash.com",
  "supabase.io",
  "supabase.com",
  "posthog.com",
  // Propre outbound TerrOir (no-reply@, auth@send., contact@ en copie) — pas
  // un message entrant d'un tiers.
  "terroir-local.fr",
];

// Local-parts ignorés (bounces / notifications système), quel que soit le
// domaine.
const IGNORED_LOCAL_PARTS = ["mailer-daemon", "postmaster"];

export function isIgnoredSender(fromEmail: string): boolean {
  const email = fromEmail.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at === -1) return true; // adresse malformée → bruit
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  if (IGNORED_LOCAL_PARTS.includes(local)) return true;
  return IGNORED_SENDER_DOMAINS.some(
    (d) => domain === d || domain.endsWith(`.${d}`),
  );
}
