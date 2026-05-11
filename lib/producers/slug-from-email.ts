import { randomBytes } from "node:crypto";

// Génère un slug producer à partir de la partie locale d'un email.
// Pure function — pas d'import "use client" / "server only" : appelée
// depuis 3 server actions (accept-invitation, create-account,
// login-and-upgrade) au moment du INSERT producers en statut draft.
// Suffixe aléatoire 6 chars pour éviter collision sur deux producers
// partageant la même partie locale (ex: contact@x.fr et contact@y.fr).
//
// F-055 (audit pré-launch 2026-05-11) — suffixe via `randomBytes(3).toString('hex')`
// (6 caractères hexadécimaux, cryptographiquement sûr) plutôt que
// `Math.random().toString(36).slice(2, 8)`. Cohérent doctrine CLAUDE.md
// "fail-fast strict" + recommandation finding. Math.random() est PRNG
// non-crypto, prédictible sur fenêtre courte si la seed fuite (V8 xorshift128+
// internals). Pour un slug public utilisé comme identifiant URL producer,
// l'imprédictibilité du suffixe protège contre l'énumération basique
// (deviner les slugs des producteurs récemment inscrits).
export function slugFromEmail(email: string): string {
  const base = email.split("@")[0]!.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const suffix = randomBytes(3).toString("hex"); // 6 hex chars
  return `${base}-${suffix}`;
}
