"use client";

import dynamic from "next/dynamic";

// Audit Vercel M-4 (2026-05-05) : modal rarement ouvert (création slot
// ad hoc), 156 LoC. Lazy-loaded pour ne pas bundler dans le chunk
// initial de /creneaux. ssr: false : pas besoin de SSR pour un modal qui
// s'ouvre via setState client.
const AdHocSlotModalLazy = dynamic(() => import("./AdHocSlotModal"), {
  ssr: false,
  loading: () => null,
});

export default AdHocSlotModalLazy;
