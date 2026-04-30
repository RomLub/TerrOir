import { describe, it, expect } from "vitest";

import { buildProducerHref } from "@/app/(admin)/audit-logs/_lib/build-producer-href";

describe("buildProducerHref", () => {
  it("construit le chemin /gestion-producteurs avec user_id en searchParam", () => {
    expect(buildProducerHref("00000000-0000-0000-0000-000000000000")).toBe(
      "/gestion-producteurs?user_id=00000000-0000-0000-0000-000000000000",
    );
  });

  it("encode les caractères spéciaux (defensive : ne devrait jamais arriver sur des UUID, mais on garantit le contrat)", () => {
    expect(buildProducerHref("a b/c?d")).toBe(
      "/gestion-producteurs?user_id=a%20b%2Fc%3Fd",
    );
  });

  it("renvoie un chemin relatif (pas d'origine)", () => {
    const href = buildProducerHref("abc");
    expect(href.startsWith("/")).toBe(true);
    expect(href).not.toMatch(/^https?:/);
  });
});
