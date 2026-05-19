// Icône catégorie "viande". Set Claude Design, direction "gravure au
// trait" (line-art, hachures fines de persillage). viewBox 24×24,
// currentColor.

type Props = { className?: string };

export function ViandeIcon({ className = "" }: Props) {
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
        <path d="M3.5 13 C3.5 9.5 6 7 10 7.5 C11.5 7.7 12.5 8.5 13.5 9 C15 9.5 17 9 19 9.5 C21 10 21.5 13.5 19.5 15.5 C17.5 17.5 13 17.5 9 17 C6 16.5 3.5 16 3.5 13 Z" />
        <path d="M10 10 L14 10" />
        <path d="M12 10 L12 13" />
      </g>
      <g strokeWidth="0.5">
        <path d="M5 12 L7 12.2" />
        <path d="M5.5 13.5 L8 13.7" />
        <path d="M4.5 14.7 L6.8 14.9" />
        <path d="M14.5 12 L16.5 12.3" />
        <path d="M15 13.5 L18 13.7" />
        <path d="M14.5 14.8 L17 15" />
        <path d="M6 15.8 L8 15.95" />
        <path d="M15 15.7 L17 15.85" />
      </g>
    </svg>
  );
}
