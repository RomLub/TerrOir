// Helpers localStorage pour les preferences user cote client.
// try/catch silencieux : mode incognito / LS desactive -> no-op sans erreur.
//
// T-266-bis : migration progressive cle 'terroir-saved-email' (legacy) ->
// 'terroir_saved_email' (cible doctrine namespace T-266 underscore). Le helper
// createMigratedStorage gere la phase 1 (lecture ancienne+nouvelle, ecriture
// nouvelle uniquement, migration silencieuse au passage). Suppression du
// fallback legacy programmee apres 2026-06-05 (T-266-tris).

import { createMigratedStorage } from "./migrated-storage";

const savedEmailStorage = createMigratedStorage(
  "terroir-saved-email", // legacy, a supprimer apres 2026-06-05
  "terroir_saved_email", // cible
  "local",
);

export function getSavedEmail(): string | null {
  return savedEmailStorage.read();
}

export function setSavedEmail(email: string): void {
  savedEmailStorage.write(email);
}

export function clearSavedEmail(): void {
  savedEmailStorage.remove();
}
