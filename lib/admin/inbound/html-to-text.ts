// Chantier 9 (qualité) — fallback texte pour les emails HTML-only. mailparser
// ne remplit `.text` que s'il existe une partie text/plain ; un mail HTML-only
// laisse `.text` vide → la fiche /mails affichait du vide. On dérive un texte
// lisible depuis le HTML (strip balises + décodage entités usuelles). Pur
// (pas de rendu HTML brut → aucune surface XSS dans l'admin).

const NAMED_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
};

export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return "";
  let out = html
    // Blocs non textuels.
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    // Sauts de ligne sémantiques.
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|table|blockquote|section|article)>/gi, "\n")
    // Toutes les autres balises.
    .replace(/<[^>]+>/g, "");

  // Entités nommées usuelles.
  for (const [ent, ch] of Object.entries(NAMED_ENTITIES)) {
    out = out.replace(new RegExp(ent, "gi"), ch);
  }
  // Entités numériques (&#233; etc.).
  out = out.replace(/&#(\d+);/g, (_m, n: string) =>
    String.fromCharCode(Number(n)),
  );

  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
