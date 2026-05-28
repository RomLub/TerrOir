// CircuitVisualizer V2 — données de la chaîne de valeur, reprises 1:1 de
// la maquette Claude Design `notre_demarche/circuit_visualizer_v2.html`.
//
// Sources : OFPM (FranceAgriMer) / Idele / CGAAER, données indicatives
// 2022-2024, moyennes filière bovine. Représentation simplifiée à visée
// pédagogique — la redistribution simulée côté GMS suit une logique
// pédagogique, pas un calcul de marché réel.

export type CircuitNodeRole = "source" | "intermediary" | "consumer" | "terroir";

export type CircuitIcon =
  | "cow"
  | "handshake"
  | "factory"
  | "knife"
  | "truck"
  | "box"
  | "store"
  | "user"
  | "leaf";

export type CircuitNode = {
  id: string;
  role: CircuitNodeRole;
  label: string;
  pct: number;
  icon: CircuitIcon;
  /** Tuples [source, valeur en %]. Affichés en tooltip + moyenne calculée. */
  sources?: ReadonlyArray<readonly [string, number]>;
};

type CircuitData = {
  gms: ReadonlyArray<CircuitNode>;
  terroir: ReadonlyArray<CircuitNode>;
};

export const CV_DATA: CircuitData = {
  gms: [
    {
      id: "eleveur",
      role: "source",
      label: "Éleveur",
      pct: 20,
      icon: "cow",
      sources: [
        ["OFPM 2024", 19],
        ["Idele 2023", 22],
        ["CGAAER 2022", 19],
      ],
    },
    {
      id: "negociant",
      role: "intermediary",
      label: "Négociant bétail",
      pct: 5,
      icon: "handshake",
      sources: [
        ["OFPM 2024", 5],
        ["Idele 2023", 6],
        ["CGAAER 2022", 4],
      ],
    },
    {
      id: "abattoir",
      role: "intermediary",
      label: "Abattoir",
      pct: 8,
      icon: "factory",
      sources: [
        ["OFPM 2024", 8],
        ["Idele 2023", 9],
        ["CGAAER 2022", 7],
      ],
    },
    {
      id: "decoupe",
      role: "intermediary",
      label: "Atelier découpe",
      pct: 15,
      icon: "knife",
      sources: [
        ["OFPM 2024", 14],
        ["Idele 2023", 16],
        ["CGAAER 2022", 15],
      ],
    },
    {
      id: "logistique",
      role: "intermediary",
      label: "Logistique",
      pct: 7,
      icon: "truck",
      sources: [
        ["OFPM 2024", 7],
        ["Idele 2023", 8],
        ["CGAAER 2022", 6],
      ],
    },
    {
      id: "centrale",
      role: "intermediary",
      label: "Centrale d'achat",
      pct: 12,
      icon: "box",
      sources: [
        ["OFPM 2024", 11],
        ["Idele 2023", 13],
        ["CGAAER 2022", 12],
      ],
    },
    {
      id: "magasin",
      role: "intermediary",
      label: "Magasin",
      pct: 33,
      icon: "store",
      sources: [
        ["OFPM 2024", 33],
        ["Idele 2023", 32],
        ["CGAAER 2022", 34],
      ],
    },
    {
      id: "consommateur",
      role: "consumer",
      label: "Consommateur",
      pct: 0,
      icon: "user",
    },
  ],
  terroir: [
    {
      id: "eleveur",
      role: "source",
      label: "Éleveur",
      pct: 75,
      icon: "cow",
      sources: [["TerrOir cible", 75]],
    },
    {
      id: "abattoir",
      role: "intermediary",
      label: "Abattoir",
      pct: 8,
      icon: "factory",
      sources: [["Idele 2023", 8]],
    },
    {
      id: "decoupe",
      role: "intermediary",
      label: "Atelier découpe",
      pct: 8,
      icon: "knife",
      sources: [["Idele 2023", 8]],
    },
    {
      id: "terroir",
      role: "terroir",
      label: "Commission TerrOir",
      pct: 9,
      icon: "leaf",
      sources: [["Modèle TerrOir", 9]],
    },
    {
      id: "consommateur",
      role: "consumer",
      label: "Consommateur",
      pct: 0,
      icon: "user",
    },
  ],
};
