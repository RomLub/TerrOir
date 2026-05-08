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

/**
 * Familles V2 (Claude Design HANDOFF). Mapping 1:1 depuis BeefCutCategory
 * via CATEGORY_TO_FAMILY ci-dessous. Les couleurs des familles sont
 * exposees comme CSS vars (--cat-*) dans app/globals.css.
 */
export type BeefCutFamily =
  | 'nobles'
  | 'boucher'
  | 'polyvalent'
  | 'mijoter'
  | 'tradition';

/**
 * Detail d'un mode de cuisson recommande pour un morceau (V2).
 * Plus structure que cookingMethods (string[]), permet d'afficher les
 * cards "Cuissons" sur la page detail avec rating + duree.
 */
export type BeefCutCookingDetail = {
  id: string;
  /** Nom affiche du mode de cuisson (ex. "Grillade", "Plancha"). */
  label: string;
  /** Mode recommande (3 etoiles vs 2 etoiles dans l'UI). */
  recommended: boolean;
  /** Duree totale estimee en minutes. 0 pour cru (tartare, carpaccio). */
  durationMin: number;
  /** Instruction concrete, 1-2 phrases. */
  description: string;
};

/** Citation editorialisee de l'eleveur, optionnelle (post-it sur page detail). */
export type BeefCutCounsel = {
  quote: string;
  author: string;
  farm: string;
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

  // ── Champs V2 (Claude Design refonte 2026-05-08) ─────────────────
  /** Famille V2 derivee de category via CATEGORY_TO_FAMILY. */
  family?: BeefCutFamily;
  /** Lede court ~100 chars, affiche dans le panneau du listing. */
  shortLede?: string;
  /** Description editoriale longue (page detail), 2-4 paragraphes. */
  longDescription?: string;
  /** Liste structuree des modes de cuisson recommandes. */
  cookingDetails?: readonly BeefCutCookingDetail[];
  /** Quantite recommandee par personne, en grammes. */
  portionGrams?: number;
  /** Saison (ex. "Toute l'annee", "Automne et hiver"). */
  season?: string;
  /** Citation editorialisee d'un eleveur (post-it page detail). */
  butcherCounsel?: BeefCutCounsel;
};

/** Mapping 1:1 categorie V1 -> famille V2. */
export const CATEGORY_TO_FAMILY: Record<BeefCutCategory, BeefCutFamily> = {
  noble: 'nobles',
  'piece-du-boucher': 'boucher',
  polyvalent: 'polyvalent',
  'a-mijoter': 'mijoter',
  'abat-extremite': 'tradition',
};

/** Metadonnees par famille V2 (label + couleur + sous-label/zone anatomique). */
export const FAMILY_META: Record<
  BeefCutFamily,
  {
    label: string;
    /** CSS var consommable directement (ex. dans une `style={{ background: ... }}`). */
    cssVariable: string;
    /** Hex de fallback (utile pour serveur, JSON-LD, etc.). */
    fillColor: string;
  }
> = {
  nobles: {
    label: 'Morceaux nobles',
    cssVariable: 'var(--cat-nobles)',
    fillColor: '#B8713E',
  },
  boucher: {
    label: 'Pieces du boucher',
    cssVariable: 'var(--cat-boucher)',
    fillColor: '#A0522D',
  },
  polyvalent: {
    label: 'Polyvalents',
    cssVariable: 'var(--cat-polyvalent)',
    fillColor: '#D4A373',
  },
  mijoter: {
    label: 'A mijoter',
    cssVariable: 'var(--cat-mijoter)',
    fillColor: '#6B7C5C',
  },
  tradition: {
    label: 'Tradition',
    cssVariable: 'var(--cat-tradition)',
    fillColor: '#6B3620',
  },
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
 * Enrichissement V2 (Claude Design refonte 2026-05-08).
 * Ajoute pour chaque slug : shortLede, longDescription, cookingDetails,
 * portionGrams, season. Le butcherCounsel reste undefined : il sera
 * rempli au cas par cas lors de la collecte de citations producteurs.
 */
type BeefCutV2Enrichment = {
  shortLede: string;
  longDescription: string;
  cookingDetails: readonly BeefCutCookingDetail[];
  portionGrams: number;
  season: string;
};

const CUT_V2: Record<BeefCutSlug, BeefCutV2Enrichment> = {
  // ── NOBLES ─────────────────────────────────────────────
  filet: {
    shortLede:
      'Le morceau le plus tendre du boeuf. Parfait en tournedos ou rossini.',
    longDescription:
      "Piece maitresse de la longe, le filet est un muscle peu sollicite — d'ou sa tendrete legendaire. Maigre et fondant, sans persillage marque, il joue tout sur la cuisson : courte, precise, a feu vif pour saisir une croute fine sans assecher le coeur.\n\nAttendre une heure de remise a temperature ambiante avant cuisson, saisir 2 a 3 minutes par face dans un beurre noisette, finir au repos sous papier alu. La sonde doit indiquer 52 C pour un saignant ferme.",
    cookingDetails: [
      {
        id: 'poele',
        label: 'Poelee',
        recommended: true,
        durationMin: 8,
        description:
          'Beurre noisette, 2-3 min par face, repos 5 min sous papier alu. Sonde 52 C saignant.',
      },
      {
        id: 'tournedos',
        label: 'Tournedos',
        recommended: true,
        durationMin: 10,
        description:
          'Bardes de lard fume, ficeles, 4 min par face. Servir sur croutons aille.',
      },
      {
        id: 'rossini',
        label: 'Rossini',
        recommended: false,
        durationMin: 15,
        description:
          'Tournedos surmonte d\'une escalope de foie gras poelee, jus au madere.',
      },
    ],
    portionGrams: 180,
    season: "Toute l'annee",
  },
  'faux-filet': {
    shortLede:
      'Mache tendre, persillage modere. Piece signature du barbecue et de la poele.',
    longDescription:
      "Situe entre l'entrecote et le rumsteck, le faux-filet offre un compromis rare : tendrete d'un noble, gout marque grace a un persillage discret. Fibres fines, mache nette, sans surprise.\n\nCuisson preferee : grillade ou poele, saignant. Trancher a contresens des fibres pour ne pas le durcir. La barde de gras peripherique se croustille a la grille — gardez-la jusqu'a la fin de cuisson.",
    cookingDetails: [
      {
        id: 'grillade',
        label: 'Grillade',
        recommended: true,
        durationMin: 8,
        description:
          'Grille tres chaude, 3 min par face pour saignant, repos 5 min.',
      },
      {
        id: 'poele',
        label: 'Poelee',
        recommended: true,
        durationMin: 8,
        description:
          'Beurre noisette, 3 min par face, fleur de sel et poivre du moulin au dressage.',
      },
      {
        id: 'barbecue',
        label: 'Barbecue',
        recommended: false,
        durationMin: 10,
        description:
          'Braises chaudes, 3-4 min par face. Sonde 54 C pour saignant.',
      },
    ],
    portionGrams: 200,
    season: "Toute l'annee",
  },
  'cotes-entrecotes': {
    shortLede:
      'La meme piece vendue avec ou sans os. Tres persillee, genereuse en gout.',
    longDescription:
      "Coupee dans le train de cotes, cette piece iconique se vend en cote de boeuf (avec os) pour les grandes tablees, ou en entrecote (desossee) pour la cuisson rapide a la poele ou a la plancha.\n\nSon persillage prononce — ces fines veines de gras intramusculaire — donne sa mache caracteristique et son gout profond. Comptez deux a trois cotes par bete : c'est une piece relativement rare et recherchee.",
    cookingDetails: [
      {
        id: 'grillade',
        label: 'Grillade',
        recommended: true,
        durationMin: 12,
        description:
          'Grille tres chaude, 3 min par face puis 5 min de repos sous papier alu.',
      },
      {
        id: 'plancha',
        label: 'Plancha',
        recommended: true,
        durationMin: 10,
        description:
          'Plancha tres chaude, fleur de sel, 4 min par face. Caramelisation sans dessechement.',
      },
      {
        id: 'four',
        label: 'Four',
        recommended: false,
        durationMin: 25,
        description:
          'Saisie poele puis four 220 C, 8-10 min selon epaisseur. Sonde 52 C pour saignant.',
      },
    ],
    portionGrams: 300,
    season: "Toute l'annee",
  },
  rumsteck: {
    shortLede:
      'Piece maigre et tendre du quartier arriere. Parfaite en rosbif ou pave.',
    longDescription:
      "Issu de l'aloyau arriere, le rumsteck est l'une des pieces les plus polyvalentes du boeuf. Maigre, tendre, savoureux sans etre puissant, il s'adapte au steak grille comme au roti dominical, en passant par la fondue ou la brochette.\n\nDecoupe traditionnelle en pave de 200 g pour la grillade, ou en gros morceau de 1 kg pour le rosbif. Le tartare est aussi excellent — preferez-le hache au couteau plutot qu'au robot.",
    cookingDetails: [
      {
        id: 'roti',
        label: 'Roti',
        recommended: true,
        durationMin: 35,
        description:
          'Four 200 C, 18 min par 500 g, repos 10 min sous alu. Sonde 54 C pour saignant.',
      },
      {
        id: 'pave',
        label: 'Pave grille',
        recommended: true,
        durationMin: 8,
        description:
          'Pave 2 cm, grille tres chaude, 3 min par face, repos 4 min.',
      },
      {
        id: 'tartare',
        label: 'Tartare',
        recommended: false,
        durationMin: 0,
        description:
          'Hache au couteau, jaune d\'oeuf, capres, oignons rouges, Worcestershire.',
      },
    ],
    portionGrams: 180,
    season: "Toute l'annee",
  },
  'aiguillette-baronne': {
    shortLede:
      'Long muscle effile, tendre et savoureux. Souvent pique, roti a coeur.',
    longDescription:
      "Muscle long et fin niche entre rumsteck et tende de tranche, l'aiguillette baronne est une piece confidentielle d'une tendrete remarquable. Souvent reservee par les bouchers ou proposee a la commande.\n\nSe cuisine entiere : piquee de lard, rotie au four ou poele entiere puis tranchee fine. Aussi excellente en brochettes courtes pour preserver sa tendrete.",
    cookingDetails: [
      {
        id: 'roti',
        label: 'Roti',
        recommended: true,
        durationMin: 30,
        description:
          'Piquer de lard, four 200 C, 20-25 min selon poids. Repos 8 min.',
      },
      {
        id: 'poele',
        label: 'Poelee',
        recommended: true,
        durationMin: 12,
        description:
          'Saisir entiere a la poele, 4 min par face, finir 4 min a couvert.',
      },
      {
        id: 'brochette',
        label: 'Brochette',
        recommended: false,
        durationMin: 12,
        description: 'Cubes 3 cm, brochettes 3 min par face, marinade huile et thym.',
      },
    ],
    portionGrams: 180,
    season: "Toute l'annee",
  },
  'rond-de-gite': {
    shortLede:
      'Piece ronde du gite, maigre et fibreuse. Carpaccio, fondue, roti froid.',
    longDescription:
      "Muscle de la cuisse arriere, le rond de gite est tendre, maigre et fibreux. Selon la decoupe, il fait un rosbif soigne ou des steaks reguliers — il est aussi le morceau de choix pour le carpaccio (fines tranches crues) et la fondue bourguignonne.\n\nSa relative absence de gras le rend versatile mais demande de ne pas le surcuire : reste saignant ou a peine rose pour preserver sa texture.",
    cookingDetails: [
      {
        id: 'carpaccio',
        label: 'Carpaccio',
        recommended: true,
        durationMin: 0,
        description: 'Tres fines tranches crues, huile d\'olive, parmesan, copeaux et roquette.',
      },
      {
        id: 'fondue',
        label: 'Fondue',
        recommended: true,
        durationMin: 10,
        description: 'Cubes 2 cm, bouillon parfume ou huile chaude, sauces variees.',
      },
      {
        id: 'roti',
        label: 'Roti froid',
        recommended: false,
        durationMin: 30,
        description: 'Four 200 C, 18 min par 500 g, refroidir avant decoupe en fines tranches.',
      },
    ],
    portionGrams: 180,
    season: "Toute l'annee",
  },
  'basses-cotes': {
    shortLede:
      'Persillage genereux, mache affirmee. Le compromis ideal entre cote et entrecote.',
    longDescription:
      "Issues des cinq premieres cotes du train avant, les basses-cotes sont une viande persillee et goutue, plus economique que les cotes hautes mais avec un caractere proche. Coupees en pave epais, elles se grillent comme une entrecote ; detaillees en morceaux, elles deviennent fondantes apres une cuisson lente.\n\nLeur position anatomique entre l'epaule et le train de cotes leur donne ce profil hybride — on hesite parfois sur le mode de cuisson, et c'est tant mieux : les deux fonctionnent.",
    cookingDetails: [
      {
        id: 'grillade',
        label: 'Grillade',
        recommended: true,
        durationMin: 10,
        description: 'Pave 2 cm, grille tres chaude, 4 min par face, repos 5 min.',
      },
      {
        id: 'plancha',
        label: 'Plancha',
        recommended: true,
        durationMin: 10,
        description: 'Plancha tres chaude, fleur de sel, 4 min par face.',
      },
      {
        id: 'braise',
        label: 'Braise',
        recommended: false,
        durationMin: 180,
        description: 'Saisir puis braiser 3h dans bouillon avec carottes et oignons.',
      },
    ],
    portionGrams: 200,
    season: "Toute l'annee",
  },

  // ── PIECES DU BOUCHER ──────────────────────────────────
  onglet: {
    shortLede:
      'Muscle du diaphragme, fibres marquees, gout intense. A griller saignant.',
    longDescription:
      "L'onglet est l'un des morceaux preferes des bouchers : peu connu du grand public, il porte un gout puissant presque ferreux et une texture unique quand il est cuit saignant. Indispensable de le trancher contre le grain pour ne pas le rendre coriace.\n\nDeux pieces seulement par bete — et le boucher en garde souvent une pour lui.",
    cookingDetails: [
      {
        id: 'poele',
        label: 'Poelee',
        recommended: true,
        durationMin: 8,
        description: 'Beurre tres chaud, 2 min par face, echalotes deglacees au vinaigre.',
      },
      {
        id: 'grillade',
        label: 'Grillade',
        recommended: true,
        durationMin: 8,
        description: 'Grille tres chaude, 2-3 min par face, fleur de sel.',
      },
    ],
    portionGrams: 180,
    season: "Toute l'annee",
  },
  hampe: {
    shortLede:
      "Cousine de l'onglet, fibres longues et gout intense. Cuite saignante.",
    longDescription:
      "Comme l'onglet, la hampe vient du diaphragme — mais ses fibres sont plus longues et son gout encore plus marque. Doit absolument etre cuite saignante et tranchee fine contre le grain ; sinon elle durcit.\n\nGrande favorite des bistrots parisiens, souvent servie avec une persillade ou des echalotes.",
    cookingDetails: [
      {
        id: 'poele',
        label: 'Poelee',
        recommended: true,
        durationMin: 7,
        description: 'Beurre tres chaud, 2 min par face, echalotes confites.',
      },
      {
        id: 'grillade',
        label: 'Grillade',
        recommended: true,
        durationMin: 7,
        description: 'Grille tres chaude, 2 min par face, persillade au dressage.',
      },
    ],
    portionGrams: 180,
    season: "Toute l'annee",
  },
  araignee: {
    shortLede:
      'Petit muscle rare et persille. Le secret des bouchers.',
    longDescription:
      "Niche contre le bassin, l'araignee tire son nom de sa structure de fibres en toile. Tres persillee, ultra-savoureuse, c'est une piece confidentielle souvent gardee par les bouchers. Ne se cuit qu'a la grillade ou a la poele, saignante.\n\nUne seule araignee par bete — il faut connaitre son boucher pour en obtenir.",
    cookingDetails: [
      {
        id: 'poele',
        label: 'Poelee',
        recommended: true,
        durationMin: 6,
        description: 'Beurre tres chaud, 2 min par face. Trancher fin contre le grain.',
      },
      {
        id: 'grillade',
        label: 'Grillade',
        recommended: true,
        durationMin: 6,
        description: 'Grille tres chaude, 2 min par face, fleur de sel.',
      },
    ],
    portionGrams: 180,
    season: "Toute l'annee",
  },
  'poire-merlan': {
    shortLede:
      'Deux petits muscles tendres de la cuisse. Pieces du boucher recherchees.',
    longDescription:
      "La poire et le merlan sont deux petits muscles de la cuisse arriere, particulierement tendres et fondants. Comme l'araignee, ce sont des morceaux dits du boucher, peu nombreux par carcasse.\n\nLa poire fait un steak rond, le merlan une longue tranche fine. Les deux se prefer saignants, en grillade ou poele.",
    cookingDetails: [
      {
        id: 'poele',
        label: 'Poelee',
        recommended: true,
        durationMin: 8,
        description: 'Beurre noisette, 3 min par face, fleur de sel.',
      },
      {
        id: 'grillade',
        label: 'Grillade',
        recommended: true,
        durationMin: 8,
        description: 'Grille tres chaude, 3 min par face, repos 4 min.',
      },
    ],
    portionGrams: 180,
    season: "Toute l'annee",
  },
  'bavette-d-aloyau': {
    shortLede:
      'La plus prisee des bavettes. Tendre, saignante, echalotes obligatoires.',
    longDescription:
      "Situee sous le filet, la bavette d'aloyau a des fibres longues et apparentes. Saveur intense, texture caracteristique. Indispensable saignante : sinon elle durcit. Coupee a contresens des fibres au moment du dressage.\n\nLa garniture canonique reste les echalotes confites au vinaigre rouge.",
    cookingDetails: [
      {
        id: 'poele',
        label: 'Poelee',
        recommended: true,
        durationMin: 7,
        description: 'Beurre tres chaud, 2 min par face, echalotes deglacees au vinaigre.',
      },
      {
        id: 'grillade',
        label: 'Grillade',
        recommended: true,
        durationMin: 7,
        description: 'Grille tres chaude, 2-3 min par face, fleur de sel.',
      },
    ],
    portionGrams: 180,
    season: "Toute l'annee",
  },
  'macreuse-a-bifteck': {
    shortLede:
      'Partie tendre de la macreuse, isolee pour la grillade.',
    longDescription:
      "Quand le boucher separe le muscle de l'epaule, la partie la plus tendre devient la macreuse a bifteck — un steak savoureux et abordable. Texture juteuse, gout marque, sans le persillage du faux-filet mais avec un caractere propre.\n\nGrille ou poele, saignante de preference. Egalement excellente en steak hache de qualite (a faire passer une seule fois au hachoir).",
    cookingDetails: [
      {
        id: 'poele',
        label: 'Poelee',
        recommended: true,
        durationMin: 8,
        description: 'Beurre noisette, 3 min par face, repos 4 min.',
      },
      {
        id: 'grillade',
        label: 'Grillade',
        recommended: true,
        durationMin: 8,
        description: 'Grille tres chaude, 3 min par face, fleur de sel.',
      },
    ],
    portionGrams: 180,
    season: "Toute l'annee",
  },
  'jumeau-a-bifteck': {
    shortLede:
      'Partie tendre du jumeau de l\'epaule, a griller comme un steak.',
    longDescription:
      "Petit muscle annexe du jumeau, le jumeau a bifteck (parfois appele araignee du jumeau) se cuit rapidement comme un steak. Gout marque, texture juteuse. Reserve aux clients qui le demandent — le boucher le met de cote.\n\nGrille ou poele, saignant.",
    cookingDetails: [
      {
        id: 'poele',
        label: 'Poelee',
        recommended: true,
        durationMin: 7,
        description: 'Beurre noisette, 3 min par face.',
      },
      {
        id: 'grillade',
        label: 'Grillade',
        recommended: true,
        durationMin: 7,
        description: 'Grille tres chaude, 3 min par face.',
      },
    ],
    portionGrams: 180,
    season: "Toute l'annee",
  },

  // ── POLYVALENTS ────────────────────────────────────────
  'plat-de-cotes': {
    shortLede:
      'Cotes basses, maigres et goutues. Pot-au-feu emblematique ou short ribs.',
    longDescription:
      "Le plat de cotes regroupe les cotes basses du boeuf. C'est le morceau roi du pot-au-feu et de la potee, mais il connait une nouvelle jeunesse au barbecue americain sous le nom de short ribs.\n\nMode classique : pot-au-feu de 4 heures, le bouillon prend toute sa dimension. Mode contemporain : marinade BBQ, fumage 6h a basse temperature, glacage final.",
    cookingDetails: [
      {
        id: 'pot-au-feu',
        label: 'Pot-au-feu',
        recommended: true,
        durationMin: 240,
        description: 'Bouillon, legumes anciens, mijotage 4h a fremir. Saler en debut.',
      },
      {
        id: 'braise',
        label: 'Braise',
        recommended: true,
        durationMin: 180,
        description: 'Saisir puis braiser 3h, fond mouille a mi-hauteur.',
      },
      {
        id: 'barbecue',
        label: 'Barbecue (long)',
        recommended: false,
        durationMin: 360,
        description: 'Marinade BBQ, fumage 6h a 110 C, glacage final.',
      },
    ],
    portionGrams: 300,
    season: "Toute l'annee",
  },
  tendron: {
    shortLede:
      'Cartilages fondants, viande gelatineuse. Mijotage long obligatoire.',
    longDescription:
      "Piece constituee des extremites cartilagineuses des cotes. Riche en collagene, le tendron devient fondant apres une cuisson lente. Peu connu mais excellent en blanquette ou mijote a l'asiatique.\n\nNe pas le cuire trop fort : c'est le temps qui fait le tendron, pas la chaleur.",
    cookingDetails: [
      {
        id: 'mijote',
        label: 'Mijote',
        recommended: true,
        durationMin: 180,
        description: 'Mijotage doux 3h dans bouillon clair ou jus de tomate.',
      },
      {
        id: 'braise',
        label: 'Braise',
        recommended: true,
        durationMin: 180,
        description: 'Saisir puis braiser 3h, fond mouille a mi-hauteur.',
      },
    ],
    portionGrams: 280,
    season: "Toute l'annee",
  },
  flanchet: {
    shortLede:
      'Piece du ventre. Bouilli, mijote, ou en viande hachee de qualite.',
    longDescription:
      "Le flanchet est une piece maigre situee sur le flanc du boeuf. Souvent utilise pour le pot-au-feu, il fournit aussi du steak hache de tres bonne qualite (passer une seule fois au hachoir, ne jamais broyer).\n\nGouteux mais nerveux : la cuisson longue lui convient mieux que la grillade.",
    cookingDetails: [
      {
        id: 'pot-au-feu',
        label: 'Pot-au-feu',
        recommended: true,
        durationMin: 240,
        description: 'Bouillon clair, mijotage 4h a fremir, gros sel et bouquet garni.',
      },
      {
        id: 'bouilli',
        label: 'Bouilli',
        recommended: true,
        durationMin: 180,
        description: 'Bouillon parfume, mijotage 3h, sel en debut.',
      },
    ],
    portionGrams: 300,
    season: "Toute l'annee",
  },
  'bavette-de-flanchet': {
    shortLede:
      'Piece a mijoter du flanc. A ne pas confondre avec la bavette d\'aloyau.',
    longDescription:
      "Contrairement a sa cousine la bavette d'aloyau (qui se grille), la bavette de flanchet est une piece a mijotage. Riche en collagene, elle developpe son gout en cuisson longue.\n\nIdeale en bourguignon ou en daube — rivalise avec le paleron en concentration de saveur apres 3 heures de feu doux.",
    cookingDetails: [
      {
        id: 'bourguignon',
        label: 'Bourguignon',
        recommended: true,
        durationMin: 180,
        description: 'Marinade vin rouge, mijotage 3h avec lardons et oignons grelots.',
      },
      {
        id: 'daube',
        label: 'Daube',
        recommended: true,
        durationMin: 180,
        description: 'Marinade vin rouge, mijotage 3h, herbes de Provence.',
      },
    ],
    portionGrams: 280,
    season: "Toute l'annee",
  },
  tranche: {
    shortLede:
      'Grande piece de la cuisse arriere. Roti, escalope, carpaccio.',
    longDescription:
      "Aussi appelee tranche grasse, cette piece regroupe trois muscles distincts de la cuisse arriere. En vente directe, elle se presente souvent en gros paves a rotir ou trancher en escalopes. Polyvalente : steak, escalope, roti maigre, paupiette.\n\nFibre nette, peu de gras, gout franc.",
    cookingDetails: [
      {
        id: 'roti',
        label: 'Roti',
        recommended: true,
        durationMin: 35,
        description: 'Four 200 C, 18 min par 500 g. Repos 10 min sous alu.',
      },
      {
        id: 'escalope',
        label: 'Escalope',
        recommended: true,
        durationMin: 6,
        description: 'Tranches fines, beurre noisette, 1 min par face.',
      },
      {
        id: 'grillade',
        label: 'Grillade',
        recommended: false,
        durationMin: 8,
        description: 'Pave 2 cm, grille tres chaude, 3 min par face.',
      },
    ],
    portionGrams: 180,
    season: "Toute l'annee",
  },

  // ── A MIJOTER ─────────────────────────────────────────
  collier: {
    shortLede:
      'Persille, genereux. La piece du pot-au-feu et du bourguignon.',
    longDescription:
      "Le collier est un muscle tres sollicite du cou, riche en collagene. Apres une cuisson longue, il devient extremement fondant et libere une saveur intense. Indispensable au boeuf bourguignon.\n\nSouvent associe au paleron pour multiplier les textures dans une meme cocotte.",
    cookingDetails: [
      {
        id: 'bourguignon',
        label: 'Bourguignon',
        recommended: true,
        durationMin: 180,
        description: 'Marinade vin rouge, mijotage 3h avec lardons et oignons grelots.',
      },
      {
        id: 'pot-au-feu',
        label: 'Pot-au-feu',
        recommended: true,
        durationMin: 240,
        description: 'Bouillon, legumes anciens, mijotage 4h. Le morceau qui parfume le bouillon.',
      },
      {
        id: 'daube',
        label: 'Daube',
        recommended: false,
        durationMin: 180,
        description: 'Marinade vin rouge, mijotage 3h, herbes de Provence et zeste d\'orange.',
      },
    ],
    portionGrams: 250,
    season: "Toute l'annee",
  },
  paleron: {
    shortLede:
      "Piece de l'epaule traversee d'un nerf central. Devient confit apres 3h.",
    longDescription:
      "Piece de l'epaule traversee par un nerf central qui fond a la cuisson. Le paleron est le morceau prefere pour le bourguignon : il devient fondant, juteux et plein de gout apres plusieurs heures de mijotage.\n\nLe nerf central, gelatineux apres cuisson, donne la signature texturelle du paleron : on sent qu'on n'est pas sur du steak.",
    cookingDetails: [
      {
        id: 'bourguignon',
        label: 'Bourguignon',
        recommended: true,
        durationMin: 180,
        description: 'Marinade vin rouge, mijotage 3h avec lardons et oignons grelots.',
      },
      {
        id: 'daube',
        label: 'Daube',
        recommended: true,
        durationMin: 180,
        description: 'Marinade vin rouge, mijotage 3h, herbes de Provence.',
      },
      {
        id: 'carbonnade',
        label: 'Carbonnade',
        recommended: false,
        durationMin: 180,
        description: 'Biere brune, oignons, vergeoise, pain d\'epices, mijotage 3h.',
      },
    ],
    portionGrams: 220,
    season: "Toute l'annee",
  },
  macreuse: {
    shortLede:
      "Piece de l'epaule a mijoter. Riche en collagene, devient fondante.",
    longDescription:
      "La macreuse a pot-au-feu est un muscle de l'epaule riche en tissus conjonctifs. Cuisson longue obligatoire pour fondre le collagene. Excellente en pot-au-feu, daube, bourguignon.\n\nA distinguer de la macreuse a bifteck (la partie tendre isolee par le boucher) : ici c'est la piece longue cuisson.",
    cookingDetails: [
      {
        id: 'pot-au-feu',
        label: 'Pot-au-feu',
        recommended: true,
        durationMin: 240,
        description: 'Bouillon, legumes anciens, mijotage 4h a fremir.',
      },
      {
        id: 'bourguignon',
        label: 'Bourguignon',
        recommended: true,
        durationMin: 180,
        description: 'Marinade vin rouge, mijotage 3h avec lardons.',
      },
      {
        id: 'daube',
        label: 'Daube',
        recommended: false,
        durationMin: 180,
        description: 'Mijotage 3h, vin rouge, herbes de Provence.',
      },
    ],
    portionGrams: 250,
    season: "Toute l'annee",
  },
  jumeau: {
    shortLede:
      "Muscle de l'epaule a mijoter. Gouteux, fondant apres cuisson lente.",
    longDescription:
      "Piece d'epaule riche en collagene, le jumeau (sous-entendu a pot-au-feu) fait merveille en cuisson longue. Souvent utilise en complement du paleron dans les preparations mijotees pour multiplier les textures.\n\nA ne pas confondre avec le jumeau a bifteck — c'est ici la version longue cuisson.",
    cookingDetails: [
      {
        id: 'bourguignon',
        label: 'Bourguignon',
        recommended: true,
        durationMin: 180,
        description: 'Marinade vin rouge, mijotage 3h avec lardons et carottes.',
      },
      {
        id: 'pot-au-feu',
        label: 'Pot-au-feu',
        recommended: true,
        durationMin: 240,
        description: 'Bouillon clair, mijotage 4h a fremir.',
      },
    ],
    portionGrams: 250,
    season: "Toute l'annee",
  },
  gite: {
    shortLede:
      'Jarret avant. Le pot-au-feu par excellence, riche en gelatine.',
    longDescription:
      "Le gite est issu du jarret avant. Sa richesse en gelatine en fait l'ingredient incontournable du pot-au-feu : il donne le corps et l'onctuosite au bouillon.\n\nAussi excellent en osso buco a la francaise — coupe en troncons, l'os a moelle reste central.",
    cookingDetails: [
      {
        id: 'pot-au-feu',
        label: 'Pot-au-feu',
        recommended: true,
        durationMin: 240,
        description: 'Bouillon, legumes anciens, mijotage 4h a fremir.',
      },
      {
        id: 'osso-buco',
        label: 'Osso buco',
        recommended: true,
        durationMin: 150,
        description: 'Troncons avec os, mijotage 2h30 vin blanc et tomate.',
      },
      {
        id: 'bouilli',
        label: 'Bouilli',
        recommended: false,
        durationMin: 180,
        description: 'Bouillon parfume, mijotage 3h.',
      },
    ],
    portionGrams: 300,
    season: "Toute l'annee",
  },
  'gite-a-la-noix': {
    shortLede:
      'Piece arriere dense. Idealement en daube, bouilli ou braise.',
    longDescription:
      "A ne pas confondre avec le gite (jarret avant), le gite a la noix est une piece de la cuisse arriere. Dense et maigre, parfait en mijote, daube, ou en bouilli pour le pot-au-feu.\n\nSouvent decoupe en gros morceau pour le boeuf mode (carottes, oignons, vin blanc, mijotage long).",
    cookingDetails: [
      {
        id: 'daube',
        label: 'Daube',
        recommended: true,
        durationMin: 180,
        description: 'Mijotage 3h vin rouge, herbes de Provence, zeste d\'orange.',
      },
      {
        id: 'boeuf-mode',
        label: 'Boeuf mode',
        recommended: true,
        durationMin: 240,
        description: 'Carottes, oignons, vin blanc, mijotage 4h a feu doux.',
      },
      {
        id: 'pot-au-feu',
        label: 'Pot-au-feu',
        recommended: false,
        durationMin: 240,
        description: 'Bouillon clair, mijotage 4h.',
      },
    ],
    portionGrams: 250,
    season: "Toute l'annee",
  },
  poitrine: {
    shortLede:
      'Piece du poitrail. Pot-au-feu, brisket fume, potees.',
    longDescription:
      "La poitrine regroupe le gros bout et le milieu de poitrine. Riche en gras et en collagene, elle convient aux cuissons longues : pot-au-feu, potee, ou brisket fume a l'americaine.\n\nLe brisket fume 12 a 14 heures a basse temperature est un classique du barbecue texan : la poitrine sarthoise s'y prete parfaitement.",
    cookingDetails: [
      {
        id: 'pot-au-feu',
        label: 'Pot-au-feu',
        recommended: true,
        durationMin: 240,
        description: 'Bouillon, legumes anciens, mijotage 4h.',
      },
      {
        id: 'fume',
        label: 'Fume',
        recommended: true,
        durationMin: 720,
        description: 'Brisket : marinade seche, fumage 12h a 110 C, repos 1h.',
      },
      {
        id: 'mijote',
        label: 'Mijote',
        recommended: false,
        durationMin: 180,
        description: 'Salaison ou marinade, mijotage 3h.',
      },
    ],
    portionGrams: 280,
    season: "Toute l'annee",
  },

  // ── TRADITION (abats / extremites) ────────────────────
  joue: {
    shortLede:
      'Muscle masticateur, gelatineux et fondant apres cuisson lente.',
    longDescription:
      "Tres sollicitee par la mastication, la joue de boeuf est riche en collagene. Apres plusieurs heures de cuisson, elle se transforme en une viande d'une tendrete exceptionnelle. Plebiscitee par les chefs.\n\nLe braisage au vin rouge est la preparation canonique : la chair se detache a la fourchette, le jus est siruepux.",
    cookingDetails: [
      {
        id: 'braise',
        label: 'Braise',
        recommended: true,
        durationMin: 240,
        description: 'Marinade vin rouge 12h, braisage 4h, jus reduit.',
      },
      {
        id: 'mijote',
        label: 'Mijote',
        recommended: true,
        durationMin: 180,
        description: 'Mijotage 3h, vin rouge, carottes, oignons.',
      },
    ],
    portionGrams: 200,
    season: "Toute l'annee",
  },
  langue: {
    shortLede:
      'Preparation traditionnelle, texture moelleuse, ideale en sauce piquante.',
    longDescription:
      "Abat tendre et fondant apres cuisson. La langue se prepare classiquement pochee dans un bouillon, puis tranchee et nappee d'une sauce piquante (capres, cornichons, moutarde) ou d'un madere.\n\nUne preparation longue mais sans technique : 3 heures de pochage suffisent.",
    cookingDetails: [
      {
        id: 'pochee',
        label: 'Pochee',
        recommended: true,
        durationMin: 180,
        description: 'Bouillon parfume, mijotage 3h a fremir, retirer la peau a chaud.',
      },
      {
        id: 'sauce-piquante',
        label: 'Sauce piquante',
        recommended: true,
        durationMin: 30,
        description: 'Apres pochage : sauce capres, cornichons, moutarde, vinaigre.',
      },
    ],
    portionGrams: 200,
    season: "Toute l'annee",
  },
  queue: {
    shortLede:
      'Os a moelle, chair gelatineuse. Pot-au-feu de luxe ou hochepot.',
    longDescription:
      "La queue de boeuf est extraordinairement riche en collagene. Mijotee des heures, elle donne des bouillons epais et des plats fondants. Star de la cuisine paysanne et de la haute gastronomie.\n\nLes troncons se vendent par le boucher : compter 2 ou 3 troncons par personne pour un plat principal.",
    cookingDetails: [
      {
        id: 'mijote',
        label: 'Mijote',
        recommended: true,
        durationMin: 240,
        description: 'Troncons, mijotage 4h vin rouge, carottes, oignons.',
      },
      {
        id: 'pot-au-feu',
        label: 'Pot-au-feu',
        recommended: true,
        durationMin: 240,
        description: 'Bouillon clair, mijotage 4h. Bouillon riche en collagene.',
      },
      {
        id: 'hochepot',
        label: 'Hochepot',
        recommended: false,
        durationMin: 180,
        description: 'Pot-au-feu nordique, biere brune et legumes-racines.',
      },
    ],
    portionGrams: 300,
    season: "Toute l'annee",
  },
};

/**
 * BEEF_CUTS final : merge de BEEF_CUTS_BASE + family (depuis category)
 * + enrichissement V2 (CUT_V2). Les 29 entrees ont desormais
 * shortLede + longDescription + cookingDetails + portionGrams + season.
 */
export const BEEF_CUTS: Record<BeefCutSlug, BeefCut> = Object.fromEntries(
  (Object.entries(BEEF_CUTS_BASE) as [BeefCutSlug, BeefCut][]).map(
    ([slug, cut]) => {
      const v2 = CUT_V2[slug];
      const family = CATEGORY_TO_FAMILY[cut.category];
      return [slug, { ...cut, family, ...v2 }];
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
