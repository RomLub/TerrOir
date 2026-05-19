// Icône catégorie "charcuterie" — saucisson tranché. Set Claude Design,
// direction "gravure au trait" (line-art, grain de gras pointillé).
// viewBox 24×24, currentColor.

type Props = { className?: string };

export function CharcuterieIcon({ className = "" }: Props) {
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
        <rect x="4" y="8" width="11" height="8" rx="4" />
        <path d="M4 9.5 L3 8.5" />
        <path d="M4 14.5 L3 15.5" />
        <circle cx="18.5" cy="10" r="1.8" />
        <circle cx="19.5" cy="14.5" r="1.5" />
      </g>
      <g strokeWidth="0.5">
        <path d="M4 10.5 L15 10.5" />
        <path d="M4 13 L15 13" />
        <path d="M6 9 C7 8.7 9 9.3 10 9" />
        <path d="M6 11.6 C7 11.3 9 11.9 10 11.6" />
        <path d="M6 14 C7 13.7 9 14.3 10 14" />
      </g>
      <g fill="currentColor" stroke="none">
        <circle cx="18.5" cy="10" r="0.35" />
        <circle cx="18.2" cy="9.5" r="0.25" />
        <circle cx="18.9" cy="10.4" r="0.25" />
        <circle cx="19.5" cy="14.5" r="0.32" />
        <circle cx="19.2" cy="14.1" r="0.22" />
      </g>
    </svg>
  );
}
