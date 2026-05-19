// Icône catégorie "autres" — panier en osier. Set Claude Design,
// direction "gravure au trait" (line-art, vannerie tressée). viewBox
// 24×24, currentColor. Réutilisée comme icône fallback (cf. fallback.tsx).

type Props = { className?: string };

export function AutresIcon({ className = "" }: Props) {
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
        <path d="M7 11 C7 4.5 17 4.5 17 11" />
        <path d="M3 10.5 L21 10.5" />
        <path d="M4.5 10.5 L6 20.5 C6.05 21 6.5 21 7 21 L17 21 C17.5 21 17.95 21 18 20.5 L19.5 10.5" />
      </g>
      <g strokeWidth="0.5">
        <path d="M8 11 C8 6 16 6 16 11" />
        <path d="M7 11 L7.5 21" />
        <path d="M10 11 L10.3 21" />
        <path d="M13 11 L13 21" />
        <path d="M16 11 L15.7 21" />
        <path d="M5 13 L19 13" />
        <path d="M5.3 15 L18.7 15" />
        <path d="M5.6 17 L18.4 17" />
        <path d="M5.9 19 L18.1 19" />
      </g>
    </svg>
  );
}
