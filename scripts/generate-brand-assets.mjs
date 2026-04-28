// Source : components/ui/logo.tsx (paths SVG inline) via scripts/_logo-paths.mjs.
// Outputs (Next 14 file-based metadata convention) :
//   - app/icon.png              (64×64,  icon couleur, fond transparent)        → favicon
//   - app/apple-icon.png        (180×180, icon variant dark sur fond terra-700) → iOS home screen
//   - app/opengraph-image.png   (1200×630, wordmark couleur sur fond crème)     → OG cards FB/LI/WA
//   - app/twitter-image.png     (1200×630, idem OG)                              → Twitter card
//
// Next 14 détecte automatiquement ces fichiers et injecte les <link rel="icon">
// et <meta property="og:image"> appropriés. Pas besoin de toucher metadata.icons
// ni metadata.openGraph.images dans app/layout.tsx.
//
// Idempotent : exécutable autant de fois que nécessaire.
//
// Usage : `node scripts/generate-brand-assets.mjs`

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import sharp from "sharp";
import {
  buildIconSvg,
  buildWordmarkSvg,
  GREEN_700,
  GREEN_400,
  TERRA_700,
  TERRA_300,
} from "./_logo-paths.mjs";

const TERRA_700_RGB = { r: 0xa0, g: 0x52, b: 0x2d, alpha: 1 };
const TERRA_BG_RGB = { r: 0xf7, g: 0xf4, b: 0xef, alpha: 1 }; // #f7f4ef = bg crème

async function writePng(svg, outPath, { width, height, background }) {
  mkdirSync(dirname(outPath), { recursive: true });
  await sharp(Buffer.from(svg), { density: 300 })
    .resize(width, height, { fit: "contain", background })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`✓ ${outPath} (${width}×${height})`);
}

// 1. app/icon.png — favicon, icon couleur normale sur transparent
{
  const W = 64;
  const H = 64;
  const svg = buildIconSvg({
    width: W,
    height: H,
    ringFill: GREEN_700,
    riverFill: TERRA_700,
  });
  await writePng(svg, "app/icon.png", {
    width: W,
    height: H,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
}

// 2. app/apple-icon.png — iOS arrondit le carré, fond solide nécessaire
//    (transparence donne fond blanc moche). Variant icon-dark (anneau GREEN_400
//    + rivière TERRA_300) sur fond terra-700 pour bon contraste.
{
  const W = 180;
  const H = 180;
  // SVG est carré viewBox icon ≈ 1.022, donc resize fit:contain ajoute padding
  // minimal. On rend l'icon à ~75% de la zone pour padding visuel iOS.
  const svg = buildIconSvg({
    width: W,
    height: H,
    ringFill: GREEN_400,
    riverFill: TERRA_300,
  });
  await writePng(svg, "app/apple-icon.png", {
    width: W,
    height: H,
    background: TERRA_700_RGB,
  });
}

// 3. app/opengraph-image.png — wordmark couleur sur fond crème, 1200×630 (ratio 1.91:1).
//    Le wordmark a un ratio ~1.844 donc avec fit:contain il y a un peu de padding
//    vertical naturel. Padding visuel calculé pour ~18% margin around (les previews
//    Slack/LinkedIn croppent souvent les bords).
async function buildOgPng(outPath) {
  const CANVAS_W = 1200;
  const CANVAS_H = 630;
  // Wordmark rendu à 70% de la largeur canvas (= 840px), centré.
  const WORDMARK_W = 840;
  const WORDMARK_H = Math.round(WORDMARK_W / 1.844); // ≈ 456 (preserves ratio)

  const wordmarkSvg = buildWordmarkSvg({
    width: WORDMARK_W,
    height: WORDMARK_H,
    letterFill: GREEN_700,
    ringFill: GREEN_700,
    riverFill: TERRA_700,
  });

  const wordmarkBuf = await sharp(Buffer.from(wordmarkSvg), { density: 300 })
    .resize(WORDMARK_W, WORDMARK_H, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  mkdirSync(dirname(outPath), { recursive: true });
  await sharp({
    create: {
      width: CANVAS_W,
      height: CANVAS_H,
      channels: 4,
      background: TERRA_BG_RGB,
    },
  })
    .composite([
      {
        input: wordmarkBuf,
        top: Math.round((CANVAS_H - WORDMARK_H) / 2),
        left: Math.round((CANVAS_W - WORDMARK_W) / 2),
      },
    ])
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`✓ ${outPath} (${CANVAS_W}×${CANVAS_H})`);
}

await buildOgPng("app/opengraph-image.png");
await buildOgPng("app/twitter-image.png");
