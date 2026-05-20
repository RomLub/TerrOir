// Icône épi de blé — avatar générique "producteur sarthois" pour la
// carte tag du hero home (remplace la mention inventée "Ferme des
// Tilleuls"). Direction "gravure au trait" (line-art, barbes + nervures
// fines) cohérente avec le set catégories Claude Design intégré en PR3.
// viewBox 24×24, currentColor. Hors components/icons/categories/ car ce
// n'est pas une catégorie produit.

type Props = { className?: string };

export function WheatIcon({ className = "" }: Props) {
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
        <path d="M12 22 L12 12" />
        <path d="M12 12 Q 13.6 8.5 12 4.5 Q 10.4 8.5 12 12 Z" />
        <path d="M12 13 Q 14.6 11 15 7.8 Q 12.8 9.8 12 13 Z" />
        <path d="M12 13 Q 9.4 11 9 7.8 Q 11.2 9.8 12 13 Z" />
        <path d="M12 16 Q 14.8 14 15.2 10.8 Q 12.9 12.8 12 16 Z" />
        <path d="M12 16 Q 9.2 14 8.8 10.8 Q 11.1 12.8 12 16 Z" />
        <path d="M12 19 Q 14.6 17 15 13.8 Q 12.8 15.8 12 19 Z" />
        <path d="M12 19 Q 9.4 17 9 13.8 Q 11.2 15.8 12 19 Z" />
      </g>
      <g strokeWidth="0.5">
        <path d="M12 4.5 L12 2" />
        <path d="M11.4 5 L10 2.8" />
        <path d="M12.6 5 L14 2.8" />
        <path d="M12 12.5 Q 13 10 13.5 7.5" />
        <path d="M12 12.5 Q 11 10 10.5 7.5" />
        <path d="M12 15.5 Q 13.2 13 13.7 10.5" />
        <path d="M12 15.5 Q 10.8 13 10.3 10.5" />
      </g>
    </svg>
  );
}
