// Icône fallback générique — panier en osier (identique à AutresIcon
// par décision produit 2026-05-17). Fichier dédié pour permettre une
// évolution distincte plus tard si le fallback doit diverger
// sémantiquement (ex : interrogation, point d'exclamation) du panier
// catégorie "autres".

type Props = { className?: string };

export function FallbackIcon({ className = "" }: Props) {
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
      <path d="M7 10 c 0 -3 2 -5 5 -5 c 3 0 5 2 5 5" />
      <path d="M3 10 L21 10" />
      <path d="M5 10 L6.5 20.5 a1 1 0 0 0 1 0.5 L16.5 21 a1 1 0 0 0 1 -0.5 L19 10" />
      <line x1="9.5" y1="10.5" x2="9" y2="20.5" />
      <line x1="12" y1="10.5" x2="12" y2="20.5" />
      <line x1="14.5" y1="10.5" x2="15" y2="20.5" />
      <line x1="6" y1="15" x2="18" y2="15" />
    </svg>
  );
}
