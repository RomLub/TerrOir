import Link from "next/link";
import { Logo } from "./logo";

export type ProducerNavLink = { href: string; label: string };

export type NavbarProducerProps = {
  links?: ProducerNavLink[];
  producerName?: string;
  className?: string;
};

const defaultLinks: ProducerNavLink[] = [
  { href: "/producteur", label: "Tableau de bord" },
  { href: "/producteur/produits", label: "Produits" },
  { href: "/producteur/commandes", label: "Commandes" },
  { href: "/producteur/profil", label: "Profil" },
];

export function NavbarProducer({
  links = defaultLinks,
  producerName,
  className = "",
}: NavbarProducerProps) {
  return (
    <header
      className={`sticky top-0 z-40 w-full border-b border-terroir-border bg-white ${className}`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-6">
          <Logo size="sm" href="/producteur" />
          <nav
            className="hidden items-center gap-5 md:flex"
            aria-label="Navigation producteur"
          >
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-sm text-terroir-ink hover:text-terroir-green-700"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {producerName ? (
            <span className="hidden text-sm text-terroir-muted sm:inline">
              {producerName}
            </span>
          ) : null}
          <Link
            href="/deconnexion"
            className="text-sm text-terroir-terra-700 hover:underline"
          >
            Déconnexion
          </Link>
        </div>
      </div>
    </header>
  );
}
