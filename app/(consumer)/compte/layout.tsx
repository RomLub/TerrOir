import { redirect } from "next/navigation";
import { NavbarPublic, Footer } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { Sidebar } from "./_components/Sidebar";

// Layout partagé pour /compte/* :
// - NavbarPublic en haut, Footer en bas (mutualisés depuis chaque page)
// - Sidebar de navigation interne à gauche en md+, scroll horizontal en haut
//   sur mobile
//
// Audit Auth 2026-05-05 H-4 : defense-in-depth auth check. Le middleware
// reste la 1re barrière (/compte est dans CONSUMER_PROTECTED_PREFIX). Pas
// de check host ici : /compte est accessible depuis www ET pro (cookies
// .terroir-local.fr partagés).
export default async function CompteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionUser();
  if (!session) redirect("/connexion");

  return (
    <div className="flex min-h-screen flex-col bg-terroir-bg">
      <NavbarPublic />
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:py-10">
        <div className="grid gap-6 md:grid-cols-[220px_1fr]">
          <Sidebar />
          <div className="min-w-0">{children}</div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
