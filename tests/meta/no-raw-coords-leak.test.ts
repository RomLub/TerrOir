// =============================================================================
// T-238 — Scan meta : pas de fuite de coordonnées producteur brutes
// =============================================================================
// Ce test scanne le code source (routes API, Server Components publics et
// consumer, libs partagées) à la recherche de tout site qui lit des
// `latitude` / `longitude` producteur depuis la DB SANS les passer par
// `roundCoord` AVANT exposition côté client.
//
// Contexte (cf. lib/producers/coords.ts § "Modèle de menace") : la lat/lng
// brute (6+ décimales) trahit l'adresse personnelle du producteur (élevage
// fermier). On floute systématiquement à 2 décimales (~1.1 km) avant toute
// sérialisation vers un client. Le helper canonical est `roundCoord`.
//
// Approche du scan : ciblé sur les SURFACES DE LECTURE DB (defense in depth
// CODE-LEVEL), complémentaire à la défense DB-LEVEL prévue par T-235 (vue
// `producers_public` qui ne projette pas la précision native).
//
// Patterns détectés :
//   A) `.select("...latitude...")` ou `.select("...longitude...")` —
//      colonnes coords lues explicitement.
//   B) `.rpc("<name>", ...)` où <name> est une RPC connue retournant des
//      coords producteur. Liste à maintenir manuellement (RPC search_producers
//      pour le moment ; étendre quand de nouvelles RPC sortent des coords).
//
// Pour chaque fichier matchant A ou B → le fichier DOIT :
//   - soit appeler `roundCoord(` au moins une fois,
//   - soit porter un commentaire `// PRIVACY: opt-out: <raison>` documenté
//     (ex. coords commune publiques, pas adresse perso).
//
// Whitelist : `app/(admin)/**` — l'admin a un besoin légitime des coords
// natives (ex. recherche d'un producer par adresse précise, audit qualité
// du géocodage). Ces fichiers sont exclus du scan.
//
// Ce que le scan NE détecte PAS (sortie de scope T-238 — voir T-235) :
//   - Une fuite côté DB (la vue `producers_public` projetant des coords
//     natives). T-235 cadre la defense in depth DB-level complémentaire.
//   - Les RPC nouvelles non whitelistées qui exposeraient des coords. À
//     ajouter à `KNOWN_COORD_RPCS` au fil de l'eau.
//   - Les Server Components qui consomment des props déjà sanitisés en
//     amont (faux-positif si on regardait juste la chaîne "latitude").
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Racine du repo (tests/meta/this.test.ts → ../..)
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Zones à scanner (chemins relatifs au repo root). On reste sur les zones
// d'EXPOSITION client : routes API publiques, Server Components publics et
// consumer authentifié, libs partagées (lib/**). Les Server Actions sont
// dans app/**, donc déjà couvertes par le scan.
const SCAN_ROOTS: readonly string[] = [
  "app/api",
  "app/(public)",
  "app/(consumer)",
  "app/(producer)",
  "lib",
];

// Whitelist par chemin (préfixe). Le `app/(admin)` zone est en dehors des
// SCAN_ROOTS donc déjà exclue, mais on garde la liste explicite ici pour
// documenter les futures additions.
const WHITELIST_PREFIXES: readonly string[] = [
  // Le helper roundCoord lui-même : il manipule la valeur brute par
  // construction. Cohérent avec la doc canonique en tête du fichier.
  "lib/producers/coords.ts",
  // Helpers Haversine / géocodage CP : opèrent sur des coords mais ne
  // lisent jamais les coords producteur depuis la DB.
  "lib/geo/",
  // Recompute badges côté serveur : si un jour il lit des coords pour un
  // calcul interne (cf. score carbone), ce sera côté serveur sans
  // exposition client. Whitelist préventive.
  "lib/producers/recompute-badges.ts",
  // Storage adapters et migration session-storage : aucune lecture DB.
  "lib/storage/",
];

// RPC qui retournent des coords producteur (liste à maintenir au fil des
// chantiers). Toute RPC ajoutée ici DOIT obliger ses call sites à appliquer
// `roundCoord` ou opt-out documenté.
const KNOWN_COORD_RPCS: readonly string[] = ["search_producers"];

// Pattern A : `.select(` suivi (dans les ~300 chars) d'un identifiant
// `latitude` ou `longitude` côté DB. Le `[\s\S]` autorise les retours
// chariot (les chaînes select() multilignes sont fréquentes en pratique).
const SELECT_COORD_RE =
  /\.select\([\s\S]{0,300}?\b(latitude|longitude)\b/;

// Pattern B : `.rpc("<name>"` où name est listée KNOWN_COORD_RPCS.
function rpcCoordRegex(rpcName: string): RegExp {
  // Échappement minimal : les noms de RPC sont alphanumériques + _.
  const safe = rpcName.replace(/[^A-Za-z0-9_]/g, "");
  return new RegExp(`\\.rpc\\(\\s*["']${safe}["']`);
}

// Marqueurs d'opt-out documenté.
const OPT_OUT_RE = /\/\/\s*PRIVACY:\s*opt-out:/i;

// Marqueur de défense applicative (le helper canonique).
const ROUND_COORD_RE = /\broundCoord\s*\(/;

// Énumération récursive des fichiers .ts/.tsx sous une racine. fs.readdirSync
// tolère les chemins inexistants (skipping silently) — utile en cas de
// renommage en cours de session.
function walkSourceFiles(absRoot: string): string[] {
  if (!fs.existsSync(absRoot)) return [];
  const out: string[] = [];
  const stack: string[] = [absRoot];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules / .next / fixtures internes des tests.
        if (
          entry.name === "node_modules" ||
          entry.name === ".next" ||
          entry.name === "__fixtures__"
        ) {
          continue;
        }
        stack.push(full);
      } else if (entry.isFile()) {
        if (
          entry.name.endsWith(".ts") ||
          entry.name.endsWith(".tsx")
        ) {
          out.push(full);
        }
      }
    }
  }
  return out;
}

function relPath(absPath: string): string {
  return path
    .relative(REPO_ROOT, absPath)
    .split(path.sep)
    .join("/");
}

function isWhitelisted(rel: string): boolean {
  return WHITELIST_PREFIXES.some((p) => rel.startsWith(p));
}

export type ScanResult = {
  rel: string;
  reason: "select_coord" | "coord_rpc";
  rpcName?: string;
};

export function scanForCoordLeaks(opts?: {
  files?: string[]; // Liste explicite (utile pour self-test fixtures).
  source?: Record<string, string>; // Map relPath → contenu (self-test).
}): ScanResult[] {
  const leaks: ScanResult[] = [];

  // Mode self-test : on prend un set de fichiers virtuels en RAM.
  if (opts?.source) {
    for (const [rel, content] of Object.entries(opts.source)) {
      checkContent(rel, content, leaks);
    }
    return leaks;
  }

  const files = opts?.files
    ? opts.files
    : SCAN_ROOTS.flatMap((root) =>
        walkSourceFiles(path.join(REPO_ROOT, root)),
      );

  for (const abs of files) {
    const rel = relPath(abs);
    if (isWhitelisted(rel)) continue;
    let content: string;
    try {
      content = fs.readFileSync(abs, "utf-8");
    } catch {
      continue;
    }
    checkContent(rel, content, leaks);
  }

  return leaks;
}

function checkContent(
  rel: string,
  content: string,
  leaks: ScanResult[],
): void {
  // Détection pattern A (.select() avec coord).
  const selectMatch = SELECT_COORD_RE.test(content);

  // Détection pattern B (.rpc avec une RPC connue retournant coords).
  let rpcMatch: string | null = null;
  for (const rpcName of KNOWN_COORD_RPCS) {
    if (rpcCoordRegex(rpcName).test(content)) {
      rpcMatch = rpcName;
      break;
    }
  }

  if (!selectMatch && !rpcMatch) return;

  // Le fichier touche aux coords brutes ; il DOIT défendre.
  const hasRound = ROUND_COORD_RE.test(content);
  const hasOptOut = OPT_OUT_RE.test(content);
  if (hasRound || hasOptOut) return;

  leaks.push({
    rel,
    reason: selectMatch ? "select_coord" : "coord_rpc",
    ...(rpcMatch ? { rpcName: rpcMatch } : {}),
  });
}

describe("scanForCoordLeaks — self-test (fixtures inline)", () => {
  it("détecte un .select(latitude) sans roundCoord ni opt-out", () => {
    const leaks = scanForCoordLeaks({
      source: {
        "fake/leaky.ts":
          'await admin.from("producers").select("id, latitude, longitude")\n',
      },
    });
    expect(leaks).toHaveLength(1);
    expect(leaks[0]!.rel).toBe("fake/leaky.ts");
    expect(leaks[0]!.reason).toBe("select_coord");
  });

  it("accepte .select(latitude) avec roundCoord dans le même fichier", () => {
    const leaks = scanForCoordLeaks({
      source: {
        "fake/clean.ts":
          'await admin.from("producers").select("id, latitude, longitude")\n' +
          'const out = { lat: roundCoord(row.latitude) };',
      },
    });
    expect(leaks).toHaveLength(0);
  });

  it("accepte .select(latitude) avec un commentaire opt-out documenté", () => {
    const leaks = scanForCoordLeaks({
      source: {
        "fake/optout.ts":
          '// PRIVACY: opt-out: coords commune publiques, pas adresse perso\n' +
          'await admin.from("communes").select("nom, latitude, longitude")\n',
      },
    });
    expect(leaks).toHaveLength(0);
  });

  it("détecte .rpc(\"search_producers\") sans roundCoord", () => {
    const leaks = scanForCoordLeaks({
      source: {
        "fake/rpc-leak.ts":
          'await admin.rpc("search_producers", { p_lat: 48, p_lng: 0, p_radius_km: 50 })\n',
      },
    });
    expect(leaks).toHaveLength(1);
    expect(leaks[0]!.reason).toBe("coord_rpc");
    expect(leaks[0]!.rpcName).toBe("search_producers");
  });

  it("accepte .rpc(\"search_producers\") avec roundCoord", () => {
    const leaks = scanForCoordLeaks({
      source: {
        "fake/rpc-clean.ts":
          'await admin.rpc("search_producers", { ... })\n' +
          'const sanitized = data.map((r) => ({ ...r, latitude: roundCoord(r.latitude) }))\n',
      },
    });
    expect(leaks).toHaveLength(0);
  });

  it("ignore une mention 'latitude' hors contexte select / rpc", () => {
    // Cas typique : type TypeScript ou commentaire purement déclaratif.
    const leaks = scanForCoordLeaks({
      source: {
        "fake/types-only.ts":
          'export type Producer = { latitude: number; longitude: number };\n' +
          '// Le widget reçoit latitude/longitude en props.\n',
      },
    });
    expect(leaks).toHaveLength(0);
  });
});

describe("scanForCoordLeaks — repo réel TerrOir (T-238)", () => {
  it("aucune fuite sur les zones publiques + consumer + lib", () => {
    const leaks = scanForCoordLeaks();
    if (leaks.length > 0) {
      // Reporting verbeux : le test fail message liste les fichiers fautifs
      // pour que le contributeur sache où ajouter `roundCoord` ou un
      // opt-out documenté. Cf. self-tests ci-dessus pour les patterns.
      const lines = leaks
        .map((l) => `  - ${l.rel} [${l.reason}${l.rpcName ? ` ${l.rpcName}` : ""}]`)
        .join("\n");
      throw new Error(
        `T-238 — ${leaks.length} fichier(s) lisent des coords producteur sans floutage ni opt-out documenté :\n${lines}\n\n` +
          "Pour chaque fichier ci-dessus :\n" +
          "  - soit ajouter un appel `roundCoord(...)` avant exposition,\n" +
          "  - soit ajouter un commentaire `// PRIVACY: opt-out: <raison>` documentant l'accès brut légitime\n" +
          "    (cas typique : coords commune publique, page admin auth-gated, etc.).\n" +
          "Voir lib/producers/coords.ts § 'Sites d'appel autorisés'.",
      );
    }
    expect(leaks).toEqual([]);
  });
});
