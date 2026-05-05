"use client";

import dynamic from "next/dynamic";

// Audit Vercel M-4 (2026-05-05) : modal d'exclusion slot ponctuel, 199
// LoC. Lazy-loaded. Le type FutureActiveSlot reste exporté côté
// ExcludeSlotModal (type erasure côté TS = pas d'impact bundle).
const ExcludeSlotModalLazy = dynamic(() => import("./ExcludeSlotModal"), {
  ssr: false,
  loading: () => null,
});

export default ExcludeSlotModalLazy;
