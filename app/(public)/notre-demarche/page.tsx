import type { Metadata } from "next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchActiveGmsPrices } from "@/lib/gms-prices/fetch-active";
import { Hero } from "./_components/Hero";
import { CircuitSection } from "./_components/CircuitSection";
import { ComparisonSection } from "./_components/ComparisonSection";
import { Disclaimer } from "./_components/Disclaimer";
import { CtaSection } from "./_components/CtaSection";

// Page publique /notre-demarche (Server Component pur) — pédagogie circuit
// court vs grande distribution. Fetch SSR via fetchActiveGmsPrices (Phase A).
//
// Navbar + Footer fournis par app/(public)/layout.tsx, pas d'import ici.

export const metadata: Metadata = {
  title: "Notre démarche — TerrOir",
  description:
    "Comprendre ce qui distingue TerrOir de la grande distribution : circuit court, juste rémunération de l'éleveur, transparence sur la formation des prix d'une viande de qualité en Sarthe.",
};

export default async function NotreDemarchePage() {
  const supabase = await createSupabaseServerClient();
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
