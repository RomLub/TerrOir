// Référentiel des 96 départements de France métropolitaine + Corse (2A/2B).
//
// Positions hexgrid (col, row) approximatives — vue cartogramme schématique,
// pas une carte topographique. Le but est de visualiser la couverture
// nationale d'un coup d'œil sans dépendance à un dataset géo lourd
// (TopoJSON / GeoJSON).
//
// Convention grille :
//   col 0..13 (ouest → est)
//   row 0..10 (nord → sud)
//   En SVG, les rows paires sont décalées de 0.5 col (offset hex).
//
// Précision : la position relative des départements adjacents est fidèle au
// terrain (Nord ≈ haut, Bretagne ≈ gauche, PACA ≈ bas-droite, Corse ≈ extrême
// sud-est). Les écarts inter-départements ne sont pas à l'échelle. La région
// parisienne est dilatée pour éviter les superpositions.
//
// V2 envisageable : remplacer ce hexgrid par un vrai SVG France basé sur
// un GeoJSON IGN simplifié si la précision géo devient un besoin métier.

export interface FranceDept {
  code: string;
  name: string;
  col: number;
  row: number;
}

export const FRANCE_DEPARTEMENTS: FranceDept[] = [
  // Hauts-de-France + frontière nord
  { code: "59", name: "Nord", col: 8, row: 0 },
  { code: "62", name: "Pas-de-Calais", col: 7, row: 0 },
  { code: "80", name: "Somme", col: 7, row: 1 },
  { code: "60", name: "Oise", col: 7, row: 2 },
  { code: "02", name: "Aisne", col: 8, row: 1 },

  // Normandie
  { code: "76", name: "Seine-Maritime", col: 6, row: 1 },
  { code: "27", name: "Eure", col: 6, row: 2 },
  { code: "14", name: "Calvados", col: 5, row: 1 },
  { code: "50", name: "Manche", col: 4, row: 1 },
  { code: "61", name: "Orne", col: 5, row: 2 },

  // Île-de-France (cluster autour de Paris, étalé pour lisibilité)
  { code: "75", name: "Paris", col: 7, row: 3 },
  { code: "92", name: "Hauts-de-Seine", col: 6, row: 3 },
  { code: "93", name: "Seine-Saint-Denis", col: 8, row: 3 },
  { code: "94", name: "Val-de-Marne", col: 7, row: 4 },
  { code: "78", name: "Yvelines", col: 6, row: 4 },
  { code: "91", name: "Essonne", col: 7, row: 5 },
  { code: "95", name: "Val-d'Oise", col: 8, row: 4 },
  { code: "77", name: "Seine-et-Marne", col: 9, row: 3 },

  // Grand Est
  { code: "08", name: "Ardennes", col: 9, row: 1 },
  { code: "51", name: "Marne", col: 9, row: 2 },
  { code: "10", name: "Aube", col: 9, row: 4 },
  { code: "52", name: "Haute-Marne", col: 10, row: 3 },
  { code: "55", name: "Meuse", col: 10, row: 1 },
  { code: "54", name: "Meurthe-et-Moselle", col: 11, row: 1 },
  { code: "57", name: "Moselle", col: 12, row: 1 },
  { code: "67", name: "Bas-Rhin", col: 12, row: 2 },
  { code: "68", name: "Haut-Rhin", col: 12, row: 3 },
  { code: "88", name: "Vosges", col: 11, row: 2 },
  { code: "70", name: "Haute-Saône", col: 11, row: 3 },
  { code: "90", name: "Territoire de Belfort", col: 12, row: 4 },
  { code: "25", name: "Doubs", col: 11, row: 4 },

  // Centre-Val de Loire
  { code: "28", name: "Eure-et-Loir", col: 6, row: 5 },
  { code: "45", name: "Loiret", col: 7, row: 6 },
  { code: "41", name: "Loir-et-Cher", col: 6, row: 6 },
  { code: "37", name: "Indre-et-Loire", col: 5, row: 6 },
  { code: "36", name: "Indre", col: 6, row: 7 },
  { code: "18", name: "Cher", col: 7, row: 7 },

  // Bourgogne-Franche-Comté
  { code: "89", name: "Yonne", col: 8, row: 5 },
  { code: "21", name: "Côte-d'Or", col: 9, row: 5 },
  { code: "58", name: "Nièvre", col: 8, row: 6 },
  { code: "71", name: "Saône-et-Loire", col: 9, row: 6 },
  { code: "39", name: "Jura", col: 10, row: 5 },

  // Pays de la Loire
  { code: "53", name: "Mayenne", col: 4, row: 3 },
  { code: "72", name: "Sarthe", col: 5, row: 3 },
  { code: "44", name: "Loire-Atlantique", col: 3, row: 5 },
  { code: "49", name: "Maine-et-Loire", col: 4, row: 5 },
  { code: "85", name: "Vendée", col: 3, row: 6 },

  // Bretagne
  { code: "29", name: "Finistère", col: 1, row: 4 },
  { code: "22", name: "Côtes-d'Armor", col: 2, row: 3 },
  { code: "35", name: "Ille-et-Vilaine", col: 3, row: 3 },
  { code: "56", name: "Morbihan", col: 2, row: 4 },

  // Nouvelle-Aquitaine
  { code: "79", name: "Deux-Sèvres", col: 4, row: 6 },
  { code: "86", name: "Vienne", col: 5, row: 7 },
  { code: "17", name: "Charente-Maritime", col: 3, row: 7 },
  { code: "16", name: "Charente", col: 4, row: 7 },
  { code: "87", name: "Haute-Vienne", col: 5, row: 8 },
  { code: "23", name: "Creuse", col: 6, row: 8 },
  { code: "19", name: "Corrèze", col: 6, row: 9 },
  { code: "33", name: "Gironde", col: 3, row: 8 },
  { code: "24", name: "Dordogne", col: 4, row: 8 },
  { code: "47", name: "Lot-et-Garonne", col: 4, row: 9 },
  { code: "40", name: "Landes", col: 3, row: 9 },
  { code: "64", name: "Pyrénées-Atlantiques", col: 2, row: 10 },

  // Auvergne-Rhône-Alpes
  { code: "03", name: "Allier", col: 7, row: 8 },
  { code: "63", name: "Puy-de-Dôme", col: 7, row: 9 },
  { code: "15", name: "Cantal", col: 7, row: 10 },
  { code: "43", name: "Haute-Loire", col: 8, row: 9 },
  { code: "42", name: "Loire", col: 8, row: 8 },
  { code: "69", name: "Rhône", col: 9, row: 7 },
  { code: "01", name: "Ain", col: 10, row: 6 },
  { code: "74", name: "Haute-Savoie", col: 11, row: 5 },
  { code: "73", name: "Savoie", col: 11, row: 6 },
  { code: "38", name: "Isère", col: 10, row: 7 },
  { code: "26", name: "Drôme", col: 10, row: 8 },
  { code: "07", name: "Ardèche", col: 9, row: 8 },

  // Occitanie
  { code: "46", name: "Lot", col: 5, row: 9 },
  { code: "82", name: "Tarn-et-Garonne", col: 5, row: 10 },
  { code: "32", name: "Gers", col: 4, row: 10 },
  { code: "31", name: "Haute-Garonne", col: 5, row: 11 },
  { code: "65", name: "Hautes-Pyrénées", col: 3, row: 11 },
  { code: "09", name: "Ariège", col: 6, row: 11 },
  { code: "11", name: "Aude", col: 7, row: 11 },
  { code: "66", name: "Pyrénées-Orientales", col: 7, row: 12 },
  { code: "81", name: "Tarn", col: 6, row: 10 },
  { code: "12", name: "Aveyron", col: 4, row: 11 },
  { code: "30", name: "Gard", col: 8, row: 10 },
  { code: "34", name: "Hérault", col: 8, row: 11 },
  { code: "48", name: "Lozère", col: 9, row: 11 },

  // Provence-Alpes-Côte d'Azur
  { code: "84", name: "Vaucluse", col: 9, row: 9 },
  { code: "13", name: "Bouches-du-Rhône", col: 9, row: 10 },
  { code: "04", name: "Alpes-de-Haute-Provence", col: 11, row: 9 },
  { code: "05", name: "Hautes-Alpes", col: 11, row: 8 },
  { code: "06", name: "Alpes-Maritimes", col: 12, row: 9 },
  { code: "83", name: "Var", col: 11, row: 10 },

  // Corse
  { code: "2A", name: "Corse-du-Sud", col: 13, row: 12 },
  { code: "2B", name: "Haute-Corse", col: 13, row: 11 },
];

const DEPT_BY_CODE = new Map(FRANCE_DEPARTEMENTS.map((d) => [d.code, d]));

export function getDeptByCode(code: string): FranceDept | undefined {
  return DEPT_BY_CODE.get(code);
}

export function getDeptName(code: string): string {
  return DEPT_BY_CODE.get(code)?.name ?? code;
}

// Helper extraction code département depuis un code postal FR.
// Cas standards :
//   - 5 chiffres : 2 premiers (ex. 72100 → 72, 49000 → 49)
//   - Corse : codes postaux 200xx-201xx → 2A ; 202xx-206xx → 2B
//     (simplification INSEE : préfixe 200/201 = 2A, 202+ = 2B)
//   - DOM 97x/98x : renvoyés tels quels (3 char) — hors hexgrid métropole.
export function deptCodeFromCodePostal(
  cp: string | null | undefined,
): string | null {
  if (!cp) return null;
  const trimmed = cp.trim();
  if (trimmed.length < 2) return null;
  if (trimmed.startsWith("20")) {
    const prefix3 = trimmed.slice(0, 3);
    if (prefix3 === "200" || prefix3 === "201") return "2A";
    return "2B";
  }
  if (trimmed.startsWith("97") || trimmed.startsWith("98")) {
    return trimmed.slice(0, 3);
  }
  return trimmed.slice(0, 2);
}
