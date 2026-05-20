// Icône épi de blé — avatar générique "producteur sarthois" pour la
// carte tag du hero home (remplace la mention inventée "Ferme des
// Tilleuls"). Set Claude Design, variante A élancée : tige nette,
// barbes franches au sommet (signature de lecture à petite taille),
// 4 paires de grains en chevron. viewBox 24×24, currentColor. Hors
// components/icons/categories/ (pas une catégorie produit).

type Props = { className?: string };

export function WheatIcon({ className = "" }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 15 L12 22" />
      <path d="M12 4 L12 1" />
      <path d="M12 4 L10 1.4" />
      <path d="M12 4 L14 1.4" />
      <path d="M12 4 L8.5 2.2" />
      <path d="M12 4 L15.5 2.2" />
      <path d="M12 6 C 10 6, 8 5.5, 8.5 4 C 10 4.5, 11.5 5, 12 6 Z" />
      <path d="M12 6 C 14 6, 16 5.5, 15.5 4 C 14 4.5, 12.5 5, 12 6 Z" />
      <path d="M12 9 C 10 9, 8 8.5, 8.5 7 C 10 7.5, 11.5 8, 12 9 Z" />
      <path d="M12 9 C 14 9, 16 8.5, 15.5 7 C 14 7.5, 12.5 8, 12 9 Z" />
      <path d="M12 12 C 10 12, 8 11.5, 8.5 10 C 10 10.5, 11.5 11, 12 12 Z" />
      <path d="M12 12 C 14 12, 16 11.5, 15.5 10 C 14 10.5, 12.5 11, 12 12 Z" />
      <path d="M12 15 C 10 15, 8 14.5, 8.5 13 C 10 13.5, 11.5 14, 12 15 Z" />
      <path d="M12 15 C 14 15, 16 14.5, 15.5 13 C 14 13.5, 12.5 14, 12 15 Z" />
    </svg>
  );
}
