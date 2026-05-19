import { ViandeIcon } from "@/components/icons/categories/viande";
import { CharcuterieIcon } from "@/components/icons/categories/charcuterie";
import { LegumesIcon } from "@/components/icons/categories/legumes";
import { FromagesIcon } from "@/components/icons/categories/fromages";
import { MielIcon } from "@/components/icons/categories/miel";
import { OeufsIcon } from "@/components/icons/categories/oeufs";
import { AutresIcon } from "@/components/icons/categories/autres";
import { FallbackIcon } from "@/components/icons/categories/fallback";

// Sélecteur d'icône catégorie produit (PR3 audit photos 2026-05-17).
//
// Accepte un `category` libre — peut être le slug exact ("viande")
// ou le nom user-facing ("Viande", "Légumes", "Œufs"). La
// normalisation interne (NFD + remove combining + lowercase + ligatures
// œ/æ) résout les deux formes vers le slug canonique. Inconnu = panier
// fallback.

const ICONS = {
  viande: ViandeIcon,
  charcuterie: CharcuterieIcon,
  legumes: LegumesIcon,
  fromages: FromagesIcon,
  miel: MielIcon,
  oeufs: OeufsIcon,
  autres: AutresIcon,
} as const;

type Slug = keyof typeof ICONS;

function normalize(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .trim();
}

function resolveSlug(input?: string): Slug | null {
  if (!input) return null;
  const slug = normalize(input);
  return slug in ICONS ? (slug as Slug) : null;
}

export type CategoryIconProps = {
  category?: string;
  className?: string;
};

export function CategoryIcon({ category, className = "" }: CategoryIconProps) {
  const slug = resolveSlug(category);
  if (slug === null) return <FallbackIcon className={className} />;
  const Icon = ICONS[slug];
  return <Icon className={className} />;
}
