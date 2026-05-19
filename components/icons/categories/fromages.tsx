// Icône catégorie "fromages" — quart de meule en vue 3/4 (triangle
// avec sommet en haut), 3 trous style emmental.

type Props = { className?: string };

export function FromagesIcon({ className = "" }: Props) {
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
      <path d="M4 19 L12 4 L20 19 z" />
      <circle cx="10" cy="14" r="0.9" />
      <circle cx="14.5" cy="13" r="0.9" />
      <circle cx="12" cy="17" r="0.9" />
    </svg>
  );
}
