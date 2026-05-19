// Icône catégorie "charcuterie" — saucisse stylisée. Forme allongée
// arrondie aux deux extrémités, ligatures verticales pour évoquer la
// cordelette/le nœud.

type Props = { className?: string };

export function CharcuterieIcon({ className = "" }: Props) {
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
      <path d="M5 12 c 0 -2.5 2 -4 4.5 -4 L14.5 8 c 2.5 0 4.5 1.5 4.5 4 c 0 2.5 -2 4 -4.5 4 L9.5 16 c -2.5 0 -4.5 -1.5 -4.5 -4 z" />
      <line x1="8" y1="9.5" x2="8" y2="14.5" />
      <line x1="16" y1="9.5" x2="16" y2="14.5" />
    </svg>
  );
}
