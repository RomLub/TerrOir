// Banner d'information partagé en haut des listings paginés (consumer
// commandes, producer commandes, admin gestion-producteurs). Audit
// perf-postgres-2026-05-05 M-2 + NEW-1.
//
// Trois cas de rendu :
// - displayed === total                    → "<total> <label>"
// - displayed < total, page 1 (!isPaginated) → "<displayed> <label> sur <total> (les plus récents)"
// - displayed < total, page 2+ (isPaginated) → "Affichage de <displayed> <label> (<total> au total)"
//
// Le `isPaginated` lève l'ambiguïté du libellé "(les plus récents)"
// quand le cursor est actif : on n'est plus sur les rows les plus
// récentes, on parcourt une page interne.

export type ListingHeaderProps = {
  displayed: number;
  total: number;
  label: string;
  isPaginated?: boolean;
};

export function ListingHeader({
  displayed,
  total,
  label,
  isPaginated = false,
}: ListingHeaderProps) {
  let text: string;
  if (displayed >= total) {
    text = `${total} ${label}`;
  } else if (isPaginated) {
    text = `Affichage de ${displayed} ${label} (${total} au total)`;
  } else {
    text = `${displayed} ${label} sur ${total} (les plus récents)`;
  }
  return (
    <p className="text-[14px] text-dark/60" role="status">
      {text}
    </p>
  );
}
