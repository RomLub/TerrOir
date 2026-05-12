import type { SupabaseClient } from "@supabase/supabase-js";

// Seed/cleanup helper pour tests d'intégration SQL.
//
// Convention : chaque test crée son propre (auth.users + producer) row,
// les nettoie en afterEach. Les RLS sont bypass grâce au service_role
// client (cf. helpers/client.ts).

export type SeededProducer = {
  userId: string;
  producerId: string;
  email: string;
};

export async function seedProducer(
  supabase: SupabaseClient,
  overrides?: Partial<{
    statut: string;
    nom_exploitation: string;
    declaration_indicateurs_snapshot: Record<string, string> | null;
  }>,
): Promise<SeededProducer> {
  // Crée un user auth.users via service_role admin API.
  const email = `t296-${crypto.randomUUID().slice(0, 8)}@test.local`;
  const { data: authData, error: authErr } = await supabase.auth.admin
    .createUser({
      email,
      password: "test-password-T296-pilot",
      email_confirm: true,
    });
  if (authErr || !authData.user) {
    throw new Error(`seedProducer auth.createUser failed: ${authErr?.message}`);
  }
  const userId = authData.user.id;

  // Crée le producer associé.
  const slug = `t296-prod-${crypto.randomUUID().slice(0, 8)}`;
  const { data: prod, error: prodErr } = await supabase
    .from("producers")
    .insert({
      user_id: userId,
      slug,
      statut: overrides?.statut ?? "draft",
      nom_exploitation: overrides?.nom_exploitation ?? "Ferme test T-296",
      declaration_indicateurs_snapshot:
        overrides?.declaration_indicateurs_snapshot ?? null,
    })
    .select("id")
    .single();
  if (prodErr || !prod) {
    throw new Error(`seedProducer producer insert failed: ${prodErr?.message}`);
  }

  return { userId, producerId: prod.id, email };
}

export async function cleanupProducer(
  supabase: SupabaseClient,
  seeded: SeededProducer,
): Promise<void> {
  // ON DELETE CASCADE des FK producers -> auth.users (cf. schema)
  // suffit en théorie, mais on supprime explicitement pour ne pas
  // dépendre du comportement cascade.
  await supabase.from("producers").delete().eq("id", seeded.producerId);
  await supabase.auth.admin.deleteUser(seeded.userId);
}
