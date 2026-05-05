"use client";

import dynamic from "next/dynamic";

// Audit Vercel M-4 (2026-05-05) : modal d'exclusion bulk (vacances), 155
// LoC. Lazy-loaded — utilisé occasionnellement (1-2× / an typique).
const BulkExcludeRangeModalLazy = dynamic(
  () => import("./BulkExcludeRangeModal"),
  {
    ssr: false,
    loading: () => null,
  },
);

export default BulkExcludeRangeModalLazy;
