// Construit l'URL de drill-down vers la page admin /gestion-producteurs
// préfiltrée sur un user_id donné. Helper extrait pour qu'un éventuel
// renommage du searchParam (ou du chemin) reste localisé à un seul point.
export function buildProducerHref(userId: string): string {
  return `/gestion-producteurs?user_id=${encodeURIComponent(userId)}`;
}
