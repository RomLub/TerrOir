// Ligne de statut (loading / empty / empty-filtered) pour les tables
// admin (Phase B5 consolidation). Extrait le pattern répété
// <tr><td colSpan={N} className="px-5 py-10 text-center text-gray-500">
// …</td></tr> utilisé par gestion-producteurs et suivi-commandes pour
// l'état vide et l'état chargement des tableaux.
//
// Les pages producer-interests et avis utilisent un pattern de statut
// différent (div-based wrapper, pas tr/td) — intentionnellement pas
// migré ici, candidat à une future consolidation <StatusPanel>.

export type TableStatusProps = {
  kind: "loading" | "empty" | "empty-filtered";
  colSpan: number;
  emptyLabel?: string;
  loadingLabel?: string;
  emptyFilteredLabel?: string;
};

export function TableStatus({
  kind,
  colSpan,
  emptyLabel = "Aucun élément à afficher",
  loadingLabel = "Chargement…",
  emptyFilteredLabel = "Aucun résultat avec ces filtres",
}: TableStatusProps) {
  const label =
    kind === "loading"
      ? loadingLabel
      : kind === "empty-filtered"
        ? emptyFilteredLabel
        : emptyLabel;
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-5 py-10 text-center text-gray-500"
      >
        {label}
      </td>
    </tr>
  );
}
