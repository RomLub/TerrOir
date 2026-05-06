import Link from "next/link";
import { Logo } from "./logo";
import { NEXT_PUBLIC_PRODUCER_URL } from "@/lib/env/urls";

export type FooterLink = {
  href: string;
  label: string;
  external?: boolean;
};
export type FooterColumn = { title: string; links: FooterLink[] };

export type FooterProps = {
  columns?: FooterColumn[];
  className?: string;
};

const defaultColumns: FooterColumn[] = [
  {
    title: "Acheter",
    links: [
      { href: "/producteurs", label: "Producteurs" },
      { href: "/carte", label: "Carte" },
      { href: "/comment-ca-marche", label: "Comment ça marche" },
      { href: "/a-propos", label: "À propos" },
    ],
  },
  {
    title: "Producteurs",
    links: [
      { href: "/devenir-producteur", label: "Devenir producteur" },
      {
        href: NEXT_PUBLIC_PRODUCER_URL,
        label: "Espace producteur ↗",
        external: true,
      },
      { href: "/connexion", label: "Connexion" },
    ],
  },
];

export function Footer({
  columns = defaultColumns,
  className = "",
}: FooterProps) {
  const year = new Date().getFullYear();
  return (
    <footer
      className={`bg-green-900 text-white/65 ${className}`}
    >
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-10 md:grid-cols-4">
          {/* Brand */}
          <div className="md:col-span-1">
            <Logo size="md" variant="wordmark-dark" />
            <p className="mt-4 max-w-[280px] text-sm leading-relaxed text-white/65">
              La marketplace des producteurs sarthois. Du pré à votre table,
              en trois étapes.
            </p>
            <p className="mt-4 max-w-[280px] text-xs italic leading-relaxed text-white/45">
              TerrOir prélève une petite commission pour faire vivre la
              marketplace.
            </p>
          </div>

          {/* Standard cols (Acheter + Producteurs) */}
          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
                {col.title}
              </h4>
              <ul className="flex flex-col gap-2.5">
                {col.links.map((l) =>
                  l.external ? (
                    <li key={l.href}>
                      <a
                        href={l.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-white/80 transition-colors hover:text-white"
                      >
                        {l.label}
                      </a>
                    </li>
                  ) : (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        className="text-sm text-white/80 transition-colors hover:text-white"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}

          {/* Aide : contact + FAQ + livraison + politique. La ligne
              juridique de pied (Mentions légales · CGU · CGV) est rendue
              dans le footer bottom — pages existantes en placeholder
              (P0 légales 2026-05-06). */}
          <div>
            <h4 className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
              Aide
            </h4>
            <ul className="flex flex-col gap-2.5">
              <li>
                <Link
                  href="/contact"
                  className="text-sm text-white/80 transition-colors hover:text-white"
                >
                  Contact
                </Link>
              </li>
              <li>
                <Link
                  href="/faq"
                  className="text-sm text-white/80 transition-colors hover:text-white"
                >
                  FAQ
                </Link>
              </li>
              <li>
                <Link
                  href="/livraison"
                  className="text-sm text-white/80 transition-colors hover:text-white"
                >
                  Livraison et retrait
                </Link>
              </li>
              <li>
                <Link
                  href="/politique-confidentialite"
                  className="text-sm text-white/80 transition-colors hover:text-white"
                >
                  Politique de confidentialité
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Footer bottom : copyright + ligne juridique active. */}
        <div className="mt-12 border-t border-white/10 pt-6 flex flex-wrap items-center justify-between gap-4">
          <p className="text-xs text-white/45">
            © {year} TerrOir · Sarthe
          </p>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/55">
            <li>
              <Link
                href="/mentions-legales"
                className="transition-colors hover:text-white"
              >
                Mentions légales
              </Link>
            </li>
            <li aria-hidden className="text-white/25">·</li>
            <li>
              <Link
                href="/cgu"
                className="transition-colors hover:text-white"
              >
                CGU
              </Link>
            </li>
            <li aria-hidden className="text-white/25">·</li>
            <li>
              <Link
                href="/cgv"
                className="transition-colors hover:text-white"
              >
                CGV
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
