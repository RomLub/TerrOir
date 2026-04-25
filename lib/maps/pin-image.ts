// Helper de génération du pin "producteur" partagé entre la carte
// (/carte, symbol layer WebGL) et la mini-map fiche produit (Marker DOM).
// Forme : goutte 32x40 css px avec gradient vertical, contour blanc,
// disque blanc au centre. Rendu retina via dpr=2.

const PIN_W = 32;
const PIN_H = 40;
const PIN_DPR = 2;

export function createPinCanvas(fillTop: string, fillBottom: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = PIN_W * PIN_DPR;
  canvas.height = PIN_H * PIN_DPR;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.scale(PIN_DPR, PIN_DPR);

  ctx.beginPath();
  ctx.moveTo(16, 2);
  ctx.bezierCurveTo(9.4, 2, 4, 7.4, 4, 14);
  ctx.bezierCurveTo(4, 23, 16, 38, 16, 38);
  ctx.bezierCurveTo(16, 38, 28, 23, 28, 14);
  ctx.bezierCurveTo(28, 7.4, 22.6, 2, 16, 2);
  ctx.closePath();

  const grad = ctx.createLinearGradient(16, 2, 16, 38);
  grad.addColorStop(0, fillTop);
  grad.addColorStop(1, fillBottom);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(16, 14, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  return canvas;
}

export function createPinImageData(fillTop: string, fillBottom: string): ImageData {
  const canvas = createPinCanvas(fillTop, fillBottom);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export const PIN_DIMENSIONS = { width: PIN_W, height: PIN_H, pixelRatio: PIN_DPR } as const;

// Palette terra (tailwind.config.js) — exposée pour usages partagés
// (icône légende, marker statique sur fiche produit, etc.)
export const PIN_TERRA_300 = '#D4A373';
export const PIN_TERRA_500 = '#B8713E';
export const PIN_TERRA_700 = '#A0522D';
