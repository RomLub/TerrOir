import { NavbarPublic, Footer } from "@/components/ui";
import { Sidebar } from "./_components/Sidebar";

// Layout partagé pour /compte/* :
// - NavbarPublic en haut, Footer en bas (mutualisés depuis chaque page)
// - Sidebar de navigation interne à gauche en md+, scroll horizontal en haut
//   sur mobile
// L'auth est garantie par le middleware (/compte est dans CONSUMER_PROTECTED_PREFIX),
// donc pas de redirect ici.
export default function CompteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
