// Assets logo disponibles :
// /public/Logo_TerrOir.jpeg       → logo raster (OG meta tags, partage social)
// /public/Logo_TerrOir_square.png → version carrée rognée (favicon, app icon iOS)
// /app/icon.png                   → favicon 64x64 (auto-détecté par Next.js)
// Composant React <Logo /> dans components/ui/logo.tsx → SVG inline (UI in-app)

const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

// =============================================================================
// Headers de sécurité — Audit PCI SAQ-A W-1 (2026-05-05)
// =============================================================================
// HSTS est posé automatiquement par Vercel sur les domaines custom
// (max-age=63072000; includeSubDomains). On ajoute ici les headers que ni Next
// ni Vercel ne posent par défaut : X-Frame-Options, X-Content-Type-Options,
// Referrer-Policy, Permissions-Policy, et CSP enforce mode.
//
// CSP : démarrée en `Content-Security-Policy-Report-Only` pour observer 7 jours
// les violations Vercel logs (pattern `[CSPRO]` dans browser console côté
// users) sans casser la prod si la policy a un trou. Bascule en mode enforce
// (`Content-Security-Policy`) effective 2026-05-12 (sec-P2-1) après période
// d'observation. Voir `docs/conventions/security-headers.md`.

function buildCSP() {
  // Construction dynamique : on lit NEXT_PUBLIC_SUPABASE_URL pour whitelister
  // précisément le projet Supabase TerrOir au lieu d'un wildcard *.supabase.co
  // trop large. Fallback wildcard si l'env var est absente (build local sans
  // .env.local — édition de docs, etc.).
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  let supabaseHttps = "https://*.supabase.co";
  let supabaseWss = "wss://*.supabase.co";
  if (supabaseUrl) {
    try {
      const u = new URL(supabaseUrl);
      supabaseHttps = `https://${u.host}`;
      supabaseWss = `wss://${u.host}`;
    } catch {
      // URL invalide → on garde le fallback wildcard.
    }
  }

  // Notes par directive :
  //  - default-src 'self' : tout ce qui n'est pas listé explicitement → self.
  //  - script-src : 'unsafe-inline' nécessaire pour les bootstrap scripts
  //    Next.js (hydratation, RSC payload). 'unsafe-eval' nécessaire pour
  //    Stripe.js (eval dynamique sur certains chemins) et le runtime Next dev.
  //    js.stripe.com = Elements/PaymentElement. m.stripe.network = scripts
  //    Stripe internes. va.vercel-scripts.com = Vercel Analytics. blob: pour
  //    workers Mapbox-gl (web worker chargé en blob URL).
  //  - style-src 'unsafe-inline' : Tailwind + next/font + mapbox-gl utilisent
  //    de l'inline-style pour les styles dynamiques.
  //  - img-src https: data: blob: : photos producteurs (Supabase Storage,
  //    Unsplash, picsum), tiles Mapbox, data URIs SVG.
  //  - font-src 'self' data: : next/font local + fallback data URI.
  //  - connect-src : Stripe (api.stripe.com), Mapbox (api/tiles/events),
  //    Vercel Analytics (vitals + scripts), Supabase (REST + Realtime wss).
  //  - frame-src : iframes Stripe Elements + 3DS (hooks.stripe.com,
  //    js.stripe.com, m.stripe.network).
  //  - worker-src 'self' blob: : Mapbox-gl spawn un worker en blob: URL.
  //  - object-src 'none' : pas de <object>/<embed>/<applet>, anti-Flash.
  //  - base-uri 'self' : interdit injection de <base href="...">.
  //  - form-action 'self' : interdit POST cross-origin sortant.
  //  - frame-ancestors 'none' : équivalent X-Frame-Options DENY pour CSP-aware
  //    browsers (anti-clickjacking).
  //  - upgrade-insecure-requests : auto-upgrade http→https sur sous-ressources.

  const directives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://m.stripe.network https://va.vercel-scripts.com blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' https://api.stripe.com https://api.mapbox.com https://*.tiles.mapbox.com https://events.mapbox.com https://va.vercel-scripts.com https://vitals.vercel-analytics.com ${supabaseHttps} ${supabaseWss}`,
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://m.stripe.network",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ];

  return directives.join("; ");
}

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
  // CSP enforce mode (sec-P2-1, bascule 2026-05-12 après 7+ jours
  // d'observation Report-Only). Toute violation = ressource bloquée par
  // le browser. Si une page critique casse en prod, rollback temporaire
  // via revert du nom de header → `Content-Security-Policy-Report-Only`.
  // Cf. doc `docs/conventions/security-headers.md`.
  {
    key: "Content-Security-Policy",
    value: buildCSP(),
  },
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

module.exports = withBundleAnalyzer(nextConfig);
