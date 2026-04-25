"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/logo";
import { Badge } from "@/components/ui/badge";
import { useUserContext } from "@/components/providers/user-provider";
import { useCartStore } from "@/lib/store/cart";
import { useLogoutFlow } from "@/lib/auth/use-logout-flow";

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

function ShoppingBagIcon({ className = "" }: { className?: string }) {
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
      <path d="M6 2 L3 6 v14 a2 2 0 0 0 2 2 h14 a2 2 0 0 0 2 -2 V6 L18 2 Z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10 a4 4 0 0 1 -8 0" />
    </svg>
  );
}

function CartNavButton() {
  // Mounted pattern : évite le flash visuel quand persist hydrate le store
  // Zustand depuis localStorage après le 1er render client. SSR / 1er render
  // client = icône seule (items: []) → après mount, count réel apparaît.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const count = useCartStore((s) => s.items.length);
  const show = mounted && count > 0;
  const display = count > 99 ? "99+" : String(count);

  return (
    <Link
      href="/compte/panier"
      aria-label="Voir mon panier"
      className="relative inline-flex items-center justify-center rounded-md p-1.5 text-terroir-ink transition-colors hover:bg-terroir-green-100 hover:text-terroir-green-700"
    >
      <ShoppingBagIcon className="h-5 w-5" />
      {show && (
        <span
          aria-label={`${count} article${count > 1 ? "s" : ""} dans le panier`}
          className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white"
        >
          {display}
        </span>
      )}
    </Link>
  );
}

export function NavbarPublic({
  links = defaultLinks,
  className = "",
}: NavbarPublicProps) {
  const pathname = usePathname();
  const { user, isAdmin, loading } = useUserContext();
  const { logout, isLoggingOut } = useLogoutFlow();

  const prenom = user?.user_metadata?.prenom as string | undefined;
  const label = prenom || (user?.email ? truncateEmail(user.email) : "");

  return (
    <header
      className={`sticky top-0 z-40 w-full border-b border-terroir-border bg-terroir-bg/90 backdrop-blur ${className}`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Logo size="md" />
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
          {!isAdmin && <CartNavButton />}
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
                  await logout();
                }}
              >
                <button
                  type="submit"
                  disabled={isLoggingOut}
                  className="text-xs text-terroir-muted transition-colors hover:text-terroir-green-700 hover:underline disabled:opacity-50"
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
