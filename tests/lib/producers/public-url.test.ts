import { describe, it, expect, vi } from "vitest";

// lib/env/urls.ts fail-fast au load si NEXT_PUBLIC_APP_URL n'est pas défini.
// Pattern hoisted pour set la var AVANT l'évaluation de l'import.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://www.terroir-local.fr";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "https://pro.terroir-local.fr";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.terroir-local.fr";
});

import { buildPublicProducerUrl } from "@/lib/producers/public-url";

describe("buildPublicProducerUrl", () => {
  it("construit l'URL absolue cross-subdomain vers la fiche publique", () => {
    expect(buildPublicProducerUrl("ferme-des-grands-bois")).toBe(
      "https://www.terroir-local.fr/producteurs/ferme-des-grands-bois",
    );
  });

  it("préserve les slugs avec tirets et chiffres", () => {
    expect(buildPublicProducerUrl("gaec-du-72-2024")).toBe(
      "https://www.terroir-local.fr/producteurs/gaec-du-72-2024",
    );
  });
});
