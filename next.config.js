// Assets logo disponibles :
// /public/Logo_TerrOir.jpeg       → logo raster (OG meta tags, partage social)
// /public/Logo_TerrOir_square.png → version carrée rognée (favicon, app icon iOS)
// /app/icon.png                   → favicon 64x64 (auto-détecté par Next.js)
// Composant React <Logo /> dans components/ui/logo.tsx → SVG inline (UI in-app)

const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

// =============================================================================
// Headers de sécurité — Audit PCI SAQ-A W-1 (2026-05-05) + F-005a/F-070
// (audit P0-TC 2026-05-10)
// =============================================================================
// HSTS est posé automatiquement par Vercel sur les domaines custom
// (max-age=63072000; includeSubDomains). On ajoute ici les headers que ni Next
// ni Vercel ne posent par défaut : X-Frame-Options, X-Content-Type-Options,
// Referrer-Policy, Permissions-Policy, COOP, CORP.
//
// CSP : F-005a (audit P0-TC 2026-05-10) bascule la CSP en mode nonce-based
// Report-Only, posée DYNAMIQUEMENT par middleware.ts (nonce crypto par
// requête, incompatible avec un header statique). La CSP enforce statique
// précédente (`unsafe-inline` + `unsafe-eval`) a été retirée d'ici pour éviter
// la double CSP qui rendrait le nonce inutile (intersection des permissions
// browser). Bascule en mode enforce différée (~24-48 h d'observation preview)
// cf. middleware.ts + docs/conventions/security-headers.md.

const SECURITY_HEADERS = [
  // Anti-clickjacking : DENY plutôt que SAMEORIGIN car aucune feature TerrOir
  // ne nécessite l'auto-embed. Stripe Elements iframe TerrOir-side est
  // chargée DEPUIS https://js.stripe.com (pas embed de TerrOir dans une
  // iframe), donc DENY ne pose pas de problème UX.
  { key: "X-Frame-Options", value: "DENY" },
  // Empêche le browser de "deviner" un MIME-type différent du Content-Type
  // serveur (anti-MIME-confusion / drive-by exec).
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Référeur transmis sur navigations same-origin (full URL) et cross-origin
  // (origin only). Strict-origin sur HTTP→HTTPS downgrade : pas de fuite si
  // un user clique vers un site http://.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // - camera / microphone : aucune feature TerrOir.
  // - geolocation : utilisée par /carte (DistanceWidget) — self.
  // - payment : utilisée par Stripe PaymentRequest API (Apple Pay / Google
  //   Pay) — self.
  // - interest-cohort : opt-out FLoC/Topics (Privacy Sandbox).
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(self), payment=(self), interest-cohort=()",
  },
  // F-070 (audit P0-TC 2026-05-10) — Cross-Origin isolation.
  // COOP same-origin-allow-popups : isole le top-level browsing context
  // des popups cross-origin par défaut, MAIS préserve la communication
  // window.opener pour les popups que TerrOir ouvre intentionnellement
  // (ex: Stripe 3DS challenge ACS de certaines banques émettrices qui
  // ouvrent un popup au lieu d'iframe). Bénéfice partiel anti-Spectre,
  // compromis pragmatique avant tests preview pour durcir éventuellement
  // à same-origin.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  // CORP same-origin : restreint qui peut load les ressources de TerrOir
  // depuis cross-origin. Pages HTML uniquement (assets statiques bypass
  // via matcher middleware + headers Vercel). Pas d'impact Stripe vu que
  // les ressources Stripe sont chargées DEPUIS stripe.com, pas depuis
  // TerrOir. Bénéfice : anti-Spectre côté ressource.
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: [
      "@/components/ui",
      "date-fns",
      "@stripe/react-stripe-js",
    ],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "api.mapbox.com" },
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "fastly.picsum.photos" },
      { protocol: "https", hostname: "loremflickr.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

// Cluster B Phase 3 (bugs-P1-3) — wrap Sentry. Active uniquement si SENTRY_DSN
// est defini (sinon withSentryConfig est un no-op cote build : pas d'upload
// sourcemaps, juste injection du SDK runtime).
const { withSentryConfig } = require("@sentry/nextjs");

module.exports = withSentryConfig(withBundleAnalyzer(nextConfig), {
  // Skip si pas de creds (init manuel : DSN + auth token poses ulterieurement
  // par Romain dans Vercel — cf. RAPPORT FINAL ARBITRAGE REQUIS).
  silent: !process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Cache les sourcemaps de la build production (anti-leak code source en
  // public). Les errors Sentry restent symboliquees cote dashboard.
  hideSourceMaps: true,
});
