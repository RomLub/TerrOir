"use client";

import dynamic from "next/dynamic";

// Audit Vercel M-4 (2026-05-05) : modal ajout CB Stripe, 213 LoC + lazy
// load Stripe Elements quand modal ouvre. Lazy-loaded dans le bundle
// /compte/paiements — l'utilisateur arrive d'abord sur la liste des
// méthodes existantes, le modal s'ouvre via clic explicite.
const AddCardModalLazy = dynamic(() => import("./AddCardModal"), {
  ssr: false,
  loading: () => null,
});

export default AddCardModalLazy;
