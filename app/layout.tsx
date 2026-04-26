import type { Metadata } from "next";
import { Inter, Cormorant_Garamond } from "next/font/google";
import "./globals.css";
import { UserProvider } from "@/components/providers/user-provider";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  // Résolution server-side de la session pour éviter le flash CTA→user au
  // hard refresh : le UserProvider démarre avec le bon `user` dès le SSR.
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="fr" className={`${inter.variable} ${cormorant.variable}`}>
      <body className="min-h-screen bg-terroir-bg font-sans text-terroir-ink antialiased">
        <UserProvider initialUser={user}>{children}</UserProvider>
      </body>
    </html>
  );
}
