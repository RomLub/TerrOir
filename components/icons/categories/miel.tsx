// Icône catégorie "miel" — alvéole hexagonale avec une goutte de miel
// au centre. Lecture universelle "miel/ruche".

type Props = { className?: string };

export function MielIcon({ className = "" }: Props) {
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
      <path d="M12 2 L20.5 7 L20.5 17 L12 22 L3.5 17 L3.5 7 z" />
      <path d="M12 10 c -1.5 2 -2.3 3.5 -2.3 5 c 0 1.5 1 2.5 2.3 2.5 c 1.3 0 2.3 -1 2.3 -2.5 c 0 -1.5 -0.8 -3 -2.3 -5 z" />
    </svg>
  );
}
