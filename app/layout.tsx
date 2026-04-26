import type { Metadata } from "next";
import { Inter, Cormorant_Garamond } from "next/font/google";
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

export const metadata: Metadata = {
  title: "TerrOir",
  description: "La marketplace des produits du terroir.",
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
    <html lang="fr" className={`${inter.variable} ${cormorant.variable}`}>
      <body className="min-h-screen bg-terroir-bg font-sans text-terroir-ink antialiased">
        <UserProvider initial={initial}>{children}</UserProvider>
      </body>
    </html>
  );
}
