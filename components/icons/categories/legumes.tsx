// Icône catégorie "légumes" — carotte stylisée. Triangle pointe en bas
// pour le corps, 3 feuilles divergentes au sommet.

type Props = { className?: string };

export function LegumesIcon({ className = "" }: Props) {
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
      <path d="M9 9 L15 9 L12.8 20.5 a1 1 0 0 1 -1.6 0 z" />
      <path d="M12 9 L12 4" />
      <path d="M10.2 8 L7.5 4.5" />
      <path d="M13.8 8 L16.5 4.5" />
    </svg>
  );
}
