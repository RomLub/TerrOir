// Génère un slug producer à partir de la partie locale d'un email.
// Pure function — pas d'import "use client" / "server only" : appelée
// depuis 3 server actions (accept-invitation, create-account,
// login-and-upgrade) au moment du INSERT producers en statut draft.
// Suffixe aléatoire 6 chars pour éviter collision sur deux producers
// partageant la même partie locale (ex: contact@x.fr et contact@y.fr).
export function slugFromEmail(email: string): string {
  const base = email.split("@")[0]!.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}
