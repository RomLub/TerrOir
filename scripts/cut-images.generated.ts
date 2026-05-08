/**
 * Fichier genere par scripts/fetch-cut-images.ts.
 * NE PAS EDITER A LA MAIN — sera ecrase au prochain run du script.
 *
 * Pour regenerer toutes les images :
 *   PIXABAY_API_KEY=xxx npx tsx scripts/fetch-cut-images.ts
 *
 * Pour regenerer un seul slug :
 *   PIXABAY_API_KEY=xxx npx tsx scripts/fetch-cut-images.ts --only filet
 */

import type { BeefCutImage, BeefCutSlug } from '../lib/beef-cuts';

export const CUT_IMAGES: Partial<Record<BeefCutSlug, BeefCutImage>> = {
  'aiguillette-baronne': {
    imageUrl: '/images/cuts/aiguillette-baronne.jpg',
    imageAlt: "Photo d'illustration : beef tenderloin slice (aiguillette baronne)",
    imageCredit: "Photo : JWahl / Pixabay",
  },
  'araignee': {
    imageUrl: '/images/cuts/araignee.jpg',
    imageAlt: "Photo d'illustration : spider steak beef (araignee)",
    imageCredit: "Photo : tomwieden / Pixabay",
  },
  'basses-cotes': {
    imageUrl: '/images/cuts/basses-cotes.jpg',
    imageAlt: "Photo d'illustration : beef chuck roast (basses cotes)",
    imageCredit: "Photo : jereskok / Pixabay",
  },
  'bavette-d-aloyau': {
    imageUrl: '/images/cuts/bavette-d-aloyau.jpg',
    imageAlt: "Photo d'illustration : flank steak (bavette d aloyau)",
    imageCredit: "Photo : Roundhere44 / Pixabay",
  },
  'bavette-de-flanchet': {
    imageUrl: '/images/cuts/bavette-de-flanchet.jpg',
    imageAlt: "Photo d'illustration : beef stew (bavette de flanchet)",
    imageCredit: "Photo : souldesign7 / Pixabay",
  },
  'collier': {
    imageUrl: '/images/cuts/collier.jpg',
    imageAlt: "Photo d'illustration : beef bourguignon (collier)",
    imageCredit: "Photo : ChiemSeherin / Pixabay",
  },
  'cotes-entrecotes': {
    imageUrl: '/images/cuts/cotes-entrecotes.jpg',
    imageAlt: "Photo d'illustration : ribeye steak (cotes entrecotes)",
    imageCredit: "Photo : omisido / Pixabay",
  },
  'faux-filet': {
    imageUrl: '/images/cuts/faux-filet.jpg',
    imageAlt: "Photo d'illustration : sirloin steak (faux filet)",
    imageCredit: "Photo : wifechef / Pixabay",
  },
  'filet': {
    imageUrl: '/images/cuts/filet.jpg',
    imageAlt: "Photo d'illustration : beef tenderloin (filet)",
    imageCredit: "Photo : jereskok / Pixabay",
  },
  'flanchet': {
    imageUrl: '/images/cuts/flanchet.jpg',
    imageAlt: "Photo d'illustration : beef flank (flanchet)",
    imageCredit: "Photo : Roundhere44 / Pixabay",
  },
  'gite': {
    imageUrl: '/images/cuts/gite.jpg',
    imageAlt: "Photo d'illustration : pot au feu (gite)",
    imageCredit: "Photo : publimode / Pixabay",
  },
  'gite-a-la-noix': {
    imageUrl: '/images/cuts/gite-a-la-noix.jpg',
    imageAlt: "Photo d'illustration : beef daube (gite a la noix)",
    imageCredit: "Photo : ChiemSeherin / Pixabay",
  },
  'hampe': {
    imageUrl: '/images/cuts/hampe.jpg',
    imageAlt: "Photo d'illustration : skirt steak (hampe)",
    imageCredit: "Photo : tomwieden / Pixabay",
  },
  'joue': {
    imageUrl: '/images/cuts/joue.jpg',
    imageAlt: "Photo d'illustration : braised beef cheek (joue)",
    imageCredit: "Photo : thamrongtheerapat / Pixabay",
  },
  'jumeau': {
    imageUrl: '/images/cuts/jumeau.jpg',
    imageAlt: "Photo d'illustration : beef pot roast (jumeau)",
    imageCredit: "Photo : pixel1 / Pixabay",
  },
  'jumeau-a-bifteck': {
    imageUrl: '/images/cuts/jumeau-a-bifteck.jpg',
    imageAlt: "Photo d'illustration : beef chuck steak (jumeau a bifteck)",
    imageCredit: "Photo : tomwieden / Pixabay",
  },
  'langue': {
    imageUrl: '/images/cuts/langue.jpg',
    imageAlt: "Photo d'illustration : beef tongue (langue)",
    imageCredit: "Photo : NickyPe / Pixabay",
  },
  'macreuse': {
    imageUrl: '/images/cuts/macreuse.jpg',
    imageAlt: "Photo d'illustration : beef stew (macreuse)",
    imageCredit: "Photo : souldesign7 / Pixabay",
  },
  'macreuse-a-bifteck': {
    imageUrl: '/images/cuts/macreuse-a-bifteck.jpg',
    imageAlt: "Photo d'illustration : beef shoulder steak (macreuse a bifteck)",
    imageCredit: "Photo : tomwieden / Pixabay",
  },
  'onglet': {
    imageUrl: '/images/cuts/onglet.jpg',
    imageAlt: "Photo d'illustration : hanger steak (onglet)",
    imageCredit: "Photo : congerdesign / Pixabay",
  },
  'paleron': {
    imageUrl: '/images/cuts/paleron.jpg',
    imageAlt: "Photo d'illustration : braised beef (paleron)",
    imageCredit: "Photo : thamrongtheerapat / Pixabay",
  },
  'plat-de-cotes': {
    imageUrl: '/images/cuts/plat-de-cotes.jpg',
    imageAlt: "Photo d'illustration : beef short ribs (plat de cotes)",
    imageCredit: "Photo : sherpa7 / Pixabay",
  },
  'poire-merlan': {
    imageUrl: '/images/cuts/poire-merlan.jpg',
    imageAlt: "Photo d'illustration : beef rump steak (poire merlan)",
    imageCredit: "Photo : riquebeze / Pixabay",
  },
  'poitrine': {
    imageUrl: '/images/cuts/poitrine.jpg',
    imageAlt: "Photo d'illustration : beef brisket smoked (poitrine)",
    imageCredit: "Photo : stevepb / Pixabay",
  },
  'queue': {
    imageUrl: '/images/cuts/queue.jpg',
    imageAlt: "Photo d'illustration : oxtail stew (queue)",
    imageCredit: "Photo : Lebensmittelfotos / Pixabay",
  },
  'rond-de-gite': {
    imageUrl: '/images/cuts/rond-de-gite.jpg',
    imageAlt: "Photo d'illustration : roast beef (rond de gite)",
    imageCredit: "Photo : jereskok / Pixabay",
  },
  'rumsteck': {
    imageUrl: '/images/cuts/rumsteck.jpg',
    imageAlt: "Photo d'illustration : rump steak (rumsteck)",
    imageCredit: "Photo : riquebeze / Pixabay",
  },
  'tendron': {
    imageUrl: '/images/cuts/tendron.jpg',
    imageAlt: "Photo d'illustration : beef brisket (tendron)",
    imageCredit: "Photo : MariaGutebring / Pixabay",
  },
  'tranche': {
    imageUrl: '/images/cuts/tranche.jpg',
    imageAlt: "Photo d'illustration : beef roast (tranche)",
    imageCredit: "Photo : jereskok / Pixabay",
  },
};
