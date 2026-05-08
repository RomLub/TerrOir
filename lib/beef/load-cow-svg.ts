import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  BEEF_CUTS,
  CATEGORY_TO_FAMILY,
  type BeefCutSlug,
} from '@/lib/beef-cuts';

let cached: string | null = null;
let cachedV2: string | null = null;

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

/**
 * Variante V2 : decore les paths data-cut="<slug>" avec data-cat="<family>"
 * et supprime leur attribut style inline pour laisser la CSS V2 piloter
 * le rendu via les selecteurs `path[data-cat="nobles"]` etc.
 *
 * Le markup retourne reste un drop-in pour dangerouslySetInnerHTML.
 * Les autres paths (silhouette, decoration) sont laisses tels quels.
 */
export async function loadCowSvgV2(): Promise<string> {
  if (cachedV2) return cachedV2;
  const raw = await loadCowSvg();

  let result = raw;
  for (const slug of Object.keys(BEEF_CUTS) as BeefCutSlug[]) {
    const cut = BEEF_CUTS[slug];
    const family = cut.family ?? CATEGORY_TO_FAMILY[cut.category];

    // Match : `data-cut="<slug>" style="..."` ou `data-cut="<slug>"` seul.
    // On insere data-cat juste apres data-cut, et on retire le style inline
    // s'il existe (qui contiendrait opacity:0).
    const reWithStyle = new RegExp(
      `data-cut="${escapeRegExp(slug)}"\\s+style="[^"]*"`,
      'g',
    );
    const reWithoutStyle = new RegExp(
      `data-cut="${escapeRegExp(slug)}"(?!\\s+data-cat)`,
      'g',
    );

    result = result.replace(
      reWithStyle,
      `data-cut="${slug}" data-cat="${family}"`,
    );
    result = result.replace(
      reWithoutStyle,
      `data-cut="${slug}" data-cat="${family}"`,
    );
  }

  cachedV2 = result;
  return cachedV2;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
