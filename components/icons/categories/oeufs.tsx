// Icône catégorie "œufs" — œuf simple, ovale asymétrique (plus
// large en bas qu'en haut), conforme à la silhouette classique.

type Props = { className?: string };

export function OeufsIcon({ className = "" }: Props) {
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
      <path d="M12 3 c -4 0 -7 5 -7 11 c 0 4 3 7 7 7 c 4 0 7 -3 7 -7 c 0 -6 -3 -11 -7 -11 z" />
    </svg>
  );
}
