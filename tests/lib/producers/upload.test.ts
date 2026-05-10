import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  uploadProducerPhoto,
  extractWhitelistedExt,
  MAX_FILE_SIZE,
} from "@/lib/producers/upload";

// F-006 (audit P0-TC 2026-05-10) : la validation amont doit rejeter
// avant tout call Storage. Le mock SupabaseClient throw si `upload` ou
// `getPublicUrl` est appelé — un test vert prouve que la validation a
// court-circuité l'appel Storage.

function makeRejectingSupabase(): SupabaseClient {
  const upload = vi.fn(() => {
    throw new Error("storage.upload should not have been called");
  });
  const getPublicUrl = vi.fn(() => {
    throw new Error("storage.getPublicUrl should not have been called");
  });
  return {
    storage: {
      from: () => ({ upload, getPublicUrl }),
    },
  } as unknown as SupabaseClient;
}

function makeFile(name: string, size: number, type = "image/jpeg"): File {
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

describe("extractWhitelistedExt", () => {
  it("accepte jpg/jpeg/png/webp", () => {
    expect(extractWhitelistedExt("photo.jpg")).toBe("jpg");
    expect(extractWhitelistedExt("photo.jpeg")).toBe("jpeg");
    expect(extractWhitelistedExt("photo.png")).toBe("png");
    expect(extractWhitelistedExt("photo.webp")).toBe("webp");
  });

  it("normalise la casse", () => {
    expect(extractWhitelistedExt("PHOTO.JPG")).toBe("jpg");
    expect(extractWhitelistedExt("Photo.PnG")).toBe("png");
  });

  it("rejette une extension non whitelistée (pdf)", () => {
    expect(() => extractWhitelistedExt("doc.pdf")).toThrow(/non autorisée/);
  });

  it("rejette une extension non whitelistée (html)", () => {
    expect(() => extractWhitelistedExt("page.html")).toThrow(/non autorisée/);
  });

  it("rejette un fichier sans extension", () => {
    expect(() => extractWhitelistedExt("noext")).toThrow(/manquante/);
  });

  it("retient uniquement la dernière extension (jpg renommé .html)", () => {
    expect(() => extractWhitelistedExt("photo.jpg.html")).toThrow(
      /non autorisée/,
    );
  });
});

describe("uploadProducerPhoto — validation amont", () => {
  it("rejette un PDF avant tout call Storage", async () => {
    const supabase = makeRejectingSupabase();
    const file = makeFile("doc.pdf", 1024, "application/pdf");
    await expect(
      uploadProducerPhoto(supabase, "producer-photos", "p1", file),
    ).rejects.toThrow(/non autorisée/);
  });

  it("rejette un JPG renommé .html avant tout call Storage", async () => {
    const supabase = makeRejectingSupabase();
    // file.type client est `image/jpeg` (mensonge) mais le nom dit .html.
    // La validation se base sur le NOM, pas sur file.type — F-006 doctrine.
    const file = makeFile("photo.html", 1024, "image/jpeg");
    await expect(
      uploadProducerPhoto(supabase, "producer-photos", "p1", file),
    ).rejects.toThrow(/non autorisée/);
  });

  it("rejette un fichier > 5 MB avant tout call Storage", async () => {
    const supabase = makeRejectingSupabase();
    const tooLarge = MAX_FILE_SIZE + 1;
    const file = makeFile("photo.jpg", tooLarge);
    await expect(
      uploadProducerPhoto(supabase, "producer-photos", "p1", file),
    ).rejects.toThrow(/trop lourd/);
  });

  it("accepte un JPG ≤ 5 MB et appelle Storage avec contentType dérivé", async () => {
    const upload = vi.fn(async () => ({ data: { path: "k" }, error: null }));
    const getPublicUrl = vi.fn(() => ({
      data: { publicUrl: "https://cdn/x.jpg" },
    }));
    const supabase = {
      storage: { from: () => ({ upload, getPublicUrl }) },
    } as unknown as SupabaseClient;

    const file = makeFile("photo.JPG", 1024, "totally-fake/mime");
    const res = await uploadProducerPhoto(
      supabase,
      "producer-photos",
      "p1",
      file,
    );

    expect(res.url).toBe("https://cdn/x.jpg");
    // contentType envoyé doit être `image/jpeg` (dérivé de l'ext .jpg),
    // pas `totally-fake/mime` venant du client.
    expect(upload).toHaveBeenCalledTimes(1);
    const [, , uploadOptions] = upload.mock.calls[0] as unknown as [
      string,
      File,
      { contentType: string },
    ];
    expect(uploadOptions.contentType).toBe("image/jpeg");
  });
});
