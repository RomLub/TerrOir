// Test F-004 — Clawback grep statique strict (refund coverage).
// (audit pré-launch 2026-05-10, finding CRITIQUE).
//
// Cible : tous les call sites `stripe.refunds.create` dans `app/`, `lib/`
// et `scripts/` DOIVENT importer `reverseTransferIfNeeded`
// (helper lib/stripe/reverse-transfer.ts) pour clawback la part producer
// transférée. Sans ça, TerrOir absorbe 100% de la perte commerciale
// silencieusement (le producer a déjà encaissé son net 94 %, TerrOir
// paie 100 % du remboursement).
//
// IMPORTANT : ce test est un FILET DÉTERMINISTE pour anti-régression.
// Démonstration empirique 2026-05-12 : la régression P0_F008 trigger
// producers (lat/lng + prenom_affichage) a été livrée en prod 24h après
// les tests Teammates sans alerte review humaine. Filet automatique
// > review humaine pour le périmètre financier critique.
//
// Logique : scan récursif `app/` + `lib/` + `scripts/` pour
// `stripe.refunds.create` (strip commentaires `//`). Pour chaque fichier
// match, vérifie l'import de `reverseTransferIfNeeded` OU appartenance
// à une whitelist d'exemptions explicitement documentées.
//
// Comportement : count === N attendu (= 7 hits totaux à ce jour).
// + tous les call sites obligatoires importent le helper. Sinon fail
// avec liste fichier:ligne:snippet pour diagnostic futur.
//
// Helper testé exhaustivement (5 cas) : tests/lib/stripe/reverse-transfer.test.ts.
// Pré-requis : aucun (test pur Node, pas de Supabase ni Stripe SDK live).

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(TEST_FILE), "..", "..", "..");

const SCAN_ROOTS = ["app", "lib", "scripts"];
const EXCLUDED_DIRS = new Set(["node_modules", ".next", "dist", ".git"]);
const EXTENSIONS = new Set([".ts", ".tsx"]);
const PATTERN = /stripe\.refunds\.create/;
const HELPER_IMPORT_PATTERN = /import[^;]*reverseTransferIfNeeded/;

// Count attendu strict — TOUT changement de surface (ajout, suppression,
// déplacement) doit être conscient. Si tu modifies cette valeur, tu confirmes
// avoir audité chaque hit et décidé volontairement d'élargir/réduire le
// périmètre clawback.
const EXPECTED_TOTAL = 7;

// Whitelist d'exemptions : fichiers où `stripe.refunds.create` est appelé
// SANS `reverseTransferIfNeeded` par décision design explicite.
//
// Toute extension de cette whitelist DOIT être justifiée par :
//   1. Un commentaire source dans le fichier exempté pointant vers F-004
//      et expliquant pourquoi le helper n'est pas applicable. Modèle :
//      lib/refund-incidents/retry-incident.ts:104 — commentaire
//      "F-004 sub-2 : pas d'appel reverseTransferIfNeeded sur ce path."
//      (le retry est une re-tentative d'un refund qui a déjà passé par
//      reverseTransferIfNeeded au premier essai — re-reverse au retry =
//      double clawback bug).
//   2. Une revue humaine documentée dans le commit ajoutant l'exemption.
const EXEMPTIONS_WHITELIST = new Set<string>([
  "lib/refund-incidents/retry-incident.ts",
]);

type Hit = { file: string; line: number; snippet: string };

function walkDir(dir: string, hits: Hit[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // Dossier inexistant — ex: scripts/ peut être vide selon repo state.
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry)) continue;
      walkDir(full, hits);
      continue;
    }
    if (!stat.isFile()) continue;
    const dotIdx = full.lastIndexOf(".");
    if (dotIdx < 0) continue;
    const ext = full.slice(dotIdx);
    if (!EXTENSIONS.has(ext)) continue;
    const content = readFileSync(full, "utf8");
    content.split("\n").forEach((line, idx) => {
      // Skip lignes de block comment JSDoc (commencent par `*` ou `/*` modulo
      // whitespace). Audit lecture seule 2026-05-12 a identifié 4 hits JSDoc
      // dans classify-error.ts + log-payment-event.ts qui sont des références
      // documentaires, pas des call sites actifs.
      const trimmed = line.trim();
      if (trimmed.startsWith("*") || trimmed.startsWith("/*")) return;

      // Strip commentaires single-line `//` AVANT match.
      const codeOnly = line.split("//")[0];
      if (PATTERN.test(codeOnly)) {
        const relativeFile = relative(REPO_ROOT, full).split(sep).join("/");
        hits.push({
          file: relativeFile,
          line: idx + 1,
          snippet: line.trim(),
        });
      }
    });
  }
}

function findStripeRefundCalls(): Hit[] {
  const hits: Hit[] = [];
  for (const root of SCAN_ROOTS) {
    walkDir(join(REPO_ROOT, root), hits);
  }
  return hits;
}

function fileImportsHelper(file: string): boolean {
  const fullPath = join(REPO_ROOT, file);
  const content = readFileSync(fullPath, "utf8");
  return HELPER_IMPORT_PATTERN.test(content);
}

describe("F-004 — clawback grep statique strict (refund coverage)", () => {
  const hits = findStripeRefundCalls();

  it(`count exact = ${EXPECTED_TOTAL} hits stripe.refunds.create dans app/ + lib/ + scripts/`, () => {
    if (hits.length !== EXPECTED_TOTAL) {
      const listing = hits
        .map((h) => `  - ${h.file}:${h.line} → ${h.snippet}`)
        .join("\n");
      throw new Error(
        `\nF-004 régression : count stripe.refunds.create attendu=${EXPECTED_TOTAL}, ` +
          `observé=${hits.length}.\n` +
          `Hits trouvés:\n${listing}\n\n` +
          `Action requise : si tu as ajouté un nouveau call site refund, ` +
          `mets à jour EXPECTED_TOTAL et soit (a) importe reverseTransferIfNeeded ` +
          `dans le nouveau fichier, soit (b) ajoute le fichier à EXEMPTIONS_WHITELIST ` +
          `avec commentaire source style retry-incident.ts:104 + revue humaine.\n`,
      );
    }
    expect(hits.length).toBe(EXPECTED_TOTAL);
  });

  it("tous les call sites obligatoires importent reverseTransferIfNeeded (sauf whitelist exempt)", () => {
    const missing: string[] = [];
    for (const hit of hits) {
      if (EXEMPTIONS_WHITELIST.has(hit.file)) continue;
      if (!fileImportsHelper(hit.file)) {
        missing.push(`  - ${hit.file}:${hit.line} (snippet: ${hit.snippet})`);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `\nF-004 régression : ${missing.length} call site(s) refund ` +
          `n'importe(nt) pas reverseTransferIfNeeded.\n` +
          `Sites en gap (clawback manquant — TerrOir absorbe la perte silencieusement) :\n` +
          `${missing.join("\n")}\n\n` +
          `Action requise : importer @/lib/stripe/reverse-transfer + appeler ` +
          `reverseTransferIfNeeded() AVANT le stripe.refunds.create. Sinon, ` +
          `justifier l'exemption en ajoutant le fichier à EXEMPTIONS_WHITELIST ` +
          `+ commentaire source style retry-incident.ts:104.\n`,
      );
    }
    expect(missing).toEqual([]);
  });
});
