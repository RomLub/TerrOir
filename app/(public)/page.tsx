import type { Metadata } from "next";
import { PublicStats } from "@/components/ui/public-stats";
import { Hero } from "./_components/home/Hero";
import { Steps } from "./_components/home/Steps";
import { NotreDemarcheTeaser } from "./_components/home/NotreDemarcheTeaser";
import { FeaturedProducts } from "./_components/home/FeaturedProducts";
import { SarthemapPostit } from "./_components/home/SarthemapPostit";
import { Reassurance } from "./_components/home/Reassurance";
import { CtaBand } from "./_components/home/CtaBand";

// Homepage consumer (route /). Server Component pur — agrégateur des 7
// sections de la home + composant <PublicStats /> Server existant
// (branché Supabase via getPublicStats cached 5 min).
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
      <Hero />
      <PublicStats />
      <Steps />
      <NotreDemarcheTeaser />
      <FeaturedProducts />
      <SarthemapPostit />
      <Reassurance />
      <CtaBand />
    </>
  );
}
