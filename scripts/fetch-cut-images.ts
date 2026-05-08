/**
 * Recupere une photo "plat cuisine" pour chaque morceau de boeuf
 * via l'API Pixabay et genere scripts/cut-images.generated.ts.
 *
 * Usage :
 *   PIXABAY_API_KEY=xxxxx npx tsx scripts/fetch-cut-images.ts
 *   PIXABAY_API_KEY=xxxxx npx tsx scripts/fetch-cut-images.ts --only filet
 *   PIXABAY_API_KEY=xxxxx npx tsx scripts/fetch-cut-images.ts --skip-existing
 *
 * Voir scripts/README.md pour la doc complete.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { ALL_CUT_SLUGS, type BeefCutSlug } from '../lib/beef-cuts';

type PixabayHit = {
  id: number;
  largeImageURL: string;
  webformatURL: string;
  imageWidth: number;
  imageHeight: number;
  user: string;
  pageURL: string;
  tags: string;
};

type PixabayResponse = {
  total: number;
  totalHits: number;
  hits: PixabayHit[];
};

type GeneratedEntry = {
  imageUrl: string;
  imageAlt: string;
  imageCredit: string;
};

/**
 * Mots-cles de recherche par slug. Termes anglais (Pixabay indexe
 * mieux la cuisine en EN).
 */
const SEARCH_TERMS: Record<BeefCutSlug, string> = {
  filet: 'beef tenderloin',
  'faux-filet': 'sirloin steak',
  'cotes-entrecotes': 'ribeye steak',
  rumsteck: 'rump steak',
  'aiguillette-baronne': 'beef tenderloin slice',
  'rond-de-gite': 'roast beef',
  onglet: 'hanger steak',
  hampe: 'skirt steak',
  araignee: 'spider steak beef',
  'poire-merlan': 'beef rump steak',
  'bavette-d-aloyau': 'flank steak',
  'macreuse-a-bifteck': 'beef shoulder steak',
  'jumeau-a-bifteck': 'beef chuck steak',
  'plat-de-cotes': 'beef short ribs',
  tendron: 'beef brisket',
  flanchet: 'beef flank',
  'bavette-de-flanchet': 'beef stew',
  tranche: 'beef roast',
  collier: 'beef bourguignon',
  paleron: 'braised beef',
  macreuse: 'beef stew',
  jumeau: 'beef pot roast',
  gite: 'pot au feu',
  'gite-a-la-noix': 'beef daube',
  poitrine: 'beef brisket smoked',
  joue: 'braised beef cheek',
  langue: 'beef tongue',
  queue: 'oxtail stew',
  'basses-cotes': 'beef chuck roast',
};

const PIXABAY_API = 'https://pixabay.com/api/';
const PUBLIC_IMAGES_DIR = path.join(
  process.cwd(),
  'public',
  'images',
  'cuts',
);
const GENERATED_FILE = path.join(
  process.cwd(),
  'scripts',
  'cut-images.generated.ts',
);

function parseArgs() {
  const args = process.argv.slice(2);
  let only: BeefCutSlug | null = null;
  let skipExisting = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--only' && args[i + 1]) {
      only = args[i + 1] as BeefCutSlug;
      i += 1;
    } else if (arg === '--skip-existing') {
      skipExisting = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: PIXABAY_API_KEY=xxx npx tsx scripts/fetch-cut-images.ts [--only <slug>] [--skip-existing]',
      );
      process.exit(0);
    }
  }
  return { only, skipExisting };
}

async function fetchPixabayHit(
  query: string,
  apiKey: string,
): Promise<PixabayHit | null> {
  const url = new URL(PIXABAY_API);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('q', query);
  url.searchParams.set('image_type', 'photo');
  url.searchParams.set('safesearch', 'true');
  url.searchParams.set('min_width', '800');
  url.searchParams.set('per_page', '3');
  url.searchParams.set('orientation', 'horizontal');

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Pixabay API ${res.status} ${res.statusText} for query "${query}"`,
    );
  }
  const data = (await res.json()) as PixabayResponse;
  return data.hits[0] ?? null;
}

async function downloadImage(
  imageUrl: string,
  destPath: string,
): Promise<void> {
  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`Download ${imageUrl} -> ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(destPath, buffer);
}

function buildAlt(slug: BeefCutSlug, query: string): string {
  return `Photo d'illustration : ${query} (${slug.replace(/-/g, ' ')})`;
}

function buildCredit(hit: PixabayHit): string {
  return `Photo : ${hit.user} / Pixabay`;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function loadExisting(): Promise<
  Partial<Record<BeefCutSlug, GeneratedEntry>>
> {
  try {
    const raw = await fs.readFile(GENERATED_FILE, 'utf8');
    const match = raw.match(/CUT_IMAGES[^=]*=\s*(\{[\s\S]*?\})\s*;/);
    if (!match) return {};
    // Eval-friendly : on extrait le JSON-like, mais ts-syntax avec
    // commentaires + trailing commas. Pour simplicite on regex chaque
    // entry.
    const out: Partial<Record<BeefCutSlug, GeneratedEntry>> = {};
    const entryRe =
      /['"]([a-z-]+)['"]:\s*\{\s*imageUrl:\s*['"]([^'"]+)['"],\s*imageAlt:\s*['"]([^'"]+)['"],\s*imageCredit:\s*['"]([^'"]+)['"]\s*\},?/g;
    for (const m of match[1].matchAll(entryRe)) {
      const [, slug, imageUrl, imageAlt, imageCredit] = m;
      out[slug as BeefCutSlug] = { imageUrl, imageAlt, imageCredit };
    }
    return out;
  } catch {
    return {};
  }
}

async function writeGenerated(
  results: Partial<Record<BeefCutSlug, GeneratedEntry>>,
): Promise<void> {
  const header = `/**
 * Fichier genere par scripts/fetch-cut-images.ts.
 * NE PAS EDITER A LA MAIN — sera ecrase au prochain run du script.
 *
 * Pour regenerer toutes les images :
 *   PIXABAY_API_KEY=xxx npx tsx scripts/fetch-cut-images.ts
 *
 * Pour regenerer un seul slug :
 *   PIXABAY_API_KEY=xxx npx tsx scripts/fetch-cut-images.ts --only filet
 */

import type { BeefCutImage, BeefCutSlug } from '../lib/beef-cuts';

export const CUT_IMAGES: Partial<Record<BeefCutSlug, BeefCutImage>> = `;

  const sortedKeys = Object.keys(results).sort() as BeefCutSlug[];
  const body =
    '{\n' +
    sortedKeys
      .map((slug) => {
        const entry = results[slug];
        if (!entry) return '';
        return `  '${slug}': {
    imageUrl: '${entry.imageUrl}',
    imageAlt: ${JSON.stringify(entry.imageAlt)},
    imageCredit: ${JSON.stringify(entry.imageCredit)},
  },`;
      })
      .filter(Boolean)
      .join('\n') +
    '\n};\n';

  await fs.writeFile(GENERATED_FILE, header + body, 'utf8');
}

async function main() {
  const { only, skipExisting } = parseArgs();
  const apiKey = process.env.PIXABAY_API_KEY;
  if (!apiKey) {
    console.error(
      'PIXABAY_API_KEY manquant. Voir scripts/README.md pour obtenir une cle.',
    );
    process.exit(1);
  }

  await ensureDir(PUBLIC_IMAGES_DIR);

  const targetSlugs: BeefCutSlug[] = only
    ? [only]
    : ([...ALL_CUT_SLUGS] as BeefCutSlug[]);

  const existing = await loadExisting();
  const results: Partial<Record<BeefCutSlug, GeneratedEntry>> = {
    ...existing,
  };

  let ok = 0;
  let skipped = 0;
  let missing = 0;

  for (const slug of targetSlugs) {
    if (skipExisting && existing[slug]) {
      console.log(`[skip] ${slug} (deja en cache)`);
      skipped += 1;
      continue;
    }

    const query = SEARCH_TERMS[slug];
    if (!query) {
      console.warn(`[warn] pas de query pour ${slug}, skip`);
      continue;
    }

    try {
      const hit = await fetchPixabayHit(query, apiKey);
      if (!hit) {
        console.warn(`[miss] aucun resultat Pixabay pour "${query}" (${slug})`);
        missing += 1;
        continue;
      }

      const localPath = path.join(PUBLIC_IMAGES_DIR, `${slug}.jpg`);
      await downloadImage(hit.largeImageURL, localPath);

      results[slug] = {
        imageUrl: `/images/cuts/${slug}.jpg`,
        imageAlt: buildAlt(slug, query),
        imageCredit: buildCredit(hit),
      };
      console.log(`[ok]   ${slug} <- ${hit.user} (${hit.pageURL})`);
      ok += 1;
    } catch (err) {
      console.error(`[err]  ${slug}: ${(err as Error).message}`);
      missing += 1;
    }

    // Politesse API : 50ms entre 2 requetes
    await new Promise((r) => setTimeout(r, 50));
  }

  await writeGenerated(results);

  console.log(
    `\nDone. ok=${ok} skipped=${skipped} missing=${missing} total=${targetSlugs.length}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
