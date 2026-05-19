// Icône catégorie "viande" — os à moelle stylisé. 4 cercles aux
// extrémités (les bulbes) + un cylindre central horizontal.

type Props = { className?: string };

export function ViandeIcon({ className = "" }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="5" cy="9" r="1.8" />
      <circle cx="5" cy="15" r="1.8" />
      <circle cx="19" cy="9" r="1.8" />
      <circle cx="19" cy="15" r="1.8" />
      <rect x="6.5" y="10.2" width="11" height="3.6" rx="1.8" />
    </svg>
  );
}
