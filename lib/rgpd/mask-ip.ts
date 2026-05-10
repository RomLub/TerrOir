// Masque une adresse IP pour stockage en DB / logs applicatifs.
//
// Donnée personnelle au sens RGPD : on préserve les 3 premiers octets IPv4
// (équivalent /24, suffisant pour la cartographie geo-grossière de l'IP)
// et on zero le 4e octet. Pour IPv6 on garde les 4 premiers groupes (/64,
// préfixe identifiant la sous-allocation FAI) et on zero le reste.
//
// Doctrine T-200 r1 (CLAUDE.md) : pas de log par-IP côté serveur. Cet
// helper est la voie unique pour stocker une IP côté logs applicatifs
// (audit_logs, email_change_otp_codes, contact form). Cf. F-010 audit
// pré-launch 2026-05-10.
//
// Cas couverts :
//   - IPv4 strict : "203.0.113.42"            → "203.0.113.0"
//   - IPv6 expansé : "2001:db8:abcd:1234:5678:9abc:def0:1234"
//                                              → "2001:db8:abcd:1234::"
//   - IPv6 compressé : "2001:db8::1"           → "2001:db8::" (expand puis /64)
//   - IPv6 loopback : "::1"                    → "::"
//   - IPv4-mapped IPv6 : "::ffff:203.0.113.42" → "::ffff:203.0.113.0"
//   - Malformed (octets >255, hex invalides, format cassé) → null

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV4_MAPPED_RE = /^::ffff:((?:\d{1,3}\.){3}\d{1,3})$/i;
const IPV6_GROUP_RE = /^[0-9a-fA-F]{1,4}$/;
const IPV6_CHARSET_RE = /^[0-9a-fA-F:]+$/;

export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const trimmed = ip.trim();
  if (!trimmed) return null;

  // IPv4-mapped IPv6 : on garde le préfixe sémantique mais on masque
  // l'IPv4 embarquée comme si elle était stockée en clair en IPv4.
  const mapped = trimmed.match(IPV4_MAPPED_RE);
  if (mapped) {
    const masked = maskIpv4(mapped[1]);
    return masked ? `::ffff:${masked}` : null;
  }

  // IPv6 général : tout input contenant ':' part en parsing IPv6 strict.
  if (trimmed.includes(":")) {
    return maskIpv6(trimmed);
  }

  return maskIpv4(trimmed);
}

function maskIpv4(ip: string): string | null {
  const m = ip.match(IPV4_RE);
  if (!m) return null;
  const octets = [m[1], m[2], m[3], m[4]].map((o) => Number(o));
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return null;
  return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
}

function maskIpv6(ip: string): string | null {
  if (!IPV6_CHARSET_RE.test(ip)) return null;

  // Refuse multiple "::" (illégal en IPv6 RFC 4291).
  const doubleColonCount = (ip.match(/::/g) ?? []).length;
  if (doubleColonCount > 1) return null;

  let groups: string[];
  if (doubleColonCount === 1) {
    const idx = ip.indexOf("::");
    const leftRaw = ip.slice(0, idx);
    const rightRaw = ip.slice(idx + 2);
    const left = leftRaw === "" ? [] : leftRaw.split(":");
    const right = rightRaw === "" ? [] : rightRaw.split(":");
    const fill = 8 - left.length - right.length;
    if (fill < 0) return null;
    groups = [...left, ...Array(fill).fill("0"), ...right];
  } else {
    groups = ip.split(":");
    if (groups.length !== 8) return null;
  }

  for (const g of groups) {
    if (!IPV6_GROUP_RE.test(g)) return null;
  }

  // /64 : on zero les 4 derniers groupes via la compression "::". On
  // applique aussi la compression RFC 5952 sur les zeros trailing du /64
  // pour éviter "2001:db8:0:0::" et émettre "2001:db8::" (canonique).
  const head = groups
    .slice(0, 4)
    .map((g) => g.toLowerCase().replace(/^0+(?=.)/, ""));
  while (head.length > 0 && head[head.length - 1] === "0") {
    head.pop();
  }
  return head.length === 0 ? "::" : `${head.join(":")}::`;
}
