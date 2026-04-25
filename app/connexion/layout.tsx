import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { NavbarPublic } from "@/components/ui/navbar-public";
import { Footer } from "@/components/ui/footer";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  loadRoleSnapshot,
  localPostLoginPath,
} from "@/lib/auth/post-login-redirect";

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
//
// Check session côté serveur (DETTE B) : si l'user a déjà une session
// active, on évite de lui montrer le form et on redirige vers sa cible
// post-login locale. Fail-open en cas d'erreur Supabase → on render le
// form (l'user pourra retenter ou utiliser le magic link).

const PRODUCER_HOST = "pro.terroir-local.fr";
const ADMIN_HOST = "admin.terroir-local.fr";

const MAIN_CLS = "flex flex-1 items-center justify-center p-8";

export default async function ConnexionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const host = headers().get("host") ?? "";

  let alreadyLoggedInPath: string | null = null;
  try {
    const supabase = createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const role = await loadRoleSnapshot(supabase, user.id);
      alreadyLoggedInPath = localPostLoginPath(role, host);
    }
  } catch {
    // fail-open
  }
  if (alreadyLoggedInPath) redirect(alreadyLoggedInPath);

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
