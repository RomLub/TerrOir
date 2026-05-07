"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/logo";
import { Badge } from "@/components/ui/badge";
import { RoleToggle } from "@/components/ui/role-toggle";
import { useUserContext } from "@/components/providers/user-provider";
import { useCartStore } from "@/lib/store/cart";
import { useLogoutFlow } from "@/lib/auth/use-logout-flow";

export type NavLink = { href: string; label: string };

export type NavbarPublicProps = {
  links?: NavLink[];
  className?: string;
};

const defaultLinks: NavLink[] = [
  { href: "/producteurs", label: "Rencontrer les producteurs" },
  { href: "/carte", label: "Carte" },
  { href: "/notre-demarche", label: "Notre démarche" },
  { href: "/comment-ca-marche", label: "Comment ça marche" },
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

function MenuIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
    >
      <line x1="3" y1="7" x2="21" y2="7" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="17" x2="21" y2="17" />
    </svg>
  );
}

function CloseIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

type CartVariant = "desktop" | "mobile";

function CartNavButton({ variant }: { variant: CartVariant }) {
  // Mounted pattern : évite le flash visuel quand persist hydrate le store
  // Zustand depuis localStorage après le 1er render client. SSR / 1er render
  // client = état count=0 → après mount, count réel apparaît.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const count = useCartStore((s) => s.items.length);
  const show = mounted && count > 0;
  const display = count > 99 ? "99+" : String(count);
  const ariaLabel =
    count > 0
      ? `Mon panier (${count} article${count > 1 ? "s" : ""})`
      : "Mon panier";

  if (variant === "mobile") {
    return (
      <Link
        href="/compte/panier"
        aria-label={ariaLabel}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-md bg-terra-700 text-white transition-colors hover:bg-terra-800 focus:outline-none focus:ring-2 focus:ring-terra-700 focus:ring-offset-2"
      >
        <ShoppingBagIcon className="h-5 w-5" />
        {show ? (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[11px] font-semibold tabular-nums text-terra-700 shadow-sm"
          >
            {display}
          </span>
        ) : null}
      </Link>
    );
  }

  return (
    <Link
      href="/compte/panier"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-2 rounded-md bg-terra-700 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-terra-800 focus:outline-none focus:ring-2 focus:ring-terra-700 focus:ring-offset-2"
    >
      <ShoppingBagIcon className="h-5 w-5" />
      <span>Panier</span>
      {show ? (
        <span
          aria-hidden="true"
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[11px] font-semibold tabular-nums text-terra-700"
        >
          {display}
        </span>
      ) : null}
    </Link>
  );
}

export function NavbarPublic({
  links = defaultLinks,
  className = "",
}: NavbarPublicProps) {
  const pathname = usePathname();
  const { user, isAdmin } = useUserContext();
  const { logout, isLoggingOut } = useLogoutFlow();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const prenom = user?.user_metadata?.prenom as string | undefined;
  const label = prenom || (user?.email ? truncateEmail(user.email) : "");

  // Ferme le drawer si l'utilisateur passe en desktop pendant qu'il est ouvert
  // (resize ou rotation). matchMedia listener > resize event (moins de bruit).
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setDrawerOpen(false);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // Body scroll lock pendant que le drawer est ouvert (UX mobile).
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  const handleLogout = async (e: React.FormEvent) => {
    e.preventDefault();
    await logout();
    setDrawerOpen(false);
  };

  return (
    <header
      className={`sticky top-0 z-40 w-full border-b border-terroir-border bg-terroir-bg/90 backdrop-blur ${className}`}
    >
      {/* === Mobile bar === */}
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 md:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Ouvrir le menu"
          aria-expanded={drawerOpen}
          aria-controls="mobile-drawer"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-terroir-ink transition-colors hover:bg-terra-100 hover:text-terra-700 focus:outline-none focus:ring-2 focus:ring-terra-700"
        >
          <MenuIcon className="h-6 w-6" />
        </button>
        <Logo size="md" variant="wordmark" />
        {!isAdmin ? <CartNavButton variant="mobile" /> : <span className="w-11" aria-hidden="true" />}
      </div>

      {/* === Desktop bar === */}
      <div className="mx-auto hidden h-20 max-w-6xl items-center justify-between gap-4 px-4 md:flex">
        <Logo size="xl" variant="wordmark" />
        <nav
          className="flex items-center gap-6"
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
                    ? "font-semibold text-terra-700"
                    : "text-terroir-ink hover:text-terra-700"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <Link
                href={isAdmin ? "/tableau-de-bord" : "/compte"}
                className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-terroir-ink transition-colors hover:bg-terra-100 hover:text-terra-700"
              >
                <UserIcon className="h-5 w-5 text-terra-700" />
                <span className="font-medium">{label}</span>
              </Link>
              {isAdmin ? <Badge variant="green">Admin</Badge> : null}
              <form onSubmit={handleLogout}>
                <button
                  type="submit"
                  disabled={isLoggingOut}
                  className="text-xs text-terroir-muted transition-colors hover:text-terra-700 hover:underline disabled:opacity-50"
                >
                  Déconnexion
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/connexion"
                className="text-sm text-terroir-ink transition-colors hover:text-terra-700"
              >
                Connexion
              </Link>
              <Link
                href="/auth/inscription"
                className="inline-flex items-center rounded-md bg-terroir-green px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-terroir-green/90"
              >
                S&rsquo;inscrire
              </Link>
            </>
          )}
          {/* Toggle multi-rôle : rendu null si l'user n'a pas les deux rôles
              consumer ET producer. Position : après le bloc user, avant le
              panier — directement visible pour les multi-rôles. */}
          <RoleToggle current="consumer" />
          {!isAdmin ? <CartNavButton variant="desktop" /> : null}
        </div>
      </div>

      {/* === Drawer mobile (backdrop + aside) === */}
      <div
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-300 md:hidden ${
          drawerOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <aside
        id="mobile-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Menu de navigation"
        className={`fixed inset-y-0 left-0 z-50 flex w-80 max-w-[85vw] flex-col bg-terroir-bg p-6 shadow-xl transition-transform duration-300 ease-in-out md:hidden ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-6 flex items-center justify-between">
          <Logo size="md" variant="wordmark" />
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Fermer le menu"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-terroir-ink transition-colors hover:bg-terra-100 hover:text-terra-700 focus:outline-none focus:ring-2 focus:ring-terra-700"
          >
            <CloseIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Toggle multi-rôle dans le drawer mobile : rendu null si pas de
            dual-rôle. Position en tête du drawer pour visibilité immédiate. */}
        <div className="mb-4">
          <RoleToggle current="consumer" />
        </div>

        <nav
          className="flex flex-col gap-1"
          aria-label="Navigation principale mobile"
        >
          {links.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setDrawerOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-3 py-3 text-base transition-colors ${
                  active
                    ? "bg-terra-100 font-semibold text-terra-700"
                    : "text-terroir-ink hover:bg-terra-100 hover:text-terra-700"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-terroir-border pt-4">
          {user ? (
            <div className="flex flex-col gap-2">
              <Link
                href={isAdmin ? "/tableau-de-bord" : "/compte"}
                onClick={() => setDrawerOpen(false)}
                className="inline-flex items-center gap-2 rounded-md px-3 py-3 text-sm text-terroir-ink transition-colors hover:bg-terra-100 hover:text-terra-700"
              >
                <UserIcon className="h-5 w-5 text-terra-700" />
                <span className="font-medium">{label}</span>
                {isAdmin ? <Badge variant="green">Admin</Badge> : null}
              </Link>
              <form onSubmit={handleLogout}>
                <button
                  type="submit"
                  disabled={isLoggingOut}
                  className="w-full rounded-md px-3 py-3 text-left text-sm text-terroir-muted transition-colors hover:bg-terra-100 hover:text-terra-700 disabled:opacity-50"
                >
                  Déconnexion
                </button>
              </form>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Link
                href="/auth/inscription"
                onClick={() => setDrawerOpen(false)}
                className="block w-full rounded-md bg-terroir-green px-3 py-3 text-center text-base font-medium text-white transition-colors hover:bg-terroir-green/90"
              >
                S&rsquo;inscrire
              </Link>
              <Link
                href="/connexion"
                onClick={() => setDrawerOpen(false)}
                className="block rounded-md px-3 py-3 text-base text-terroir-ink hover:bg-terra-100 hover:text-terra-700"
              >
                Connexion
              </Link>
            </div>
          )}
        </div>
      </aside>
    </header>
  );
}
