// Assets logo disponibles :
// /public/Logo_TerrOir.jpeg       → logo original vertical (navbar, footer)
// /public/Logo_TerrOir_square.png → version carrée rognée (avatar, favicon)
// /app/icon.png                   → favicon 64x64 (auto-détecté par Next.js)

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "api.mapbox.com" },
    ],
  },
};

module.exports = nextConfig;
