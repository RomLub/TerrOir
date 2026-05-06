// =============================================================================
// T-110-bis : escape des wildcards Postgres ILIKE pour les lookups email-keyed
// =============================================================================
// Postgres ILIKE interprète `_` (joker 1 caractère) et `%` (joker n caractères)
// comme des wildcards. Or `_` est techniquement autorisé en local-part RFC 5322
// (ex: `john_doe@example.com`) — un input email valide passé brut à .ilike()
// produit donc des faux positifs (lookup `john_doe@…` matche aussi
// `johnXdoe@…`, `john1doe@…`, etc.).
//
// Ce helper échappe `_`, `%` et `\` (le backslash lui-même, en cas de quoted
// local-part RFC qui peut le contenir) pour neutraliser leur sémantique
// wildcard tout en préservant l'insensibilité à la casse fournie par .ilike().
//
// Pattern aligné avec `lib/legal/compliance.ts:154` qui faisait déjà cet
// escape pour les recherches partielles `%search%` côté admin.
//
// Doctrine T-110 / T-110-bis :
//   1. Validation Zod email amont (`z.string().email()`) garantit la forme
//      RFC valide (rejette `<bogus>` etc.).
//   2. `.ilike("email", escapeIlikeEmail(input))` côté query Supabase
//      garantit que les wildcards éventuels du local-part sont neutralisés.
//   3. Double couche defense in depth — Zod ne peut pas rejeter `_` car
//      RFC-valide ; l'escape côté query est la garde finale.
// =============================================================================

/**
 * Échappe les caractères Postgres ILIKE wildcards (`_`, `%`) ainsi que `\`
 * (escape character lui-même) pour qu'un input email valide RFC 5322 soit
 * matché littéralement plutôt qu'interprété comme pattern.
 *
 * @example
 *   escapeIlikeEmail('john_doe@example.com')   // 'john\_doe@example.com'
 *   escapeIlikeEmail('50%off@example.com')     // '50\%off@example.com'
 *   escapeIlikeEmail('plain@example.com')      // 'plain@example.com' (no-op)
 */
export function escapeIlikeEmail(email: string): string {
  return email.replace(/[\\_%]/g, (m) => `\\${m}`);
}
