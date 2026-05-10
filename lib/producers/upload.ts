import type { SupabaseClient } from '@supabase/supabase-js';

export type UploadResult = { url: string; path: string };

// F-006 (audit P0-TC 2026-05-10) : whitelist stricte côté serveur.
// Avant : extension regex `[a-z0-9]+` permettait n'importe quoi (.html,
// .js, .pdf), `file.type` client propagé directement à Storage. Producer
// authentifié pouvait héberger du HTML servi `text/html` sur la CDN
// Supabase TerrOir (vecteur phishing avalisé par sous-domaine de service
// connu).
//
// Après : 4 extensions image only, contentType dérivé serveur (file.type
// client ignoré), cap 5 MB defense-in-depth amont du Storage (qui pose
// aussi son cap via migration 20260510120000).
const ALLOWED_EXTS = ['jpg', 'jpeg', 'png', 'webp'] as const;
type AllowedExt = (typeof ALLOWED_EXTS)[number];

const EXT_TO_MIME: Record<AllowedExt, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

function randomSegment(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function extractWhitelistedExt(filename: string): AllowedExt {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!m) {
    throw new Error(
      'Extension de fichier manquante. Image .jpg, .jpeg, .png ou .webp uniquement.',
    );
  }
  const ext = m[1];
  if (!(ALLOWED_EXTS as readonly string[]).includes(ext)) {
    throw new Error(
      `Extension "${ext}" non autorisée. Image .jpg, .jpeg, .png ou .webp uniquement.`,
    );
  }
  return ext as AllowedExt;
}

export async function uploadProducerPhoto(
  supabase: SupabaseClient,
  bucket: 'producer-photos' | 'product-photos',
  producerId: string,
  file: File,
  subfolder = '',
): Promise<UploadResult> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('Fichier trop lourd. Taille maximale : 5 Mo.');
  }
  const ext = extractWhitelistedExt(file.name);
  const contentType = EXT_TO_MIME[ext];
  const key = [producerId, subfolder, `${Date.now()}-${randomSegment()}.${ext}`]
    .filter(Boolean)
    .join('/');

  const { error } = await supabase.storage.from(bucket).upload(key, file, {
    cacheControl: '3600',
    contentType,
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(key);
  return { url: data.publicUrl, path: key };
}
