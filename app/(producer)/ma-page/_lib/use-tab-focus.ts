"use client";

import { useEffect } from "react";
import type { ReadonlyURLSearchParams } from "next/navigation";

// Hook utilisé par /ma-page pour activer l'onglet « Modifier » et scroller
// vers la section ciblée quand l'URL porte `?tab=edit&focus=<id>`. Sert les
// liens d'étapes de la carte « mise en ligne » du dashboard (cf.
// lib/producers/publication-criteria.ts).
//
// Choix défensif (chantier feat/dashboard-publication-card-actionable) :
// `focus` SANS `tab=edit` est ignoré complètement. On ne switche pas
// l'onglet juste parce que `focus` est présent — `tab=edit` reste la
// signature explicite d'intention. Évite qu'une URL mal construite ouvre
// silencieusement l'onglet édition.
//
// Le scroll est différé d'un frame (requestAnimationFrame) pour laisser le
// switch d'onglet rendre les inputs cibles dans le DOM avant d'appeler
// scrollIntoView.
export function useTabFocusFromQuery(
  searchParams: ReadonlyURLSearchParams,
  setTab: (tab: "preview" | "edit") => void,
) {
  useEffect(() => {
    if (searchParams.get("tab") !== "edit") return;
    setTab("edit");
    const focus = searchParams.get("focus");
    if (!focus) return;
    // Frame suivant : laisse React monter l'onglet edit dans le DOM.
    requestAnimationFrame(() => {
      const el = document.getElementById(focus);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [searchParams, setTab]);
}
