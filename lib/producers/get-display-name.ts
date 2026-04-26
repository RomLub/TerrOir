// Helper canonical pour le "prénom d'affichage" d'un producteur côté lecture
// publique. Source unique : `users.prenom` (la personne physique derrière la
// ferme). Centralise la logique pour qu'au moment du DROP COLUMN
// `producers.prenom_affichage` (chantier suivant), il n'y ait plus aucune
// lecture de cette colonne dans le code applicatif.
//
// Le helper retourne `null` quand aucun prénom utilisable n'est disponible.
// Les call sites doivent traiter `null` comme "pas de prénom à afficher" et
// masquer le contenu qui en dépend (ex: le bloc "Le conseil de Julien" sur
// la fiche produit).

export interface UserPrenomSource {
  prenom: string | null;
}

export function getProducerDisplayName(
  user: UserPrenomSource | null | undefined,
): string | null {
  const trimmed = user?.prenom?.trim();
  return trimmed ? trimmed : null;
}
