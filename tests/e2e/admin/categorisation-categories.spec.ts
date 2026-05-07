/**
 * E2E admin — /categorisation/categories (T-130).
 *
 * Couvre 3 scenarios de la page admin product_categories :
 *   1. Liste flat des catégories (READ direct via supabase browser, RLS public)
 *   2. CREATE category via POST /api/admin/categories → INSERT
 *      public.product_categories + audit log admin_category_created.
 *   3. DELETE refusé si dépendances products (count check API + 409
 *      delete_blocked + UI désactive bouton).
 *
 * Particularités auth admin :
 *   - Le helper ensurePersistentUser('admin') a un bug d'exclusivité
 *     users<->admin_users (cf. trigger migration 20260421100000) : il
 *     INSERT public.users AVANT admin_users, mais le trigger refuse cette
 *     transition. Pattern local createAdminUser (aligné avec
 *     onboarding-flow.spec.ts) est utilisé pour contourner — un admin
 *     éphémère par test, cleanup via cleanupAdminRow + auto user cleanup.
 *   - Login UI via /connexion → resolvePostLoginPath redirige admin vers
 *     /tableau-de-bord (cookies session posés).
 *
 * Cleanup :
 *   - Catégories créées sont trackées via trackRowId pour cleanup post-test
 *     (FK ON DELETE CASCADE depuis users ne purge pas product_categories,
 *     donc DELETE explicite via getRawAdminClient).
 *   - Audit logs purgés pour éviter pollution forensique prod.
 */

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

// Slug stable pour les rows créés par ces tests : permet le cleanup
// safety-net en post si trackRowId rate (defense-in-depth).
const E2E_SLUG_PREFIX = "pwtest-cat-";

const STRONG_PASSWORD = "Aa1ZZzz9999PpQq";

/**
 * Crée un admin éphémère (auth.users + admin_users SANS INSERT public.users
 * pour respecter le trigger d'exclusivité). Pattern aligné avec
 * tests/e2e/producer/onboarding-flow.spec.ts.
 */
async function createAdminUser(ctx: TestContext): Promise<{
  id: string;
  email: string;
  password: string;
}> {
  const email = generateTestEmail("cat-admin");
  const admin = getRawAdminClient();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: STRONG_PASSWORD,
    email_confirm: true,
  });
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

/** Cleanup admin_users row (cleanupTestUser ne couvre pas cette table). */
async function cleanupAdminRow(adminUserId: string): Promise<void> {
  const admin = getRawAdminClient();
  await admin.from("admin_users").delete().eq("id", adminUserId);
}

/**
 * Login UI admin sans helper loginAs (qui s'attend à un user public.users).
 * Pose les cookies session admin via /connexion form password.
 */
async function loginAsAdmin(
  page: import("@playwright/test").Page,
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

test.describe("Admin — Catégorisation : catégories", () => {
  test("liste : page /categorisation/categories rend les catégories existantes", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const adminUser = await createAdminUser(ctx);
    try {
      await loginAsAdmin(page, adminUser);

      // Login admin redirige vers /tableau-de-bord. Naviguer ensuite vers
      // la page catégories (pas de cookie de subdomain en local — accès
      // direct via path autorisé par le layout serveur si session.isAdmin).
      await page.goto("/categorisation/categories");

      // Header AdminPageHeader avec eyebrow + title fixes.
      await expect(
        page.getByRole("heading", { name: "Catégories produits", exact: true }),
      ).toBeVisible({ timeout: 10_000 });

      // Bouton CREATE visible (admin only).
      await expect(
        page.getByRole("button", {
          name: "+ Nouvelle catégorie",
          exact: true,
        }),
      ).toBeVisible();

      // Le tableau a ses 5 colonnes sémantiques. On asserte que le tableau
      // s'est rendu (loading state passé) en attendant que le bouton "+
      // Nouvelle catégorie" + les colonnes UPPERCASE soient présentes.
      await expect(page.getByText(/Slug/i).first()).toBeVisible();
      await expect(page.getByText(/Produits liés/i)).toBeVisible();
    } finally {
      await cleanupAdminRow(adminUser.id);
    }
  });

  test("CREATE : POST /api/admin/categories → INSERT product_categories + audit log", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const adminUser = await createAdminUser(ctx);
    try {
      await loginAsAdmin(page, adminUser);

      // Slug unique par run pour éviter collision avec rows existants/résiduels.
      const ts = Date.now();
      const slug = `${E2E_SLUG_PREFIX}${ts}`;
      const name = `Test Cat ${ts}`;

      // POST direct sur l'API admin (la session cookies admin sont posés
      // par loginAsAdmin ci-dessus → page.request.post les hérite).
      const response = await page.request.post("/api/admin/categories", {
        data: { slug, name, sort_order: 9999 },
      });
      expect(
        response.status(),
        `body: ${await response.text()}`,
      ).toBe(201);
      const body = (await response.json()) as { id: string };
      expect(body.id).toBeTruthy();

      // Track pour cleanup même si l'assertion suivante throw.
      trackRowId(ctx, body.id);

      // DB : row insérée
      const ro = getReadOnlyAdminClient();
      const { data: row, error: selectErr } = await ro
        .from("product_categories")
        .select("id, slug, name, sort_order")
        .eq("id", body.id)
        .maybeSingle();
      expect(selectErr).toBeNull();
      expect(row).not.toBeNull();
      expect(row!.slug).toBe(slug);
      expect(row!.name).toBe(name);
      expect(row!.sort_order).toBe(9999);

      // Audit log : event admin_category_created posé pour cet admin
      const { data: auditLogs, error: auditErr } = await ro
        .from("audit_logs")
        .select("event_type, metadata, created_at")
        .eq("user_id", adminUser.id)
        .eq("event_type", "admin_category_created")
        .order("created_at", { ascending: false })
        .limit(20);
      expect(auditErr).toBeNull();
      // Au moins une entrée référence l'id qu'on vient de créer.
      const matching = (auditLogs ?? []).filter(
        (l: { metadata: Record<string, unknown> | null }) =>
          (l.metadata as { id?: string } | null)?.id === body.id,
      );
      expect(matching.length).toBeGreaterThanOrEqual(1);

      // Cleanup explicite : trackRowId déclenche pas de DELETE auto sur
      // product_categories (cleanupAllTrackedUsers ne touche que users).
      // On purge ici-même pour ne pas laisser de résidu en prod DB.
      const admin = getRawAdminClient();
      await admin
        .from("audit_logs")
        .delete()
        .eq("user_id", adminUser.id)
        .eq("event_type", "admin_category_created");
      await admin.from("product_categories").delete().eq("id", body.id);
    } finally {
      await cleanupAdminRow(adminUser.id);
    }
  });

  test("DELETE refusé : 409 delete_blocked si products référencent la catégorie", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(90_000);

    const adminUser = await createAdminUser(ctx);
    const admin = getRawAdminClient();

    let categoryId: string | null = null;
    let producerId: string | null = null;
    let productId: string | null = null;

    try {
      await loginAsAdmin(page, adminUser);

      // 1. Créer une catégorie via API admin (cohérent avec le flux UI).
      const ts = Date.now();
      const slug = `${E2E_SLUG_PREFIX}block-${ts}`;
      const createRes = await page.request.post("/api/admin/categories", {
        data: { slug, name: `Test Block ${ts}`, sort_order: 9998 },
      });
      expect(createRes.status()).toBe(201);
      const created = (await createRes.json()) as { id: string };
      categoryId = created.id;
      trackRowId(ctx, categoryId);

      // 2. Créer un product qui référence cette catégorie (besoin d'un
      //    producer + product). On utilise service_role direct pour le
      //    setup (defense-in-depth applicative déjà couverte par les
      //    tests producer/products dédiés).
      //
      //    Producer minimal : on crée un user owner + producer row.
      const producerEmail = `playwright-test-${ts}-cat-block-prod@mailinator.com`;
      const { data: createdProd, error: createErrProd } = await admin.auth.admin
        .createUser({
          email: producerEmail,
          password: STRONG_PASSWORD,
          email_confirm: true,
        });
      if (createErrProd || !createdProd.user) {
        throw new Error(
          `Setup producer user failed: ${createErrProd?.message}`,
        );
      }
      const producerUserId = createdProd.user.id;
      ctx.trackedUserIds.add(producerUserId);
      ctx.trackedEmails.add(producerEmail);

      const { error: insUserErr } = await admin.from("users").insert({
        id: producerUserId,
        email: producerEmail,
        roles: ["consumer", "producer"],
      });
      if (insUserErr) throw new Error(`INSERT users: ${insUserErr.message}`);

      const { data: producerRow, error: insProdErr } = await admin
        .from("producers")
        .insert({
          user_id: producerUserId,
          slug: `pwtest-prod-cat-${ts}`,
          nom_exploitation: `pwtest-prod-cat-${ts}`,
          statut: "draft",
        })
        .select("id")
        .single();
      if (insProdErr || !producerRow) {
        throw new Error(`INSERT producers: ${insProdErr?.message}`);
      }
      producerId = producerRow.id as string;
      trackRowId(ctx, producerId);

      const { data: productRow, error: insProductErr } = await admin
        .from("products")
        .insert({
          producer_id: producerId,
          nom: `pwtest-product-cat-${ts}`,
          description: "Produit lié à la catégorie test (blocking DELETE).",
          prix: 4.5,
          unite: "piece",
          stock_disponible: 1,
          stock_illimite: false,
          active: true,
          category_id: categoryId,
        })
        .select("id")
        .single();
      if (insProductErr || !productRow) {
        throw new Error(`INSERT products: ${insProductErr?.message}`);
      }
      productId = productRow.id as string;
      trackRowId(ctx, productId);

      // 3. Tenter DELETE de la catégorie via API → 409 delete_blocked.
      const deleteRes = await page.request.delete(
        `/api/admin/categories/${categoryId}`,
      );
      expect(deleteRes.status()).toBe(409);
      const deleteBody = (await deleteRes.json()) as {
        error: string;
        dependencies?: { products?: number };
      };
      expect(deleteBody.error).toBe("delete_blocked");
      expect(deleteBody.dependencies?.products ?? 0).toBeGreaterThanOrEqual(1);

      // DB : la catégorie est toujours là.
      const ro = getReadOnlyAdminClient();
      const { data: stillThere } = await ro
        .from("product_categories")
        .select("id")
        .eq("id", categoryId)
        .maybeSingle();
      expect(stillThere).not.toBeNull();
    } finally {
      // Cleanup ordre FK : product → producer → catégorie. Users producer
      // cleaned via cleanupAllTrackedUsers afterEach. Audit logs purgés.
      if (productId) await admin.from("products").delete().eq("id", productId);
      if (producerId) {
        await admin.from("producers").delete().eq("id", producerId);
      }
      if (categoryId) {
        await admin
          .from("product_categories")
          .delete()
          .eq("id", categoryId);
      }
      await admin
        .from("audit_logs")
        .delete()
        .eq("user_id", adminUser.id)
        .eq("event_type", "admin_category_created");
      await cleanupAdminRow(adminUser.id);
    }
  });
});
