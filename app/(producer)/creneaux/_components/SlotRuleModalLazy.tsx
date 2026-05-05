"use client";

import dynamic from "next/dynamic";

// Audit Vercel M-4 (2026-05-05) : modal le plus lourd de /creneaux (316
// LoC, 11 inputs). Lazy-loaded — un producer en flow normal ne touche
// JAMAIS aux règles déjà créées au load.
const SlotRuleModalLazy = dynamic(() => import("./SlotRuleModal"), {
  ssr: false,
  loading: () => null,
});

export default SlotRuleModalLazy;
