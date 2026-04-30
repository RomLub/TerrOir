// Cursor opaque pour la pagination de /audit-logs. Encapsule le couple
// (created_at, id) qui sert de clé d'ordre sur la table audit_logs (ORDER BY
// created_at DESC, id DESC). Le format base64url permet de transporter le
// cursor dans une URL sans échappement, et reste opaque côté admin (pas
// d'inspection naïve de l'historique des pages).
export type Cursor = { createdAt: string; id: string };

export function encodeCursor(c: Cursor): string {
  const json = JSON.stringify(c);
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "createdAt" in parsed &&
      "id" in parsed &&
      typeof (parsed as { createdAt: unknown }).createdAt === "string" &&
      typeof (parsed as { id: unknown }).id === "string"
    ) {
      return parsed as Cursor;
    }
    return null;
  } catch {
    return null;
  }
}
