"use client";

import dynamic from "next/dynamic";

// Audit Vercel M-4 (2026-05-05) : modal édition GMS, 208 LoC.
export const EditGmsPriceModalLazy = dynamic(
  () => import("./EditGmsPriceModal").then((m) => m.EditGmsPriceModal),
  {
    ssr: false,
    loading: () => null,
  },
);
