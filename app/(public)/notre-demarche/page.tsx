import type { Metadata } from "next";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchActiveGmsPrices } from "@/lib/gms-prices/fetch-active";
import { Hero } from "./_components/Hero";
import { CircuitSection } from "./_components/CircuitSection";
import { ComparisonSection } from "./_components/ComparisonSection";
import { Disclaimer } from "./_components/Disclaimer";
import { CtaSection } from "./_components/CtaSection";

// Page publique /notre-demarche (Server Component pur) — pédagogie circuit
// court vs grande distribution. Fetch SSR via fetchActiveGmsPrices (Phase A).
//
// Perf (latence-navigation 2026-05-24) : les prix GMS de référence sont des
// données publiques identiques pour tous les visiteurs (table gms_prices,
// active=true). On lit donc via le client admin (au lieu du client serveur
// lié aux cookies de session) et on passe la page en revalidate=300. Avant,
// createSupabaseServerClient lisait les cookies → rendu dynamique à chaque
// hit ; désormais la page est prerendable + prefetchable. Les références
// changent rarement (édition admin manuelle) : 5 min de tolérance est aligné
// sur la page éducative /morceaux/boeuf (revalidate=300, même rationale).
export const metadata: Metadata = {
  title: "Notre démarche — TerrOir",
  description:
    "Comprendre ce qui distingue TerrOir de la grande distribution : circuit court, juste rémunération de l'éleveur, transparence sur la formation des prix d'une viande de qualité en Sarthe.",
};

export const revalidate = 300;

export default async function NotreDemarchePage() {
  const supabase = createSupabaseAdminClient();
  const refs = await fetchActiveGmsPrices(supabase);

  return (
    <>
      <Hero />
      <CircuitSection />
      <ComparisonSection refs={refs} />
      <Disclaimer />
      <CtaSection />
    </>
  );
}
