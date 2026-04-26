// Helpers localStorage pour les préférences user côté client.
// try/catch silencieux : mode incognito / LS désactivé → no-op sans erreur.

const SAVED_EMAIL_KEY = "terroir-saved-email";

export function getSavedEmail(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SAVED_EMAIL_KEY);
  } catch {
    return null;
  }
}

export function setSavedEmail(email: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SAVED_EMAIL_KEY, email);
  } catch {
    // no-op
  }
}

export function clearSavedEmail(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SAVED_EMAIL_KEY);
  } catch {
    // no-op
  }
}
