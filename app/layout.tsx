import type { Metadata } from "next";
import { Inter, Cormorant_Garamond, Caveat } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { UserProvider } from "@/components/providers/user-provider";
import { getInitialUserPayload } from "@/lib/auth/session";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-cormorant",
  display: "swap",
});

const caveat = Caveat({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-caveat",
  display: "swap",
});

// Assets brand externes : Next 14 détecte automatiquement app/icon.png,
// app/apple-icon.png, app/opengraph-image.png, app/twitter-image.png et injecte
// les <link rel="icon"> + <meta property="og:image"> appropriés. Inutile de
// déclarer metadata.icons / openGraph.images / twitter.images ici.
// Régénération : `node scripts/generate-brand-assets.mjs`.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: "TerrOir",
  description: "La marketplace des produits du terroir.",
  openGraph: {
    title: "TerrOir",
    description: "La marketplace des produits du terroir.",
    url: APP_URL,
    siteName: "TerrOir",
    locale: "fr_FR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TerrOir",
    description: "La marketplace des produits du terroir.",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Résolution server-side de la session + flag admin pour éviter le flash
  // CTA→user et badge Admin au hard refresh : UserProvider démarre avec le
  // bon état dès le SSR (extension du pattern initialUser, commit 6a9ebd3).
  const initial = await getInitialUserPayload();

  return (
    <html
      lang="fr"
      className={`${inter.variable} ${cormorant.variable} ${caveat.variable}`}
    >
      <body className="min-h-screen bg-terroir-bg font-sans text-terroir-ink antialiased">
        <UserProvider initial={initial}>{children}</UserProvider>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
