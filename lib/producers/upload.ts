import type { SupabaseClient } from '@supabase/supabase-js';

export type UploadResult = { url: string; path: string };

function randomSegment(): string {
  return Math.random().toString(36).slice(2, 10);
}

function extFor(name: string, fallback = 'jpg'): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : fallback;
}

export async function uploadProducerPhoto(
  supabase: SupabaseClient,
  bucket: 'producer-photos' | 'product-photos',
  producerId: string,
  file: File,
  subfolder = '',
): Promise<UploadResult> {
  const ext = extFor(file.name);
  const key = [producerId, subfolder, `${Date.now()}-${randomSegment()}.${ext}`]
    .filter(Boolean)
    .join('/');

  const { error } = await supabase.storage.from(bucket).upload(key, file, {
    cacheControl: '3600',
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(key);
  return { url: data.publicUrl, path: key };
}
