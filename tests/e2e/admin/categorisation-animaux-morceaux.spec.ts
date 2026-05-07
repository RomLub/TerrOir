/**
 * E2E admin — /categorisation/animaux + /categorisation/morceaux (T-130).
 *
 * Couvre 3 scenarios liés aux 2 référentiels animals + cuts (cuts est
 * scopé par animal_id, UNIQUE composite (animal_id, slug)) :
 *   1. Liste : pages animaux + morceaux rendent les référentiels avec leur
 *      structure (animaux flat, cuts avec colonne animal).
 *   2. CREATE animal : POST /api/admin/animals → INSERT animals + audit
 *      log admin_animal_created.
 *   3. CREATE cut scopé : POST /api/admin/cuts avec animal_id valide →
 *      INSERT cuts + UNIQUE (animal_id, slug) respectée.
 *
 * Particularités auth admin : pattern local createAdminUser (cf. helper
 * commenté dans categorisation-categories.spec.ts pour la justification
 * vs helper ensurePersistentUser).
 *
 * Cleanup : animals + cuts sont purgés explicitement (pas de cascade
 * depuis users). Audit logs purgés pour éviter pollution forensique.
 */

import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/test-context";
import { generateTestEmail } from "../helpers/guards";
import {
  getRawAdminClient,
  getReadOnlyAdminClient,
  trackRowId,
  trackUserId,
  trackEmail,
  type TestContext,
} from "../helpers/supabase-admin";

const E2E_ANIMAL_PREFIX = "pwtest-animal-";
const E2E_CUT_PREFIX = "pwtest-cut-";
const STRONG_PASSWORD = "Aa1ZZzz9999PpQq";

async function createAdminUser(ctx: TestContext): Promise<{
  id: string;
  email: string;
  password: string;
}> {
  const email = generateTestEmail("anim-admin");
  const admin = getRawAdminClient();
  const { data: created, error: createErr } = await admin.auth.admin.createUser(
    {
      email,
      password: STRONG_PASSWORD,
      email_confirm: true,
    },
  );
  if (createErr || !created.user) {
    throw new Error(`createAdminUser auth.admin.createUser: ${createErr?.message}`);
  }
  trackUserId(ctx, created.user.id);
  trackEmail(ctx, email);

  const { error: insErr } = await admin
    .from("admin_users")
    .insert({ id: created.user.id, email });
  if (insErr) {
    throw new Error(`createAdminUser INSERT admin_users: ${insErr.message}`);
  }
  return { id: created.user.id, email, password: STRONG_PASSWORD };
}

async function cleanupAdminRow(adminUserId: string): Promise<void> {
  const admin = getRawAdminClient();
  await admin.from("admin_users").delete().eq("id", adminUserId);
}

async function loginAsAdmin(
  page: Page,
  user: { email: string; password: string },
): Promise<void> {
  await page.goto("/connexion");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/connexion"), {
    timeout: 15_000,
  });
}

test.describe("Admin — Catégorisation : animaux + morceaux", () => {
  test("liste : pages animaux + morceaux rendent leur structure spécifique", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const adminUser = await createAdminUser(ctx);
    try {
      await loginAsAdmin(page, adminUser);

      // Page animaux : header + bouton "+ Nouvelle espèce".
      await page.goto("/categorisation/animaux");
      await expect(
        page.getByRole("heading", { name: "Espèces animales", exact: true }),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        page.getByRole("button", { name: "+ Nouvelle espèce", exact: true }),
      ).toBeVisible();
      // Colonnes spécifiques animaux : "Produits" ET "Morceaux".
      await expect(page.getByText(/Morceaux/i).first()).toBeVisible();

      // Page morceaux : header + bouton "+ Nouveau morceau" + colonne Animal.
      await page.goto("/categorisation/morceaux");
      await expect(
        page.getByRole("heading", { name: "Morceaux", exact: true }),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        page.getByRole("button", { name: "+ Nouveau morceau", exact: true }),
      ).toBeVisible();
      // Colonne "Animal" propre à cuts (vs animaux qui n'a pas cette colonne).
      await expect(
        page.getByRole("columnheader", { name: "Animal", exact: true }),
      ).toBeVisible();
    } finally {
      await cleanupAdminRow(adminUser.id);
    }
  });

  test("CREATE animal : POST /api/admin/animals → INSERT animals + audit log", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const adminUser = await createAdminUser(ctx);
    let animalId: string | null = null;
    try {
      await loginAsAdmin(page, adminUser);

      const ts = Date.now();
      const slug = `${E2E_ANIMAL_PREFIX}${ts}`;
      const name = `Test Animal ${ts}`;

      const response = await page.request.post("/api/admin/animals", {
        data: { slug, name, sort_order: 9999 },
      });
      expect(response.status(), `body: ${await response.text()}`).toBe(201);
      const body = (await response.json()) as { id: string };
      animalId = body.id;
      trackRowId(ctx, body.id);

      // DB : row insérée
      const ro = getReadOnlyAdminClient();
      const { data: row, error: selectErr } = await ro
        .from("animals")
        .select("id, slug, name, sort_order")
        .eq("id", body.id)
        .maybeSingle();
      expect(selectErr).toBeNull();
      expect(row).not.toBeNull();
      expect(row!.slug).toBe(slug);
      expect(row!.name).toBe(name);
      expect(row!.sort_order).toBe(9999);

      // Audit log admin_animal_created posé.
      const { data: auditLogs } = await ro
        .from("audit_logs")
        .select("event_type, metadata")
        .eq("user_id", adminUser.id)
        .eq("event_type", "admin_animal_created")
        .order("created_at", { ascending: false })
        .limit(20);
      const matching = (auditLogs ?? []).filter(
        (l: { metadata: Record<string, unknown> | null }) =>
          (l.metadata as { id?: string } | null)?.id === body.id,
      );
      expect(matching.length).toBeGreaterThanOrEqual(1);
    } finally {
      const admin = getRawAdminClient();
      await admin
        .from("audit_logs")
        .delete()
        .eq("user_id", adminUser.id)
        .eq("event_type", "admin_animal_created");
      if (animalId) await admin.from("animals").delete().eq("id", animalId);
      await cleanupAdminRow(adminUser.id);
    }
  });

  test("CREATE cut scopé animal_id : POST /api/admin/cuts → INSERT cuts (animal_id, slug) UNIQUE", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(90_000);

    const adminUser = await createAdminUser(ctx);
    let animalId: string | null = null;
    let cutId: string | null = null;

    try {
      await loginAsAdmin(page, adminUser);

      const admin = getRawAdminClient();
      const ts = Date.now();

      // 1. Créer un animal parent (l'API exige un UUID animal_id valide
      //    référençant animals.id, sinon FK error).
      const animalSlug = `${E2E_ANIMAL_PREFIX}parent-${ts}`;
      const animalRes = await page.request.post("/api/admin/animals", {
        data: {
          slug: animalSlug,
          name: `Test Parent Animal ${ts}`,
          sort_order: 9990,
        },
      });
      expect(animalRes.status()).toBe(201);
      const animalBody = (await animalRes.json()) as { id: string };
      animalId = animalBody.id;
      trackRowId(ctx, animalId);

      // 2. Créer un cut scopé sur cet animal_id.
      const cutSlug = `${E2E_CUT_PREFIX}${ts}`;
      const cutName = `Test Cut ${ts}`;
      const cutRes = await page.request.post("/api/admin/cuts", {
        data: {
          animal_id: animalId,
          slug: cutSlug,
          name: cutName,
          sort_order: 9990,
        },
      });
      expect(cutRes.status(), `body: ${await cutRes.text()}`).toBe(201);
      const cutBody = (await cutRes.json()) as { id: string };
      cutId = cutBody.id;
      trackRowId(ctx, cutId);

      // DB : row insérée + scopée animal_id correctement.
      const ro = getReadOnlyAdminClient();
      const { data: row } = await ro
        .from("cuts")
        .select("id, animal_id, slug, name, sort_order")
        .eq("id", cutId)
        .maybeSingle();
      expect(row).not.toBeNull();
      expect(row!.animal_id).toBe(animalId);
      expect(row!.slug).toBe(cutSlug);
      expect(row!.name).toBe(cutName);

      // 3. Conflit attendu : créer un 2e cut avec MÊME animal_id + MÊME slug
      //    → 409 slug_duplicate (UNIQUE composite (animal_id, slug)).
      const dupRes = await page.request.post("/api/admin/cuts", {
        data: {
          animal_id: animalId,
          slug: cutSlug,
          name: `Other Name ${ts}`,
          sort_order: 9991,
        },
      });
      expect(dupRes.status()).toBe(409);
      const dupBody = (await dupRes.json()) as { error: string };
      expect(dupBody.error).toBe("slug_duplicate");
    } finally {
      const admin = getRawAdminClient();
      // Cleanup : cut → animal → audit logs.
      if (cutId) await admin.from("cuts").delete().eq("id", cutId);
      if (animalId) await admin.from("animals").delete().eq("id", animalId);
      await admin
        .from("audit_logs")
        .delete()
        .eq("user_id", adminUser.id)
        .in("event_type", [
          "admin_animal_created",
          "admin_cut_created",
        ]);
      await cleanupAdminRow(adminUser.id);
    }
  });
});
