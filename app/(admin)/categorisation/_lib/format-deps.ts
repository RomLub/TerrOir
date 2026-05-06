// Helpers de formatage UI pour les garde-fous DELETE de la catégorisation
// produit (T-130). Pure functions → testables sans render.
//
// Source unique pour les messages affichés AVANT confirm DELETE (tooltip
// si deps > 0) et pour le texte d'erreur affiché après un retour 409
// inattendu (filet : la UI désactive normalement le bouton, donc 409
// signale soit une race condition, soit un bug de count en amont).

export type CategorisationResource = "category" | "animal" | "cut";
export type CategorisationDeps = {
  products?: number;
  cuts?: number;
};

// Pluralisation FR locale. Utilisé partout dans cette page pour rester
// cohérent — pas d'i18n dans le repo, libellés FR codés en dur.
function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count > 1 ? plural : singular}`;
}

// Formatage compact des dépendances pour affichage tooltip / hint :
//   { products: 3 }              → "3 produits"
//   { products: 1 }              → "1 produit"
//   { products: 3, cuts: 5 }     → "3 produits + 5 morceaux"
//   { products: 0, cuts: 0 }     → "" (vide, le caller ne devrait pas afficher)
export function formatDependencyCount(deps: CategorisationDeps): string {
  const parts: string[] = [];
  if (deps.products && deps.products > 0) {
    parts.push(pluralize(deps.products, "produit", "produits"));
  }
  if (deps.cuts && deps.cuts > 0) {
    parts.push(pluralize(deps.cuts, "morceau", "morceaux"));
  }
  return parts.join(" + ");
}

// Message complet "Suppression impossible : ..." adapté à la ressource.
// Utilisé pour le retour 409 de l'API (filet) et pour le tooltip du bouton
// DELETE désactivé. Différencie animals (2 dimensions deps possibles) des
// autres (1 dimension seulement).
export function formatDeleteBlockedMessage(
  resource: CategorisationResource,
  deps: CategorisationDeps,
): string {
  const subject = formatDependencyCount(deps);
  if (!subject) {
    // Cas dégénéré : appelé sans dépendances. La UI ne devrait pas y
    // arriver, mais on retourne un message neutre plutôt que vide.
    return "Suppression impossible.";
  }

  if (resource === "category") {
    return `Suppression impossible : ${subject} utilise${deps.products && deps.products > 1 ? "nt" : ""} cette catégorie. Re-tagguer ces produits avant suppression.`;
  }
  if (resource === "animal") {
    return `Suppression impossible : ${subject} lié${(deps.products ?? 0) + (deps.cuts ?? 0) > 1 ? "s" : ""} à cette espèce. Re-tagguer / supprimer ces dépendances avant retrait.`;
  }
  // cut
  return `Suppression impossible : ${subject} utilise${deps.products && deps.products > 1 ? "nt" : ""} ce morceau. Re-tagguer ces produits avant suppression.`;
}

// Match recherche locale (name OU slug, case-insensitive). Le terme vide
// match tout. Trim pour tolérer "  fruit ".
export function matchesSearch<T extends { name: string; slug: string }>(
  row: T,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    row.name.toLowerCase().includes(q) ||
    row.slug.toLowerCase().includes(q)
  );
}
