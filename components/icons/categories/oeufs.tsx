// Icône catégorie "œufs". Set Claude Design, direction "gravure au
// trait" (line-art, hachures fines). viewBox 24×24, currentColor.

type Props = { className?: string };

export function OeufsIcon({ className = "" }: Props) {
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
        <path d="M7.5 6.5 C4.5 6.5 3.5 10 3.5 13.5 C3.5 16.5 5 18.5 7.5 18.5 C10 18.5 11.5 16.5 11.5 13.5 C11.5 10 10.5 6.5 7.5 6.5 Z" />
        <path d="M15.5 10 C12.5 10 11.5 13.5 11.5 16.5 C11.5 19.5 13 21.5 15.5 21.5 C18 21.5 19.5 19.5 19.5 16.5 C19.5 13.5 18.5 10 15.5 10 Z" />
      </g>
      <g strokeWidth="0.5">
        <path d="M2.5 19.6 L5.6 18.3" />
        <path d="M4 21.1 L7 19.8" />
        <path d="M4.6 14.5 L5.4 14.8" />
        <path d="M4.3 16 L5.1 16.4" />
        <path d="M5 17.2 L5.7 17.6" />
        <path d="M12.6 18 L13.4 18.3" />
        <path d="M12.4 19.3 L13.2 19.7" />
        <path d="M13 20.3 L13.7 20.7" />
      </g>
    </svg>
  );
}
