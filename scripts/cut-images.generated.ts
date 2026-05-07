/**
 * Fichier genere par scripts/fetch-cut-images.ts.
 * NE PAS EDITER A LA MAIN — sera ecrase au prochain run du script.
 *
 * Pour regenerer toutes les images :
 *   PIXABAY_API_KEY=xxx npx tsx scripts/fetch-cut-images.ts
 *
 * Pour regenerer un seul slug :
 *   PIXABAY_API_KEY=xxx npx tsx scripts/fetch-cut-images.ts --only filet
 */

import type { BeefCutImage, BeefCutSlug } from '@/lib/beef-cuts';

export const CUT_IMAGES: Partial<Record<BeefCutSlug, BeefCutImage>> = {};
