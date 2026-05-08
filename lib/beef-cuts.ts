/**
 * Source de vérité des morceaux de bœuf pour TerrOir.
 *
 * Chaque slug correspond à un attribut `data-cut` dans le SVG `cow.svg`.
 * Les catégories pilotent la palette terra appliquée dans le schéma visuel
 * et la logique de cuisson recommandée sur les fiches.
 *
 * Schéma anatomique adapté de "Beef cuts France" sur Wikimedia Commons,
 * sous licence CC-BY-SA 3.0. Voir https://commons.wikimedia.org/wiki/File:Beef_cuts_France.svg
 */

import { CUT_IMAGES } from '@/scripts/cut-images.generated';

export type BeefCutCategory =
  | 'noble'
  | 'piece-du-boucher'
  | 'polyvalent'
  | 'a-mijoter'
  | 'abat-extremite';

export type BeefCutSlug =
  | 'collier'
  | 'basses-cotes'
  | 'cotes-entrecotes'
  | 'faux-filet'
  | 'filet'
  | 'rumsteck'
  | 'aiguillette-baronne'
  | 'rond-de-gite'
  | 'gite-a-la-noix'
  | 'tranche'
  | 'poire-merlan'
  | 'araignee'
  | 'bavette-d-aloyau'
  | 'macreuse-a-bifteck'
  | 'jumeau-a-bifteck'
  | 'onglet'
  | 'hampe'
  | 'plat-de-cotes'
  | 'tendron'
  | 'flanchet'
  | 'bavette-de-flanchet'
  | 'paleron'
  | 'macreuse'
  | 'jumeau'
  | 'gite'
  | 'poitrine'
  | 'joue'
  | 'langue'
  | 'queue';

export type BeefCutImage = {
  /** URL relative au domaine (ex. /images/cuts/filet.jpg) ou absolue. */
  imageUrl: string;
  /** Alt text descriptif (sert aussi pour SEO + lecteurs d'ecran). */
  imageAlt: string;
  /** Credit photographe au format libre (ex. "Photo : John Doe / Pixabay"). */
  imageCredit: string;
};

export type BeefCut = {
  slug: BeefCutSlug;
  /** Nom affiché à l'utilisateur (avec accents et casse correcte) */
  name: string;
  category: BeefCutCategory;
  /** Description courte, 1 à 2 phrases, lisible depuis le tooltip */
  shortDescription: string;
  /** Description longue pour la page détail */
  description: string;
  /** Modes de cuisson recommandés, du plus à au moins courant */
  cookingMethods: readonly string[];
  /** Plats emblématiques où ce morceau est utilisé */
  signatureDishes: readonly string[];
  /** Photo du morceau cuisiné (auto-fetch via scripts/fetch-cut-images.ts). */
  imageUrl?: string;
  imageAlt?: string;
  imageCredit?: string;
};

/**
 * Catalogue complet des morceaux du bœuf en boucherie française.
 *
 * L'ordre suit une logique de "noblesse décroissante" pour faciliter
 * la lecture si on itère dessus.
 */
const BEEF_CUTS_BASE: Record<BeefCutSlug, BeefCut> = {
  // ─────────── Morceaux nobles ───────────
  'basses-cotes': {
    slug: 'basses-cotes',
    name: 'Basses-côtes',
    category: 'noble',
    shortDescription:
      'Premières côtes derrière le collier, persillées. Grillade en pavé ou braisé.',
    description:
      "Issues des cinq premières côtes du train avant, les basses-côtes sont persillées et goûteuses. Coupées en pavé épais, elles se grillent comme une entrecôte ; détaillées en morceaux, elles deviennent fondantes après une cuisson lente.",
    cookingMethods: ['Grill', 'Poêle', 'Braisé'],
    signatureDishes: ['Pavé de basse-côte', 'Basse-côte braisée'],
  },
  filet: {
    slug: 'filet',
    name: 'Filet',
    category: 'noble',
    shortDescription:
      "Le morceau le plus tendre, situé sous l'aloyau. Cuisson rapide et précise.",
    description:
      'Pièce maîtresse de la longe, le filet est un muscle peu sollicité, ce qui en fait la viande la plus tendre du bœuf. Maigre et fondant, il se cuit rapidement à feu vif pour préserver sa délicatesse.',
    cookingMethods: ['Poêle', 'Grill', 'Rôti'],
    signatureDishes: ['Tournedos Rossini', 'Filet en croûte', 'Chateaubriand'],
  },
  'faux-filet': {
    slug: 'faux-filet',
    name: 'Faux-filet',
    category: 'noble',
    shortDescription:
      'Pièce noble du dos, persillée et tendre. À griller saignant.',
    description:
      "Situé entre l'entrecôte et le rumsteck, le faux-filet offre un excellent compromis entre tendreté et goût. Persillage modéré, fibres fines, idéal pour une cuisson saignante.",
    cookingMethods: ['Grill', 'Poêle', 'Barbecue'],
    signatureDishes: ['Steak frites', 'Pavé de faux-filet'],
  },
  'cotes-entrecotes': {
    slug: 'cotes-entrecotes',
    name: 'Côtes & entrecôtes',
    category: 'noble',
    shortDescription:
      'La même pièce vendue avec ou sans os. Très persillée, généreuse en goût.',
    description:
      'Coupée dans le train de côtes, cette pièce iconique se vend en côte de bœuf (avec os) pour les grandes tablées ou en entrecôte (désossée). Persillage prononcé, mâche caractéristique.',
    cookingMethods: ['Grill', 'Barbecue', 'Poêle'],
    signatureDishes: ['Côte de bœuf', 'Entrecôte bordelaise'],
  },
  rumsteck: {
    slug: 'rumsteck',
    name: 'Rumsteck',
    category: 'noble',
    shortDescription:
      'Grande pièce arrière, tendre et savoureuse. Polyvalente.',
    description:
      "Issu de l'aloyau arrière, le rumsteck offre une viande tendre avec un bon goût. C'est l'une des pièces les plus polyvalentes du bœuf : steak, brochette, rôti, fondue.",
    cookingMethods: ['Grill', 'Poêle', 'Brochette', 'Rôti'],
    signatureDishes: ['Pavé de rumsteck', 'Fondue bourguignonne', 'Brochettes'],
  },
  'aiguillette-baronne': {
    slug: 'aiguillette-baronne',
    name: 'Aiguillette baronne',
    category: 'noble',
    shortDescription:
      'Petite pièce rare et tendre, prisée des connaisseurs.',
    description:
      "Muscle long et fin niché entre rumsteck et tende de tranche, l'aiguillette baronne est un morceau peu connu mais d'une tendreté remarquable. Souvent réservée par les bouchers.",
    cookingMethods: ['Poêle', 'Grill'],
    signatureDishes: ['Aiguillette poêlée'],
  },
  'rond-de-gite': {
    slug: 'rond-de-gite',
    name: 'Rond de gîte',
    category: 'noble',
    shortDescription:
      'Pièce arrière maigre et tendre. Excellent en rosbif ou bourguignon.',
    description:
      'Muscle de la cuisse arrière, le rond de gîte est tendre et maigre. Selon la découpe, il fait un rosbif soigné ou des steaks.',
    cookingMethods: ['Rôti', 'Poêle'],
    signatureDishes: ['Rosbif', 'Carpaccio'],
  },

  // ─────────── Pièces du boucher ───────────
  onglet: {
    slug: 'onglet',
    name: 'Onglet',
    category: 'piece-du-boucher',
    shortDescription:
      'Morceau du diaphragme, à griller saignant. Goût puissant, texture unique.',
    description:
      "Pièce du diaphragme, l'onglet est l'un des morceaux préférés des bouchers. Goût prononcé presque ferreux, texture tendre quand il est cuit saignant et coupé contre le grain.",
    cookingMethods: ['Poêle', 'Grill'],
    signatureDishes: ["Onglet à l'échalote", 'Onglet poêlé'],
  },
  hampe: {
    slug: 'hampe',
    name: 'Hampe',
    category: 'piece-du-boucher',
    shortDescription:
      "Cousine de l'onglet, fibres longues et goût intense.",
    description:
      "Comme l'onglet, la hampe vient du diaphragme. Longues fibres caractéristiques, saveur intense. Doit être cuite saignante et tranchée contre le grain.",
    cookingMethods: ['Poêle', 'Grill'],
    signatureDishes: ["Hampe à l'échalote"],
  },
  araignee: {
    slug: 'araignee',
    name: 'Araignée',
    category: 'piece-du-boucher',
    shortDescription:
      'Petit muscle rare et persillé. Le secret des bouchers.',
    description:
      "Niché contre le bassin, l'araignée tire son nom de sa structure de fibres en toile. Très persillée, ultra-savoureuse, c'est une pièce confidentielle souvent gardée par les bouchers.",
    cookingMethods: ['Poêle', 'Grill'],
    signatureDishes: ['Araignée poêlée'],
  },
  'poire-merlan': {
    slug: 'poire-merlan',
    name: 'Poire & merlan',
    category: 'piece-du-boucher',
    shortDescription:
      'Deux petits muscles tendres de la cuisse. Pièces de boucher recherchées.',
    description:
      "La poire et le merlan sont deux petits muscles de la cuisse arrière, particulièrement tendres et fondants. Comme l'araignée, ce sont des morceaux dits \"du boucher\", peu nombreux par carcasse.",
    cookingMethods: ['Poêle', 'Grill'],
    signatureDishes: ['Steak de poire', 'Merlan grillé'],
  },
  'bavette-d-aloyau': {
    slug: 'bavette-d-aloyau',
    name: "Bavette d'aloyau",
    category: 'piece-du-boucher',
    shortDescription:
      'Fibres lâches, goût marqué. À griller saignante avec des échalotes.',
    description:
      "Située sous le filet, la bavette d'aloyau a des fibres longues et apparentes. Saveur intense, texture caractéristique. Indispensable saignante, sinon elle durcit.",
    cookingMethods: ['Poêle', 'Grill'],
    signatureDishes: ["Bavette à l'échalote"],
  },
  'macreuse-a-bifteck': {
    slug: 'macreuse-a-bifteck',
    name: 'Macreuse à bifteck',
    category: 'piece-du-boucher',
    shortDescription:
      'Partie tendre de la macreuse, isolée pour la grillade.',
    description:
      "Quand le boucher sépare le muscle de l'épaule, la partie la plus tendre devient la macreuse à bifteck — un steak savoureux et abordable.",
    cookingMethods: ['Poêle', 'Grill'],
    signatureDishes: ['Steak haché de qualité', 'Macreuse poêlée'],
  },
  'jumeau-a-bifteck': {
    slug: 'jumeau-a-bifteck',
    name: 'Jumeau à bifteck',
    category: 'piece-du-boucher',
    shortDescription:
      "Partie tendre du jumeau de l'épaule, à griller comme un steak.",
    description:
      'Petit muscle annexe du jumeau, le jumeau à bifteck (parfois appelé "araignée du jumeau") se cuit rapidement comme un steak. Goût marqué, texture juteuse.',
    cookingMethods: ['Poêle', 'Grill'],
    signatureDishes: ['Steak du boucher'],
  },

  // ─────────── Polyvalents ───────────
  'plat-de-cotes': {
    slug: 'plat-de-cotes',
    name: 'Plat de côtes',
    category: 'polyvalent',
    shortDescription:
      'Côtes basses, maigres et goûteuses. Pot-au-feu emblématique ou short ribs au barbecue.',
    description:
      "Le plat de côtes regroupe les côtes basses du bœuf. C'est le morceau roi du pot-au-feu et de la potée, mais il connaît une nouvelle jeunesse au barbecue américain sous le nom de \"short ribs\".",
    cookingMethods: ['Pot-au-feu', 'Braisé', 'Barbecue (long)'],
    signatureDishes: ['Pot-au-feu', 'Short ribs braisés'],
  },
  tendron: {
    slug: 'tendron',
    name: 'Tendron',
    category: 'polyvalent',
    shortDescription:
      'Cartilages fondants, viande gélatineuse. Mijotage long obligatoire.',
    description:
      'Pièce constituée des extrémités cartilagineuses des côtes. Riche en collagène, le tendron devient fondant après une cuisson lente. Peu connu mais excellent en blanquette ou en mijoté.',
    cookingMethods: ['Mijoté', 'Braisé', 'Pot-au-feu'],
    signatureDishes: ['Blanquette', 'Tendron de bœuf braisé'],
  },
  flanchet: {
    slug: 'flanchet',
    name: 'Flanchet',
    category: 'polyvalent',
    shortDescription:
      'Pièce du ventre. Bouilli, mijoté, ou en viande hachée de qualité.',
    description:
      'Le flanchet est une pièce maigre située sur le flanc du bœuf. Souvent utilisé pour le pot-au-feu, il fournit aussi du steak haché de très bonne qualité.',
    cookingMethods: ['Pot-au-feu', 'Bouilli', 'Steak haché'],
    signatureDishes: ['Pot-au-feu', 'Bœuf bouilli'],
  },
  'bavette-de-flanchet': {
    slug: 'bavette-de-flanchet',
    name: 'Bavette de flanchet',
    category: 'polyvalent',
    shortDescription:
      "Pièce à mijoter du flanc. À ne pas confondre avec la bavette d'aloyau.",
    description:
      "Contrairement à sa cousine la bavette d'aloyau (qui se grille), la bavette de flanchet est une pièce à mijotage. Riche en collagène, elle développe son goût en cuisson longue.",
    cookingMethods: ['Mijoté', 'Bouilli', 'Pot-au-feu'],
    signatureDishes: ['Bœuf bourguignon', 'Daube'],
  },
  tranche: {
    slug: 'tranche',
    name: 'Tranche',
    category: 'polyvalent',
    shortDescription:
      'Grande pièce de la cuisse arrière. Plat de tranche, rond de tranche, mouvant.',
    description:
      'Aussi appelée "tranche grasse", cette pièce regroupe trois muscles distincts de la cuisse arrière. En vente directe, elle se présente souvent en gros pavés à rôtir ou trancher en escalopes.',
    cookingMethods: ['Rôti', 'Braisé', 'Steak'],
    signatureDishes: ['Rôti de tranche', 'Escalopes', 'Carpaccio'],
  },

  // ─────────── À mijoter ───────────
  collier: {
    slug: 'collier',
    name: 'Collier',
    category: 'a-mijoter',
    shortDescription:
      'Muscle du cou. Mijotage long, bourguignon, daube. Très goûteux.',
    description:
      'Le collier est un muscle très sollicité du cou, riche en collagène. Après une cuisson longue, il devient extrêmement fondant et libère une saveur intense. Indispensable au bœuf bourguignon.',
    cookingMethods: ['Mijoté', 'Braisé', 'Pot-au-feu'],
    signatureDishes: ['Bœuf bourguignon', 'Daube provençale', 'Pot-au-feu'],
  },
  paleron: {
    slug: 'paleron',
    name: 'Paleron',
    category: 'a-mijoter',
    shortDescription:
      "Muscle de l'épaule. Le morceau roi du bœuf bourguignon.",
    description:
      "Pièce de l'épaule traversée par un nerf central qui fond à la cuisson. Le paleron est le morceau préféré pour le bourguignon : il devient fondant, juteux et plein de goût après plusieurs heures de mijotage.",
    cookingMethods: ['Mijoté', 'Braisé'],
    signatureDishes: ['Bœuf bourguignon', 'Bœuf carottes'],
  },
  macreuse: {
    slug: 'macreuse',
    name: 'Macreuse',
    category: 'a-mijoter',
    shortDescription:
      "Pièce de l'épaule à mijoter. Riche en collagène, devient fondante.",
    description:
      "La macreuse à pot-au-feu est un muscle de l'épaule riche en tissus conjonctifs. Cuisson longue obligatoire pour fondre le collagène. Excellente en pot-au-feu, daube, bourguignon.",
    cookingMethods: ['Pot-au-feu', 'Mijoté', 'Braisé'],
    signatureDishes: ['Pot-au-feu', 'Bourguignon', 'Daube'],
  },
  jumeau: {
    slug: 'jumeau',
    name: 'Jumeau',
    category: 'a-mijoter',
    shortDescription:
      "Muscle de l'épaule à mijoter. Goûteux, fondant après cuisson lente.",
    description:
      "Pièce d'épaule riche en collagène, le jumeau (sous-entendu \"à pot-au-feu\") fait merveille en cuisson longue. Souvent utilisé en complément du paleron dans les préparations mijotées.",
    cookingMethods: ['Mijoté', 'Pot-au-feu', 'Braisé'],
    signatureDishes: ['Bourguignon', 'Pot-au-feu'],
  },
  gite: {
    slug: 'gite',
    name: 'Gîte',
    category: 'a-mijoter',
    shortDescription:
      'Jarret avant. Le morceau du pot-au-feu par excellence, riche en gélatine.',
    description:
      "Le gîte est issu du jarret avant. Sa richesse en gélatine en fait l'ingrédient incontournable du pot-au-feu : il donne le corps et l'onctuosité au bouillon.",
    cookingMethods: ['Pot-au-feu', 'Bouilli', 'Osso buco'],
    signatureDishes: ['Pot-au-feu', 'Osso buco de bœuf'],
  },
  'gite-a-la-noix': {
    slug: 'gite-a-la-noix',
    name: 'Gîte à la noix',
    category: 'a-mijoter',
    shortDescription:
      'Pièce arrière dense. Idéal en daube, bouilli ou braisé.',
    description:
      'À ne pas confondre avec le gîte (jarret avant), le gîte à la noix est une pièce de la cuisse arrière. Dense et maigre, parfait en mijoté, daube, ou en bouilli pour le pot-au-feu.',
    cookingMethods: ['Mijoté', 'Braisé', 'Pot-au-feu'],
    signatureDishes: ['Daube', 'Bœuf mode'],
  },
  poitrine: {
    slug: 'poitrine',
    name: 'Poitrine',
    category: 'a-mijoter',
    shortDescription:
      'Pièce du poitrail. Pot-au-feu, brisket fumé, potées.',
    description:
      "La poitrine regroupe le gros bout et le milieu de poitrine. Riche en gras et en collagène, elle convient aux cuissons longues : pot-au-feu, potée, ou brisket fumé à l'américaine.",
    cookingMethods: ['Pot-au-feu', 'Fumé', 'Mijoté'],
    signatureDishes: ['Pot-au-feu', 'Brisket fumé'],
  },

  // ─────────── Abats / extrémités ───────────
  joue: {
    slug: 'joue',
    name: 'Joue',
    category: 'abat-extremite',
    shortDescription:
      'Muscle masticateur. Fondante après mijotage, devient tendance gastro.',
    description:
      "Très sollicitée par la mastication, la joue de bœuf est riche en collagène. Après plusieurs heures de cuisson, elle se transforme en une viande d'une tendreté exceptionnelle. Plébiscitée par les chefs.",
    cookingMethods: ['Mijoté', 'Braisé'],
    signatureDishes: ['Joue de bœuf braisée au vin rouge'],
  },
  langue: {
    slug: 'langue',
    name: 'Langue',
    category: 'abat-extremite',
    shortDescription:
      'Abat de tradition. Pochée puis sauce piquante ou madère.',
    description:
      "Abat tendre et fondant après cuisson. La langue se prépare classiquement pochée dans un bouillon, puis tranchée et nappée d'une sauce piquante ou madère.",
    cookingMethods: ['Pochée', 'Bouillie'],
    signatureDishes: ['Langue de bœuf sauce piquante'],
  },
  queue: {
    slug: 'queue',
    name: 'Queue',
    category: 'abat-extremite',
    shortDescription:
      'Riche en gélatine. Donne des bouillons et terrines exceptionnels.',
    description:
      'La queue de bœuf est extraordinairement riche en collagène. Mijotée des heures, elle donne des bouillons épais et des plats fondants. Star de la cuisine paysanne et de la haute gastronomie.',
    cookingMethods: ['Mijoté', 'Pot-au-feu', 'Bouillon'],
    signatureDishes: ['Queue de bœuf braisée', 'Pot-au-feu'],
  },
};

/**
 * BEEF_CUTS final : fusionne BEEF_CUTS_BASE avec les metadonnees image
 * generees par scripts/fetch-cut-images.ts. Pour les slugs sans image,
 * la valeur reste celle de BEEF_CUTS_BASE (sans imageUrl/Alt/Credit).
 */
export const BEEF_CUTS: Record<BeefCutSlug, BeefCut> = Object.fromEntries(
  (Object.entries(BEEF_CUTS_BASE) as [BeefCutSlug, BeefCut][]).map(
    ([slug, cut]) => {
      const image = CUT_IMAGES[slug];
      return [slug, image ? { ...cut, ...image } : cut];
    },
  ),
) as Record<BeefCutSlug, BeefCut>;

/**
 * Liste de tous les slugs valides — utile pour les routes [slug] et la validation.
 */
export const ALL_CUT_SLUGS: readonly BeefCutSlug[] = Object.keys(BEEF_CUTS) as BeefCutSlug[];

/**
 * Métadonnées par catégorie : couleur (fill du SVG), libellé, icône suggérée.
 * Le SVG embarque déjà ces couleurs en dur ; ces tokens servent côté React
 * pour les badges, légendes, filtres, etc.
 */
export const CATEGORY_META: Record<BeefCutCategory, {
  label: string;
  shortLabel: string;
  /** Couleur de fond utilisée dans le SVG (à synchroniser avec la palette terra) */
  fillColor: string;
  /** Variable CSS recommandée si le design system est branché */
  cssVariable: string;
  description: string;
}> = {
  noble: {
    label: 'Morceaux nobles',
    shortLabel: 'Nobles',
    fillColor: '#C08552',
    cssVariable: '--terra-400',
    description:
      "Pièces tendres à cuisson rapide. Le filet, le faux-filet, l'entrecôte… les classiques de la grillade.",
  },
  'piece-du-boucher': {
    label: 'Pièces du boucher',
    shortLabel: 'Pièces du boucher',
    fillColor: '#B8713E',
    cssVariable: '--terra-500',
    description:
      'Petits morceaux confidentiels, persillés, au goût intense. Onglet, hampe, araignée — les secrets des bouchers.',
  },
  polyvalent: {
    label: 'Polyvalents',
    shortLabel: 'Polyvalents',
    fillColor: '#8B4513',
    cssVariable: '--terra-600',
    description:
      'Pièces à plusieurs usages : grillade, pot-au-feu, haché. Plat de côtes, tendron, flanchet…',
  },
  'a-mijoter': {
    label: 'À mijoter',
    shortLabel: 'À mijoter',
    fillColor: '#A0522D',
    cssVariable: '--terra-700',
    description:
      'Pièces riches en collagène, fondantes après cuisson longue. Le terrain de jeu du bourguignon et du pot-au-feu.',
  },
  'abat-extremite': {
    label: 'Abats & extrémités',
    shortLabel: 'Abats',
    fillColor: '#804A20',
    cssVariable: '--terra-800',
    description:
      'Joue, langue, queue. Morceaux de tradition, redécouverts par la cuisine moderne.',
  },
};

/**
 * Helper : retourne les morceaux d'une catégorie donnée.
 */
export function getCutsByCategory(category: BeefCutCategory): BeefCut[] {
  return Object.values(BEEF_CUTS).filter((cut) => cut.category === category);
}

/**
 * Helper : retourne un morceau par son slug, ou null s'il n'existe pas.
 * Utile pour les routes dynamiques [slug] avec validation.
 */
export function getCutBySlug(slug: string): BeefCut | null {
  if (!(slug in BEEF_CUTS)) return null;
  return BEEF_CUTS[slug as BeefCutSlug];
}
