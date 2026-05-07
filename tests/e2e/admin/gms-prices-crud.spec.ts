/**
 * E2E admin — /gms-prices workflow mensuel (Phase B "Notre démarche").
 *
 * Couvre 1 test sur le workflow le plus métier (mise à jour mensuelle =
 * UPDATE live + INSERT history avec updated_by=admin) :
 *
 *   POST /api/admin/gms-prices/[id]/update-prices →
 *     - UPDATE gms_prices (prix_gms_kg, prix_terroir_kg_*, mois_reference,
 *       source, source_url, updated_by=admin user_id)
 *     - INSERT gms_prices_history (snapshot mensuel, FK reference_id, UNIQUE
 *       (reference_id, mois_reference))
 *
 * Particularités auth admin : pattern local createAdminUser (aligné
 * onboarding-flow.spec.ts) — le helper ensurePersistentUser('admin') a un
 * conflit avec le trigger d'exclusivité users<->admin_users (cf.
 * categorisation-categories.spec.ts pour la justification détaillée).
 *
 * Cleanup : reference + history + audit log purgés en post.
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

const E2E_PREFIX = "pwtest-gms-";
const STRONG_PASSWORD = "Aa1ZZzz9999PpQq";

async function createAdminUser(ctx: TestContext): Promise<{
  id: string;
  email: string;
  password: string;
}> {
  const email = generateTestEmail("gms-admin");
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

test.describe("Admin — Prix GMS : workflow mensuel CRUD", () => {
  test("update-prices : UPDATE live + INSERT history + updated_by=admin", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(90_000);

    const adminUser = await createAdminUser(ctx);
    let gmsPriceId: string | null = null;

    try {
      await loginAsAdmin(page, adminUser);

      const ts = Date.now();
      const slug = `${E2E_PREFIX}${ts}`;

      // 1. Setup : créer une référence GMS via POST /api/admin/gms-prices
      //    (cohérent avec le flux UI, valide la chain auth admin).
      const createRes = await page.request.post("/api/admin/gms-prices", {
        data: {
          slug,
          filiere: "bovin",
          libelle: `Test GMS ${ts}`,
          description_courte: null,
          prix_gms_kg: 18.5,
          prix_terroir_kg_min: 16.0,
          prix_terroir_kg_max: 22.0,
          prix_terroir_kg_moyen: 19.0,
          mois_reference: "2026-04",
          source: "Playwright E2E",
          source_url: null,
          ordre_affichage: 9999,
          notes_admin: null,
        },
      });
      expect(
        createRes.status(),
        `body: ${await createRes.text()}`,
      ).toBe(201);
      const createdBody = (await createRes.json()) as { id: string };
      gmsPriceId = createdBody.id;
      trackRowId(ctx, gmsPriceId);

      // 2. POST /update-prices : workflow mensuel (mois suivant) →
      //    UPDATE live + INSERT history.
      const updateRes = await page.request.post(
        `/api/admin/gms-prices/${gmsPriceId}/update-prices`,
        {
          data: {
            prix_gms_kg: 19.25,
            prix_terroir_kg_min: 16.5,
            prix_terroir_kg_max: 22.5,
            prix_terroir_kg_moyen: 19.5,
            mois_reference: "2026-05",
            source: "Playwright E2E v2",
            source_url: null,
          },
        },
      );
      expect(
        updateRes.status(),
        `body: ${await updateRes.text()}`,
      ).toBe(200);
      const updateBody = (await updateRes.json()) as {
        id: string;
        history_recorded: boolean;
      };
      expect(updateBody.id).toBe(gmsPriceId);
      expect(updateBody.history_recorded).toBe(true);

      // 3. DB : live row mise à jour
      const ro = getReadOnlyAdminClient();
      const { data: live } = await ro
        .from("gms_prices")
        .select(
          "prix_gms_kg, prix_terroir_kg_moyen, mois_reference, source, updated_by",
        )
        .eq("id", gmsPriceId)
        .maybeSingle();
      expect(live).not.toBeNull();
      expect(Number(live!.prix_gms_kg)).toBeCloseTo(19.25, 2);
      expect(Number(live!.prix_terroir_kg_moyen)).toBeCloseTo(19.5, 2);
      expect(live!.mois_reference).toBe("2026-05");
      expect(live!.source).toBe("Playwright E2E v2");
      // Traçabilité éditoriale T-Phase-B : updated_by = admin user_id
      expect(live!.updated_by).toBe(adminUser.id);

      // 4. DB : history a 1 row avec mois_reference '2026-05' (le INSERT
      //    history est posé par recordMonthlyUpdate, pas par createGmsPrice).
      const { data: history } = await ro
        .from("gms_prices_history")
        .select("reference_id, prix_gms_kg, mois_reference, source")
        .eq("reference_id", gmsPriceId)
        .order("mois_reference", { ascending: false });
      expect(history?.length ?? 0).toBeGreaterThanOrEqual(1);
      const may = (history ?? []).find((h) => h.mois_reference === "2026-05");
      expect(may).toBeTruthy();
      expect(Number(may!.prix_gms_kg)).toBeCloseTo(19.25, 2);
      expect(may!.source).toBe("Playwright E2E v2");
    } finally {
      const admin = getRawAdminClient();
      // history cascade-delete via FK ON DELETE CASCADE depuis gms_prices,
      // donc DELETE de la reference suffit.
      if (gmsPriceId) {
        await admin.from("gms_prices").delete().eq("id", gmsPriceId);
      }
      await cleanupAdminRow(adminUser.id);
    }
  });
});
