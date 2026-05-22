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

  // INSERT miroir public.users (FK producers.user_id → public.users(id)).
  // Pas de trigger auto-INSERT auth.users→public.users dans TerrOir : le
  // flow normal passe par accept-invitation / login-and-upgrade server
  // actions qui INSERT explicitement. En test on simule via service_role.
  // Roles cumulatives : consumer + producer (doctrine TerrOir, cohérent
  // avec le pattern helpers/auth.ts).
  const { error: pubErr } = await supabase.from("users").insert({
    id: userId,
    email,
    roles: ["consumer", "producer"],
  });
  if (pubErr) {
    // Rollback auth.users si l'INSERT miroir échoue (sinon le row reste
    // orphelin et bloque les retests avec le même email).
    await supabase.auth.admin.deleteUser(userId);
    throw new Error(
      `seedProducer public.users insert failed: ${pubErr.message}`,
    );
  }

  // Crée le producer associé.
  const slug = `t296-prod-${crypto.randomUUID().slice(0, 8)}`;
  const { data: prod, error: prodErr } = await supabase
    .from("producers")
    .insert({
      user_id: userId,
      slug,
      statut: overrides?.statut ?? "draft",
      nom_exploitation: overrides?.nom_exploitation ?? "Ferme test T-296",
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
  // Cleanup explicite ordre inverse de l'INSERT : producers → public.users →
  // auth.users. CASCADE existe mais on ne s'en remet pas pour la lisibilité
  // forensique en cas de crash partiel.
  await supabase.from("producers").delete().eq("id", seeded.producerId);
  await supabase.from("users").delete().eq("id", seeded.userId);
  await supabase.auth.admin.deleteUser(seeded.userId);
}
