"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/logo";
import { Badge } from "@/components/ui/badge";
import { useUserContext } from "@/components/providers/user-provider";
import { logoutAction } from "@/app/(public)/connexion/logout-action";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type NavLink = { href: string; label: string };

export type NavbarPublicProps = {
  links?: NavLink[];
  className?: string;
};

const defaultLinks: NavLink[] = [
  { href: "/producteurs", label: "Les éleveurs" },
  { href: "/carte", label: "Carte" },
  { href: "/a-propos", label: "À propos" },
];

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function truncateEmail(email: string, max = 15): string {
  if (email.length <= max) return email;
  return `${email.slice(0, max)}…`;
}

function UserIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function NavbarPublic({
  links = defaultLinks,
  className = "",
}: NavbarPublicProps) {
  const pathname = usePathname();
  const { user, isAdmin, loading } = useUserContext();

  const prenom = user?.user_metadata?.prenom as string | undefined;
  const label = prenom || (user?.email ? truncateEmail(user.email) : "");

  return (
    <header
      className={`sticky top-0 z-40 w-full border-b border-terroir-border bg-terroir-bg/90 backdrop-blur ${className}`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Logo size="lg" />
        <nav
          className="hidden items-center gap-6 md:flex"
          aria-label="Navigation principale"
        >
          {links.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`text-sm transition-colors ${
                  active
                    ? "font-semibold text-terroir-green-700"
                    : "text-terroir-ink hover:text-terroir-green-700"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          {loading ? (
            <div className="h-8 w-24" aria-hidden="true" />
          ) : user ? (
            <>
              <Link
                href={isAdmin ? "/tableau-de-bord" : "/compte"}
                className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-terroir-ink transition-colors hover:bg-terroir-green-100 hover:text-terroir-green-700"
              >
                <UserIcon className="h-5 w-5 text-terroir-green-700" />
                <span className="font-medium">{label}</span>
              </Link>
              {isAdmin ? <Badge variant="green">Admin</Badge> : null}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  // signOut côté client d'abord : déclenche le listener
                  // onAuthStateChange du UserProvider → SIGNED_OUT →
                  // setUser(null) → UI rafraîchie immédiatement.
                  // Puis server action pour nettoyer les cookies côté
                  // serveur et invalider la session GoTrue, avec redirect("/").
                  const supabase = createSupabaseBrowserClient();
                  await supabase.auth.signOut();
                  await logoutAction();
                }}
              >
                <button
                  type="submit"
                  className="text-xs text-terroir-muted transition-colors hover:text-terroir-green-700 hover:underline"
                >
                  Déconnexion
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/connexion"
                className="text-sm text-terroir-ink hover:text-terroir-green-700"
              >
                Connexion
              </Link>
              <Link
                href="/auth/inscription"
                className="inline-flex items-center rounded-md bg-terroir-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-terroir-green-700/90"
              >
                S&apos;inscrire
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
