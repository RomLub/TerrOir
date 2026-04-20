"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/logo";

export type NavLink = { href: string; label: string };

export type NavbarPublicProps = {
  links?: NavLink[];
  isAuthenticated?: boolean;
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

export function NavbarPublic({
  links = defaultLinks,
  isAuthenticated = false,
  className = "",
}: NavbarPublicProps) {
  const pathname = usePathname();

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
          {isAuthenticated ? (
            <Link
              href="/compte"
              className="text-sm font-medium text-terroir-green-700 hover:underline"
            >
              Mon compte
            </Link>
          ) : (
            <>
              <Link
                href="/connexion"
                className="text-sm text-terroir-ink hover:text-terroir-green-700"
              >
                Connexion
              </Link>
              <Link
                href="/inscription"
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
