import { test, expect } from "@playwright/test";

// T-200 — Smoke fiche producteur publique : le bloc "Score carbone & bien-être"
// est rendu, le DistanceWidget affiche son état d'invitation au mount, et le
// fallback code postal calcule bien une distance via api-adresse.data.gouv.fr.
// Cible le seul producteur public avec lat/lng en prod (Maraîchage des Alpes
// Mancelles, slug `alpes-mancelles`).

const PUBLIC_SLUG = "alpes-mancelles";

test("T-200 fiche producteur : bloc démarche présent et widget distance fonctionnel", async ({
  page,
}) => {
  await page.goto(`/producteurs/${PUBLIC_SLUG}`);

  const block = page.locator("section#demarche");
  await expect(block).toBeVisible();
  await expect(block.getByText("Notre démarche")).toBeVisible();
  await expect(block.getByRole("heading", { name: /au plus près/i })).toBeVisible();

  const inviteCopy = block.getByText(/Indique ta position pour voir la distance/i);
  await expect(inviteCopy).toBeVisible();

  // Mention RGPD (art. 13) au point de collecte — décision comité T-200 round 1.
  await expect(
    block.getByText(/Ta position reste dans ton navigateur/i),
  ).toBeVisible();

  const geolocBtn = block.getByRole("button", { name: /utiliser ma position/i });
  await expect(geolocBtn).toBeVisible();

  const cpInput = block.getByPlaceholder("Code postal");
  await expect(cpInput).toBeVisible();
  await cpInput.fill("75001");
  await block.getByRole("button", { name: /^OK$/ }).click();

  await expect(block.getByText(/à vol d'oiseau jusqu'à toi depuis/)).toBeVisible({
    timeout: 10_000,
  });
  await expect(block.getByText(/en moyenne en circuit long/i)).toBeVisible();
  // Source ADEME affichée à côté du chiffre 1500 km — décision comité T-200 round 1.
  await expect(block.getByText(/source\s*:\s*ad[eé]me/i)).toBeVisible();
  await expect(
    block.getByRole("button", { name: /changer ma position/i }),
  ).toBeVisible();
});
