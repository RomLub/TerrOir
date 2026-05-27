import type { PublicationCriteria } from "@/lib/producers/publication-status";

// Source unique des 6 critères de mise en ligne. Évite le hardcoding du « /6 »
// dans les surfaces UI (carte dashboard, panneau ma-page) et centralise les
// libellés (long pour la checklist détaillée, court pour la carte dashboard).
// L'ordre reflète l'ordre d'affichage de la checklist côté producteur — les 3
// premiers critères se règlent sur /ma-page directement (pas de `href` dédié),
// les 3 suivants pointent vers leur page de complétion respective.

export type CriterionKey = keyof PublicationCriteria;

export type CriterionMeta = {
  key: CriterionKey;
  /** Libellé long affiché dans la checklist du panneau /ma-page. */
  label: string;
  /** Libellé court affiché inline dans la carte du dashboard. */
  shortLabel: string;
  /**
   * Page de complétion du critère. Pour les critères réglables sur /ma-page
   * directement (description, photo, localisation), l'href utilise
   * `?tab=edit&focus=<id>` : /ma-page lit ces query params pour activer
   * l'onglet « Modifier » et scroller vers la section ciblée.
   */
  href: string;
};

export const PUBLICATION_CRITERIA: readonly CriterionMeta[] = [
  {
    key: "description",
    label: "Une description d'au moins 150 caractères",
    shortLabel: "Description",
    href: "/ma-page?tab=edit&focus=ma-page-description",
  },
  {
    key: "photo_principale",
    label: "Une photo de couverture",
    shortLabel: "Photo de couverture",
    href: "/ma-page?tab=edit&focus=ma-page-photo-section",
  },
  {
    key: "localisation",
    label: "Commune et code postal renseignés",
    shortLabel: "Localisation",
    href: "/ma-page?tab=edit&focus=ma-page-localisation",
  },
  {
    key: "product_with_photo",
    label: "Au moins un produit publié avec une photo",
    shortLabel: "1 produit avec photo",
    href: "/catalogue",
  },
  {
    key: "open_slot",
    label: "Au moins un créneau de retrait ouvert",
    shortLabel: "1 créneau ouvert",
    href: "/creneaux",
  },
  {
    key: "stripe",
    label: "Paiements activés (compte vérifié)",
    shortLabel: "Paiements activés",
    href: "/parametres",
  },
] as const;
