// Icône catégorie "légumes" — carotte. Set Claude Design, direction
// "gravure au trait" (line-art, hachures fines). viewBox 24×24,
// currentColor (couleur appliquée par ProductFallback).

type Props = { className?: string };

export function LegumesIcon({ className = "" }: Props) {
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
        <path d="M11.5 6 L11 1.5 L12.5 4 L13 1.8 L13.3 4.5" />
        <path d="M11 6 L9.5 3 L10.2 5.3 L8.8 3.5 L10 6" />
        <path d="M13 6 L14.8 3.2 L13.8 5.3 L15.2 4 L13.8 6" />
        <path d="M8.5 7.5 C8.2 7.5 8 7.9 8.1 8.3 L11 21 C11.2 21.6 12.8 21.6 13 21 L15.9 8.3 C16 7.9 15.8 7.5 15.5 7.5 Z" />
      </g>
      <g strokeWidth="0.5">
        <path d="M9.7 11 L14.1 11" />
        <path d="M10.1 13.7 L13.7 13.7" />
        <path d="M10.5 16.3 L13.3 16.3" />
        <path d="M9.5 9 L10.3 9.4" />
        <path d="M13.2 9 L14 9.4" />
        <path d="M10 14.5 L10.7 14.9" />
        <path d="M12.9 14.5 L13.6 14.9" />
        <path d="M11 18 L11.5 18.4" />
        <path d="M12.4 18 L12.9 18.4" />
      </g>
    </svg>
  );
}
