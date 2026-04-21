// Types + helpers purs pour le modèle de rôles cumulables.
// Client-safe (pas de server-only) — utilisables en composant React client
// comme en code serveur. Pour les requêtes DB (isAdmin par userId),
// voir lib/auth/session.ts qui expose un helper serveur dédié.

export type UserRole = "consumer" | "producer";

export interface Authz {
  roles: UserRole[];
  isAdmin: boolean;
}

export function hasRole(
  authz: { roles: UserRole[] } | null | undefined,
  role: UserRole,
): boolean {
  return !!authz && authz.roles.includes(role);
}
