// =============================================================================
// T-266-bis : helper migration progressive clés terroir- → terroir_
// =============================================================================
// T-266 a impose le prefixe terroir_ (underscore) sur toute cle (session|local)
// Storage. 3 cles legacy etaient deja deployees en prod avec le prefixe
// terroir- (tiret) : terroir-saved-email, terroir-cart-banner-dismissed,
// terroir-cart. Renommer immediatement aurait casse les sessions/preferences
// des utilisateurs deja connectes (panier vide, email login non pre-rempli,
// banner stale items qui re-declenche).
//
// Strategie ancien+nouveau 30j :
//   - Phase 1 (ce helper, immediat) : code lit ancien OU nouveau, ecrit
//     seulement nouveau. Migration silencieuse au passage : si on lit la
//     valeur sur l'ancienne cle, on la copie sur la nouvelle et on supprime
//     l'ancienne.
//   - Phase 2 (apres 2026-06-05, hors scope T-266-bis) : suppression du
//     fallback legacy. Tracker via T-266-tris ou alarme calendrier.
//
// Le helper est generique et reutilisable pour future migrations de cles.
// Pour les cas zustand persist (qui passe par createJSONStorage et non par
// localStorage.getItem direct), voir le storage adapter custom inline dans
// lib/store/cart.ts.
// =============================================================================

export type StorageType = "local" | "session";

export interface MigratedStorage {
  read(): string | null;
  write(value: string): void;
  remove(): void;
}

function getStorage(type: StorageType): Storage | null {
  if (typeof window === "undefined") return null;
  return type === "local" ? window.localStorage : window.sessionStorage;
}

/**
 * Cree un wrapper storage qui :
 *   - read()   : essaie la nouvelle cle d'abord ; sinon fallback sur l'ancienne.
 *                Si trouvee sur l'ancienne, la migre vers la nouvelle (re-ecrit
 *                + supprime l'ancienne).
 *   - write()  : ecrit uniquement sur la nouvelle cle. Supprime aussi
 *                l'ancienne au passage (cleanup, evite l'orphelin si race).
 *   - remove() : supprime ancienne ET nouvelle pour cleanup propre (cas
 *                logout / RGPD).
 *
 * Toutes les operations sont SSR-safe (no-op si window undefined) et
 * fail-silent sur exception (localStorage peut throw : quota, mode prive
 * Safari, etc.). Cohérent avec le pattern existant lib/storage/local-
 * preferences.ts qui try/catch.
 *
 * @example
 *   const savedEmail = createMigratedStorage(
 *     "terroir-saved-email",      // ancienne cle (a supprimer apres 2026-06-05)
 *     "terroir_saved_email",      // nouvelle cle
 *     "local",
 *   );
 *   savedEmail.read();             // lit nouvelle, fallback ancienne (+migre)
 *   savedEmail.write("a@b.fr");    // ecrit sur nouvelle, supprime ancienne
 *   savedEmail.remove();           // supprime les 2
 */
export function createMigratedStorage(
  oldKey: string,
  newKey: string,
  type: StorageType,
): MigratedStorage {
  return {
    read(): string | null {
      const storage = getStorage(type);
      if (!storage) return null;
      try {
        const newVal = storage.getItem(newKey);
        if (newVal !== null) return newVal;
        const oldVal = storage.getItem(oldKey);
        if (oldVal === null) return null;
        // Migration au passage : copy old -> new, delete old.
        storage.setItem(newKey, oldVal);
        storage.removeItem(oldKey);
        return oldVal;
      } catch {
        return null;
      }
    },
    write(value: string): void {
      const storage = getStorage(type);
      if (!storage) return;
      try {
        storage.setItem(newKey, value);
        storage.removeItem(oldKey);
      } catch {
        // Quota / mode prive : fail-silent.
      }
    },
    remove(): void {
      const storage = getStorage(type);
      if (!storage) return;
      try {
        storage.removeItem(newKey);
        storage.removeItem(oldKey);
      } catch {
        // Fail-silent.
      }
    },
  };
}
