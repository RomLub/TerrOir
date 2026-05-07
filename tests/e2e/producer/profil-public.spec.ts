/**
 * E2E producer/profil-public — édition profil + floutage GPS T-217.
 *
 * Le repo n'a pas de route /profil — la page d'édition publique
 * producer est /ma-page (cf. app/(producer)/ma-page/). On y édite
 * nom_exploitation, description, etc. Floutage GPS = vérifié au
 * niveau du fetcher fetchPublicProducerBySlug (lib/producers/coords.ts
 * roundCoord 2 décimales).
 *
 * Couverture (2 tests) :
 *   1. /ma-page édite nom_exploitation + description → DB.producers
 *      reflète les nouvelles valeurs après "Enregistrer".
 *   2. Floutage GPS T-217 : seed un producer avec lat/lng précis (6+
 *      décimales), demande la fiche publique /producteurs/{slug}, vérifie
 *      via fetcher que les coords retournées sont arrondies à 2 décimales
 *      (~1.1 km de flou). Assertion via lib/producers/fetch-public.ts
 *      directement (le HTML public n'expose pas brut les coords).
 */

import { test, expect } from "../helpers/test-context";
import { seedProducer } from "../helpers/db-seed";
import { loginAs } from "../helpers/user-lifecycle";
import { getRawAdminClient, getReadOnlyAdminClient } from "../helpers/supabase-admin";

test.describe("Producer — Profil public (/ma-page + floutage GPS)", () => {
  test("édite nom_exploitation + description → DB updated", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const producer = await seedProducer(ctx, {
      suffix: "profil-edit",
      statut: "public",
      nomExploitation: "Old Name Initial",
    });

    await loginAs(page, producer.user);
    await page.goto("/ma-page");

    // Tab "Modifier" pour accéder au formulaire (par défaut "Prévisualisation"
    // est actif — cf. ma-page/page.tsx:308 useState<Tab>('preview')).
    await page
      .getByRole("button", { name: "Modifier", exact: true })
      .click();

    // Patch nom_exploitation + description.
    const newName = `Test Ferme ${Date.now()}`;
    const newDescription =
      "Description test playwright e2e (production de viande Sarthe).";

    const nomInput = page.getByLabel(/Nom de l'exploitation/i);
    await nomInput.fill(newName);

    const descInput = page.getByLabel(/Description courte/i);
    await descInput.fill(newDescription);

    await page
      .getByRole("button", { name: /Enregistrer/i })
      .click();

    // Marqueur UI succès "✓ Modifications enregistrées." (cf.
    // ma-page/page.tsx:469).
    await expect(
      page.getByText(/Modifications enregistrées/i),
    ).toBeVisible({ timeout: 15_000 });

    // Vérif DB.
    const admin = getReadOnlyAdminClient();
    const { data: row } = await admin
      .from("producers")
      .select("nom_exploitation, description")
      .eq("id", producer.producerId)
      .single();
    expect(row?.nom_exploitation).toBe(newName);
    expect(row?.description).toBe(newDescription);
  });

  test("floutage GPS T-217 : /api/producers/search arrondit lat/lng à 2 décimales", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const producer = await seedProducer(ctx, {
      suffix: "profil-gps",
      statut: "public",
    });

    // Pose des coordonnées précises (>2 décimales) directement en DB
    // via service_role (le trigger producers_block_owner_admin_columns
    // T-218-bis bloque le self-update lat/lng — service_role bypass).
    // Coords ferme fictive Sarthe : 47.998837, 0.198724 (Le Mans
    // approximatif). Aussi ajout statut producer requirements complets
    // pour passer les filtres minimaux de search_producers (ce serveur
    // RPC peut écarter des producers avec champs manquants).
    const admin = getRawAdminClient();
    const PRECISE_LAT = 47.998837;
    const PRECISE_LNG = 0.198724;
    const expectedLat = Math.round(PRECISE_LAT * 100) / 100; // 48
    const expectedLng = Math.round(PRECISE_LNG * 100) / 100; // 0.2

    await admin
      .from("producers")
      .update({
        latitude: PRECISE_LAT,
        longitude: PRECISE_LNG,
      })
      .eq("id", producer.producerId);

    // Vérif DB : les valeurs précises sont bien posées (sanity check
    // pour distinguer un échec de seed d'un échec de floutage).
    const { data: rawRow } = await admin
      .from("producers")
      .select("latitude, longitude")
      .eq("id", producer.producerId)
      .single();
    expect(Number(rawRow?.latitude)).toBeCloseTo(PRECISE_LAT, 5);
    expect(Number(rawRow?.longitude)).toBeCloseTo(PRECISE_LNG, 5);

    // Recherche via /api/producers/search dans un grand rayon centré
    // sur le producer ; le filtrage se fait par RPC search_producers
    // côté serveur (rayon Haversine sur coords brutes en DB, mais la
    // réponse renvoie coords floutées — cf. roundCoord call site dans
    // app/api/producers/search/route.ts).
    const res = await page.request.get(
      `/api/producers/search?lat=${PRECISE_LAT}&lng=${PRECISE_LNG}&radius=10`,
    );
    expect(res.status()).toBe(200);
    const body = await res.json();

    // Trouve notre producer dans le payload (par id).
    type ProducerHit = {
      id: string;
      latitude: number | null;
      longitude: number | null;
    };
    const producers = (body.producers ?? body.results ?? body) as ProducerHit[];
    const arr = Array.isArray(producers) ? producers : [];
    const hit = arr.find((p) => p.id === producer.producerId);
    expect(
      hit,
      `Producer seedé absent de /api/producers/search (résultats=${arr.length})`,
    ).toBeDefined();

    // Garantie floutage : roundCoord 2 décimales appliqué.
    expect(hit!.latitude).toBe(expectedLat);
    expect(hit!.longitude).toBe(expectedLng);

    // Garantie structurelle : pas plus de 2 décimales sur les coords
    // exposées publiquement (anti-régression T-217).
    const latDecimals = (hit!.latitude!.toString().split(".")[1] ?? "")
      .length;
    const lngDecimals = (hit!.longitude!.toString().split(".")[1] ?? "")
      .length;
    expect(latDecimals).toBeLessThanOrEqual(2);
    expect(lngDecimals).toBeLessThanOrEqual(2);
  });
});
