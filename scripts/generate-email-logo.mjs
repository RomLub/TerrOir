// Source : components/ui/logo.tsx (paths SVG inline) via scripts/_logo-paths.mjs.
// Output : public/email-assets/logo-email.png (400×217, mono blanc, fond transparent).
//
// Mode mono blanc (cohérent avec le rendu du <Logo variant="mono" /> sur fond
// green-900 dans la sidebar producteur), rasterisé via sharp pour usage dans les
// templates emails Resend. Cible le header email layout.tsx où il s'affichera à
// 200×108 (display) sur fond vert TerrOir #2D6A4F.
//
// Idempotent : exécutable autant de fois que nécessaire.
//
// Usage : `node scripts/generate-email-logo.mjs`

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import sharp from "sharp";
import { buildWordmarkSvg } from "./_logo-paths.mjs";

const OUTPUT = "public/email-assets/logo-email.png";
const WIDTH = 400;
const HEIGHT = 217;
const FILL = "#ffffff";

const svg = buildWordmarkSvg({
  width: WIDTH,
  height: HEIGHT,
  letterFill: FILL,
  ringFill: FILL,
  riverFill: FILL,
});

mkdirSync(dirname(OUTPUT), { recursive: true });

await sharp(Buffer.from(svg), { density: 300 })
  .resize(WIDTH, HEIGHT, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png({ compressionLevel: 9 })
  .toFile(OUTPUT);

console.log(`✓ ${OUTPUT} (${WIDTH}×${HEIGHT}, mono blanc, alpha)`);
