import { test, expect } from "@playwright/test";

// T-200 — Smoke fiche producteur publique : le bloc "Score carbone & bien-être"
// est rendu, le DistanceWidget affiche son état d'invitation au mount, et le
// fallback code postal calcule bien une distance via api-adresse.data.gouv.fr.
// Cible le seul producteur public avec lat/lng en prod (Maraîchage des Alpes
// Mancelles, slug `alpes-mancelles`).

const PUBLIC_SLUG = "alpes-mancelles";

// Verrou r1 T-239+T-240 : on injecte un clear sessionStorage avant tout
// script de la page (init script Playwright = exécuté avant chaque
// document de la session). Sans ça, si le test était relancé dans un
// contexte avec une session pré-existante, le label compact deviendrait
// « 12 km à vol d'oiseau » au lieu de « Voir la distance jusqu'à toi »
// et le test passerait pour les mauvaises raisons (assertion sur le mauvais
// état initial).
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try {
      window.sessionStorage.clear();
    } catch {
      // mode privé / quotas : on ignore, le test démarre sans session de toute façon.
    }
  });
});

test("T-200 fiche producteur : bloc démarche présent et widget distance fonctionnel", async ({
  page,
}) => {
  await page.goto(`/producteurs/${PUBLIC_SLUG}`);

  // Verrou r2 T-239 : ordre d'apparition des sections dans le DOM. Le placement
  // du bloc Démarche en bas de page est l'objectif central de T-239 ; un test
  // d'ordre prévient une régression silencieuse si quelqu'un remonte la section
  // sans s'en rendre compte. On compare la position Y absolue de chaque section
  // pour ne pas dépendre de l'ordre exact des nœuds DOM (qui peut varier avec
  // un wrapper futur).
  const sectionOrder = await page.evaluate(() => {
    const ids = ["histoire", "produits", "avis", "demarche"];
    return ids.map((id) => {
      const el = document.getElementById(id);
      return { id, top: el?.getBoundingClientRect().top ?? null };
    });
  });
  expect(sectionOrder.every((s) => s.top !== null)).toBe(true);
  const tops = sectionOrder.map((s) => s.top as number);
  expect(tops[0]).toBeLessThan(tops[1]); // histoire < produits
  expect(tops[1]).toBeLessThan(tops[2]); // produits < avis
  expect(tops[2]).toBeLessThan(tops[3]); // avis < demarche

  const block = page.locator("section#demarche");
  await expect(block).toBeVisible();
  await expect(block.getByText("Notre démarche")).toBeVisible();
  await expect(block.getByRole("heading", { name: /au plus près/i })).toBeVisible();

  // T-240 : le widget distance est replié par défaut. État initial = un
  // bouton compact, le contenu détaillé (invite, géoloc, CP, RGPD) n'est
  // monté qu'après clic sur ce bouton.
  const expandBtn = block.getByRole("button", {
    name: /voir la distance jusqu'à toi/i,
  });
  await expect(expandBtn).toBeVisible();
  await expandBtn.click();

  // Amorce engageante personnalisée avec le nom du producteur — décision
  // comité T-200 round 2 (amorce non-générique).
  const inviteCopy = block.getByText(
    /Indique ta position pour découvrir la distance à vol d'oiseau/i,
  );
  await expect(inviteCopy).toBeVisible();

  // Mention RGPD au point de collecte (art. 13 RGPD) — wording r4 : finalité +
  // facultatif + durée + sous-traitant tiers nommé. Le renvoi politique de
  // confidentialité est retiré tant que la page n'existe pas (T-207).
  await expect(
    block.getByText(/uniquement pour calculer la distance jusqu'à la ferme/i),
  ).toBeVisible();
  await expect(
    block.getByText(/saisie facultative/i),
  ).toBeVisible();
  await expect(
    block.getByText(/jamais envoyée ni enregistrée sur nos serveurs/i),
  ).toBeVisible();
  await expect(
    block.getByText(/api-adresse\.data\.gouv\.fr/i),
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
  // Verrou r3 : assertion explicite sur le chiffre comparatif (pas seulement
  // le label) — sinon le smoke passerait même si la référence affichée
  // changeait silencieusement. Cf. brief "smoke qui passe parce que rien ne
  // crashe est un test qui passe pour de mauvaises raisons". Le `~` est dans
  // un nœud texte séparé en JSX, on cible donc le chiffre + l'unité qui sont
  // dans le même <span>.
  await expect(block.getByText(/1500\s*km/i).first()).toBeVisible();
  // Label de référence reformulé en "Estimation indicative" (pas de citation
  // ADEME nominative non sourçable) — décision comité T-200 round 2,
  // sécurisation juridique avant review avocat T-003/T-206.
  await expect(block.getByText(/estimation indicative/i)).toBeVisible();
  await expect(
    block.getByRole("button", { name: /changer ma position/i }),
  ).toBeVisible();
});
