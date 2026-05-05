"use client";

import dynamic from "next/dynamic";

// Audit Vercel M-4 (2026-05-05) : modal update mensuel GMS, 279 LoC.
// Action mensuelle, pas un flow critique au load.
export const MonthlyUpdateModalLazy = dynamic(
  () => import("./MonthlyUpdateModal").then((m) => m.MonthlyUpdateModal),
  {
    ssr: false,
    loading: () => null,
  },
);
