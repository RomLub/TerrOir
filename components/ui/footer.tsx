import Link from "next/link";
import { Logo } from "./logo";

export type FooterLink = { href: string; label: string };
export type FooterColumn = { title: string; links: FooterLink[] };

export type FooterProps = {
  columns?: FooterColumn[];
  className?: string;
};

const defaultColumns: FooterColumn[] = [
  {
    title: "Découvrir",
    links: [
      { href: "/producteurs", label: "Producteurs" },
      { href: "/produits", label: "Produits" },
      { href: "/regions", label: "Régions" },
    ],
  },
  {
    title: "TerrOir",
    links: [
      { href: "/a-propos", label: "À propos" },
      { href: "/contact", label: "Contact" },
      { href: "/producteur/inscription", label: "Devenir producteur" },
    ],
  },
  {
    title: "Légal",
    links: [
      { href: "/mentions-legales", label: "Mentions légales" },
      { href: "/cgv", label: "CGV" },
      { href: "/confidentialite", label: "Confidentialité" },
    ],
  },
];

export function Footer({ columns = defaultColumns, className = "" }: FooterProps) {
  const year = new Date().getFullYear();
  return (
    <footer
      className={`mt-16 border-t border-terroir-border bg-white ${className}`}
    >
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-4">
        <div className="md:col-span-1">
          <Logo size="md" withTagline />
        </div>
        {columns.map((col) => (
          <div key={col.title}>
            <h4 className="mb-3 font-serif text-lg text-terroir-ink">
              {col.title}
            </h4>
            <ul className="flex flex-col gap-2">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-sm text-terroir-ink/80 hover:text-terroir-green-700"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-terroir-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 text-xs text-terroir-muted">
          <span>© {year} TerrOir. Tous droits réservés.</span>
          <span>Fait avec soin en France.</span>
        </div>
      </div>
    </footer>
  );
}
