import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';

let cached: string | null = null;

/**
 * Lit le SVG cow.svg côté serveur et le retourne sous forme de string.
 * Le résultat est mis en cache au premier appel pour éviter de relire le
 * fichier à chaque rendu (SSG : appelé une seule fois au build).
 */
export async function loadCowSvg(): Promise<string> {
  if (cached) return cached;
  const filePath = path.join(process.cwd(), 'public', 'images', 'cow.svg');
  cached = await fs.readFile(filePath, 'utf8');
  return cached;
}
