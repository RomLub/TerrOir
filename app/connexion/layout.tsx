import { headers } from "next/headers";
import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { NavbarPublic } from "@/components/ui/navbar-public";
import { Footer } from "@/components/ui/footer";

// Layout adaptatif au sous-domaine pour /connexion. La route est extraite
// du groupe (public) parce que les child layouts s'imbriquent dans le
// parent en App Router : impossible d'override `app/(public)/layout.tsx`
// (chrome consumer) sans sortir du groupe.
//
//   admin.terroir-local.fr → mono-écran sans chrome (cohérent avec
//                            admin-accueil)
//   pro.terroir-local.fr   → mini-header (logo + Retour) + footer minimal
//                            (palette identique à pro-accueil)
//   www.* / dev local      → NavbarPublic + Footer consumer (no-op visuel)

const PRODUCER_HOST = "pro.terroir-local.fr";
const ADMIN_HOST = "admin.terroir-local.fr";

const MAIN_CLS = "flex flex-1 items-center justify-center p-8";

export default function ConnexionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const host = headers().get("host") ?? "";

  if (host === ADMIN_HOST) {
    return (
      <div className="bg-bg flex min-h-screen flex-col">
        <main className={MAIN_CLS}>{children}</main>
      </div>
    );
  }

  if (host === PRODUCER_HOST) {
    return (
      <div className="bg-bg flex min-h-screen flex-col">
        <header className="border-b border-dark/[0.06] bg-white">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
            <Logo size="md" href="/" />
            <Link
              href="/"
              className="text-sm text-dark/70 transition-colors hover:text-green-700"
            >
              ← Retour
            </Link>
          </div>
        </header>
        <main className={MAIN_CLS}>{children}</main>
        <footer className="border-t border-dark/[0.06] bg-white">
          <div className="mx-auto max-w-7xl px-6 py-6 text-[13px] text-dark/60">
            <Logo size="sm" href="/" />
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <NavbarPublic />
      <main className={MAIN_CLS}>{children}</main>
      <Footer />
    </div>
  );
}
