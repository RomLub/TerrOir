import type { Metadata } from "next";
import { Suspense } from "react";
import { PublicStats } from "@/components/ui/public-stats";
import { Hero } from "./_components/home/Hero";
import { Steps } from "./_components/home/Steps";
import { NotreDemarcheTeaser } from "./_components/home/NotreDemarcheTeaser";
import { FeaturedProducts } from "./_components/home/FeaturedProducts";
import { SarthemapSection } from "./_components/home/SarthemapSection";
import { Reassurance } from "./_components/home/Reassurance";
import { CtaBand } from "./_components/home/CtaBand";
import { AccountDeletedBannerGate } from "./_components/home/AccountDeletedBannerGate";

// Homepage consumer (route /). Server Component — agrégateur des 7 sections
// de la home + composant <PublicStats /> Server existant (branché Supabase
// via getPublicStats cached 5 min).
//
// Perf (latence-navigation 2026-05-24) : la page ne lit plus searchParams au
// top. Avant, `await searchParams` (pour la bannière rare ?compte-supprime=1)
// forçait un rendu dynamique à chaque hit et empêchait le prefetch du shell.
// Désormais le flag est lu dans <AccountDeletedBannerGate /> (Client Component,
// useSearchParams) → la home est prerendable et la navigation vers / est
// instantanée. Le gate est enveloppé dans <Suspense> (requis par Next pour
// isoler useSearchParams sans dé-optimiser toute la route).
//
// Navbar + Footer sont fournis par app/(public)/layout.tsx, ne PAS
// les importer ici.

export const metadata: Metadata = {
  title: "TerrOir — La marketplace des producteurs sarthois",
  description:
    "Marketplace circuit court en Sarthe : commande en ligne auprès des producteurs locaux (volaille, légumes, fromages, fruits) et récupère ta commande sur le créneau de ton choix.",
};

export default function HomePage() {
  return (
    <>
      <Suspense fallback={null}>
        <AccountDeletedBannerGate />
      </Suspense>
      <Hero />
      <PublicStats />
      <Steps />
      <NotreDemarcheTeaser />
      <FeaturedProducts />
      <SarthemapSection />
      <Reassurance />
      <CtaBand />
    </>
  );
}
