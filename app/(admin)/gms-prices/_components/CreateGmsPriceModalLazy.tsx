"use client";

import dynamic from "next/dynamic";

// Audit Vercel M-4 (2026-05-05) : modal création GMS, 270 LoC. Admin
// rarement ouvre ce modal au load (action explicite "Nouvelle entrée").
export const CreateGmsPriceModalLazy = dynamic(
  () => import("./CreateGmsPriceModal").then((m) => m.CreateGmsPriceModal),
  {
    ssr: false,
    loading: () => null,
  },
);
