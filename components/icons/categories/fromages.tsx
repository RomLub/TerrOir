// Icône catégorie "fromages" — part de fromage avec trous. Set Claude
// Design, direction "gravure au trait" (line-art, croûte hachurée).
// viewBox 24×24, currentColor.

type Props = { className?: string };

export function FromagesIcon({ className = "" }: Props) {
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
        <path d="M3.5 17.5 L19.5 17.5 C20.3 17.5 20.5 17 20.5 16.2 L20.5 9 C20.5 8 19.5 7.8 18.5 8.5 C14 11 8 14 3.8 17 C3.3 17.3 3.3 17.5 3.5 17.5 Z" />
        <circle cx="13.5" cy="14.5" r="1.3" />
        <circle cx="16.5" cy="12.5" r="0.9" />
        <circle cx="10" cy="15.8" r="0.7" />
      </g>
      <g strokeWidth="0.5">
        <path d="M7 16 L7.4 16.7" />
        <path d="M9 15 L9.4 15.7" />
        <path d="M11 14 L11.4 14.7" />
        <path d="M13 12.8 L13.4 13.5" />
        <path d="M15 11.5 L15.4 12.2" />
        <path d="M17 10 L17.4 10.7" />
        <path d="M19 8.5 L19.4 9.2" />
      </g>
      <g fill="currentColor" stroke="none">
        <circle cx="6" cy="16.7" r="0.2" />
        <circle cx="12" cy="16.3" r="0.2" />
        <circle cx="18.5" cy="14.5" r="0.2" />
      </g>
    </svg>
  );
}
