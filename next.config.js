// Assets logo disponibles :
// /public/Logo_TerrOir.jpeg       → logo raster (OG meta tags, partage social)
// /public/Logo_TerrOir_square.png → version carrée rognée (favicon, app icon iOS)
// /app/icon.png                   → favicon 64x64 (auto-détecté par Next.js)
// Composant React <Logo /> dans components/ui/logo.tsx → SVG inline (UI in-app)

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
};

module.exports = nextConfig;
