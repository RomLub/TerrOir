import type { SupabaseClient } from '@supabase/supabase-js';

export type ProducerRecord = {
  id: string;
  user_id: string;
  slug: string;
  nom_exploitation: string;
  statut: 'draft' | 'pending' | 'active' | 'public' | 'suspended';
  producer_number: number;
};

export async function fetchProducerForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProducerRecord | null> {
  const { data } = await supabase
    .from('producers')
    .select('id, user_id, slug, nom_exploitation, statut, producer_number')
    .eq('user_id', userId)
    .maybeSingle();
  return (data as ProducerRecord | null) ?? null;
}
