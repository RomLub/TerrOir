// Masque une adresse IP pour stockage en DB / logs applicatifs.
// Donnée personnelle au sens RGPD : on préserve les 3 premiers octets IPv4
// (équivalent /24, suffisant pour la cartographie geo-grossière de l'IP)
// et on zero le 4e octet. Pour IPv6 on garde les 4 premiers groupes (/64,
// préfixe identifiant la sous-allocation FAI) et on zero le reste.
//
// sec-P2-2 (T9 2026-05-07) : utilisé pour le audit log contact_form_submitted
// qui ne doit pas stocker l'IP en clair pour respecter la doctrine T-200 r1
// (pas de log par-IP côté serveur, déviation du contact form qui logguait
// IP+email+nom en clair).
//
// Exemples :
//   "203.0.113.42"            → "203.0.113.0"
//   "2001:db8:abcd:1234:5678:9abc:def0:1234" → "2001:db8:abcd:1234::"
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const trimmed = ip.trim();
  if (!trimmed) return null;
  // IPv6 (contient au moins un ':')
  if (trimmed.includes(":")) {
    const parts = trimmed.split(":");
    const head = parts.slice(0, 4).filter(Boolean);
    if (head.length === 0) return null;
    return `${head.join(":")}::`;
  }
  // IPv4 fallback : 4 octets séparés par '.'
  const parts = trimmed.split(".");
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
}
