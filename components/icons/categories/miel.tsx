// Icône catégorie "miel" — alvéole hexagonale + goutte. Set Claude
// Design, direction "gravure au trait". viewBox 24×24, currentColor.

type Props = { className?: string };

export function MielIcon({ className = "" }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <g strokeWidth="1">
        <path d="M12 2.5 L20 7 L20 16 L12 20.5 L4 16 L4 7 Z" />
        <path d="M12 8 C10.5 10.7 9.7 12.3 9.7 14 C9.7 16 10.7 17 12 17 C13.3 17 14.3 16 14.3 14 C14.3 12.3 13.5 10.7 12 8 Z" />
      </g>
      <g strokeWidth="0.5">
        <path d="M12 2.5 L12 7" />
        <path d="M4 7 L9.5 7" />
        <path d="M14.5 7 L20 7" />
        <path d="M12 16 L12 20.5" />
        <path d="M4 16 L9.5 16" />
        <path d="M14.5 16 L20 16" />
        <path d="M9.5 2 L12 0.6 L14.5 2" />
      </g>
    </svg>
  );
}
