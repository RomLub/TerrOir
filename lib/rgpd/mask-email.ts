// Masque un email pour les logs applicatifs (Vercel, consultés par l'équipe
// dev). Donnée personnelle au sens RGPD : on préserve les 2 premiers caractères
// de la part locale + le domaine complet (qui n'identifie pas une personne),
// ce qui laisse assez d'info pour l'audit debug sans exposer l'identité.
//
// Exemple : "julien.dupont@example.com" → "ju***@example.com".
//
// Hors scope : notifications.metadata.email en DB reste en clair (traçabilité
// serveur, pas un log applicatif).
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "(none)";
  const atIdx = email.indexOf("@");
  if (atIdx < 0) return "(invalid)";
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);
  if (!local || !domain) return "(invalid)";
  const maskedLocal =
    local.length <= 2 ? `${local[0]}*` : `${local.slice(0, 2)}***`;
  return `${maskedLocal}@${domain}`;
}
