// Tests d'intégration SQL — chantier 3 (Leads + demande de publication).
//
// Couvre la logique métier nouvelle qui vit dans le SQL (non testable par
// mocks Vitest) :
//   1. RPC request_publication : vérification des 6 critères côté serveur,
//      pose de publication_requested_at uniquement si tout est OK.
//   2. producer_interests : CHECK current_step ∈ [1..6] + unicité prefill_token.
//   3. producer_interest_followups : CHECK channel/direction + RLS admin-only.
//
// Pré-requis : `npx supabase start`. Sans instance locale, la suite est
// skippée proprement (cf. helpers/client.ts).

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  getSqlIntegrationClient,
  isLocalSupabaseReachable,
} from "./helpers/client";
import {
  seedProducer,
  cleanupProducer,
  type SeededProducer,
} from "./helpers/seed";
import {
  seedAuthenticatedProducer,
  cleanupAuthenticatedProducerSession,
  type AuthenticatedProducerSession,
} from "./helpers/seed-authenticated-producer";

const SUPABASE = getSqlIntegrationClient();

const reachable = await isLocalSupabaseReachable();
const describeIfLocal = reachable ? describe : describe.skip;

// Rend un producteur "publiable" : remplit les 6 critères via service_role.
async function makeProducerPublishable(seeded: SeededProducer): Promise<void> {
  await SUPABASE.from("producers")
    .update({
      description: "x".repeat(160), // ≥ 150 caractères
      photo_principale: "https://example.test/hero.jpg",
      commune: "Le Mans",
      code_postal: "72000",
      stripe_charges_enabled: true,
    })
    .eq("id", seeded.producerId);

  const now = Date.now();
  await SUPABASE.from("products").insert({
    producer_id: seeded.producerId,
    nom: "Entrecôte test",
    prix: 25,
    active: true,
    photos: ["https://example.test/product.jpg"],
  });
  await SUPABASE.from("slots").insert({
    producer_id: seeded.producerId,
    starts_at: new Date(now + 86400000).toISOString(),
    ends_at: new Date(now + 90000000).toISOString(),
    capacity_per_slot: 5,
    active: true,
    excluded_at: null,
  });
}

async function cleanupProducerChildren(producerId: string): Promise<void> {
  await SUPABASE.from("slots").delete().eq("producer_id", producerId);
  await SUPABASE.from("products").delete().eq("producer_id", producerId);
}

describeIfLocal("request_publication (RPC SECDEF — critères de publication)", () => {
  let seeded: SeededProducer;

  beforeAll(() => {
    if (!reachable) {
      console.warn(
        "[sql-it] Supabase locale non joignable, tests SQL skippés. " +
          "Lance `npx supabase start` pour exécuter la suite.",
      );
    }
  });

  afterEach(async () => {
    if (seeded) {
      await cleanupProducerChildren(seeded.producerId);
      await cleanupProducer(SUPABASE, seeded);
    }
  });

  it("producteur incomplet ⇒ ok:false + liste exhaustive des critères manquants", async () => {
    seeded = await seedProducer(SUPABASE, { statut: "pending" });

    const { data, error } = await SUPABASE.rpc("request_publication", {
      p_user_id: seeded.userId,
    });
    expect(error).toBeNull();
    expect(data.ok).toBe(false);
    expect(data.missing).toEqual(
      expect.arrayContaining([
        "description",
        "photo_principale",
        "localisation",
        "stripe",
        "product_with_photo",
        "open_slot",
      ]),
    );

    // Aucune date posée tant que les critères ne sont pas remplis.
    const { data: prod } = await SUPABASE.from("producers")
      .select("publication_requested_at")
      .eq("id", seeded.producerId)
      .single();
    expect(prod?.publication_requested_at).toBeNull();
  });

  it("producteur complet ⇒ ok:true + publication_requested_at posée", async () => {
    seeded = await seedProducer(SUPABASE, { statut: "pending" });
    await makeProducerPublishable(seeded);

    const { data, error } = await SUPABASE.rpc("request_publication", {
      p_user_id: seeded.userId,
    });
    expect(error).toBeNull();
    expect(data.ok).toBe(true);
    expect(data.publication_requested_at).toBeTruthy();

    const { data: prod } = await SUPABASE.from("producers")
      .select("publication_requested_at")
      .eq("id", seeded.producerId)
      .single();
    expect(prod?.publication_requested_at).not.toBeNull();
  });

  it("ré-appel idempotent : ne réécrit pas la date déjà posée", async () => {
    seeded = await seedProducer(SUPABASE, { statut: "pending" });
    await makeProducerPublishable(seeded);

    const { data: first } = await SUPABASE.rpc("request_publication", {
      p_user_id: seeded.userId,
    });
    const { data: second } = await SUPABASE.rpc("request_publication", {
      p_user_id: seeded.userId,
    });
    expect(first.publication_requested_at).toBe(second.publication_requested_at);
  });

  it("producteur supprimé/suspendu ⇒ ok:false blocked (jamais de demande)", async () => {
    seeded = await seedProducer(SUPABASE, { statut: "suspended" });
    await makeProducerPublishable(seeded);

    const { data, error } = await SUPABASE.rpc("request_publication", {
      p_user_id: seeded.userId,
    });
    expect(error).toBeNull();
    expect(data.ok).toBe(false);
    expect(data.blocked).toBe("suspended");
  });
});

describeIfLocal("producer_interests — contraintes chantier 3", () => {
  const created: string[] = [];

  afterEach(async () => {
    for (const id of created.splice(0)) {
      await SUPABASE.from("producer_interests").delete().eq("id", id);
    }
  });

  it("current_step hors [1..6] ⇒ rejet CHECK", async () => {
    const { error } = await SUPABASE.from("producer_interests").insert({
      nom: "Test",
      email: `chantier3-${crypto.randomUUID().slice(0, 8)}@test.local`,
      current_step: 7,
    });
    expect(error).not.toBeNull();
  });

  it("current_step valide ⇒ OK", async () => {
    const { data, error } = await SUPABASE.from("producer_interests")
      .insert({
        nom: "Test",
        email: `chantier3-${crypto.randomUUID().slice(0, 8)}@test.local`,
        current_step: 3,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    if (data?.id) created.push(data.id);
  });

  it("prefill_token unique ⇒ doublon rejeté", async () => {
    const token = `tok-${crypto.randomUUID()}`;
    const { data: a, error: e1 } = await SUPABASE.from("producer_interests")
      .insert({
        nom: "A",
        email: `c3a-${crypto.randomUUID().slice(0, 8)}@test.local`,
        prefill_token: token,
      })
      .select("id")
      .single();
    expect(e1).toBeNull();
    if (a?.id) created.push(a.id);

    const { error: e2 } = await SUPABASE.from("producer_interests").insert({
      nom: "B",
      email: `c3b-${crypto.randomUUID().slice(0, 8)}@test.local`,
      prefill_token: token,
    });
    expect(e2).not.toBeNull();
  });
});

describeIfLocal("producer_interest_followups — CHECK + RLS", () => {
  let lead: { id: string } | null = null;
  let prodSession: AuthenticatedProducerSession | null = null;

  afterEach(async () => {
    if (prodSession) {
      await cleanupAuthenticatedProducerSession(SUPABASE, prodSession);
      prodSession = null;
    }
    if (lead) {
      await SUPABASE.from("producer_interest_followups")
        .delete()
        .eq("lead_id", lead.id);
      await SUPABASE.from("producer_interests").delete().eq("id", lead.id);
      lead = null;
    }
  });

  async function seedLead(): Promise<{ id: string }> {
    const { data } = await SUPABASE.from("producer_interests")
      .insert({
        nom: "Lead",
        email: `c3lead-${crypto.randomUUID().slice(0, 8)}@test.local`,
      })
      .select("id")
      .single();
    return { id: data!.id as string };
  }

  it("channel invalide ⇒ rejet CHECK", async () => {
    lead = await seedLead();
    const { error } = await SUPABASE.from("producer_interest_followups").insert({
      lead_id: lead.id,
      channel: "telepathy",
      direction: "outbound",
    });
    expect(error).not.toBeNull();
  });

  it("followup valide (service_role) ⇒ OK", async () => {
    lead = await seedLead();
    const { error } = await SUPABASE.from("producer_interest_followups").insert({
      lead_id: lead.id,
      channel: "email",
      direction: "outbound",
      is_automatic: true,
      relance_step: 1,
    });
    expect(error).toBeNull();
  });

  it("RLS : un producteur authentifié non-admin ne lit pas les followups", async () => {
    lead = await seedLead();
    await SUPABASE.from("producer_interest_followups").insert({
      lead_id: lead.id,
      channel: "email",
      direction: "outbound",
    });

    prodSession = await seedAuthenticatedProducer(SUPABASE);
    const { data } = await prodSession.client
      .from("producer_interest_followups")
      .select("id")
      .eq("lead_id", lead.id);
    // RLS admin-only : un producteur ne voit rien.
    expect(data ?? []).toHaveLength(0);
  });
});
