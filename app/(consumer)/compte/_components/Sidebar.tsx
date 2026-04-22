"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RoleSwitcher } from "@/components/ui";

const NAV: { href: string; label: string }[] = [
  { href: "/compte", label: "Tableau de bord" },
  { href: "/compte/commandes", label: "Mes commandes" },
  { href: "/compte/profil", label: "Mon profil" },
  { href: "/compte/paiements", label: "Moyens de paiement" },
  { href: "/compte/password", label: "Mot de passe" },
];

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  // /compte est match exact (sinon il s'activerait sur toutes les sous-pages)
  if (href === "/compte") return pathname === "/compte";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="md:sticky md:top-20 md:self-start">
      <nav aria-label="Navigation compte">
        <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:flex-col md:gap-0.5 md:overflow-visible md:px-0">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`block whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-terroir-green-100 font-semibold text-terroir-green-700"
                      : "text-terroir-ink hover:bg-terroir-green-100/60 hover:text-terroir-green-700"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="mt-4 hidden border-t border-terroir-border pt-4 md:block">
        <RoleSwitcher current="consumer" variant="light" />
      </div>
    </aside>
  );
}
