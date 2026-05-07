import type { Metadata } from "next";
import { PublicStats } from "@/components/ui/public-stats";
import { Hero } from "./_components/home/Hero";
import { Steps } from "./_components/home/Steps";
import { NotreDemarcheTeaser } from "./_components/home/NotreDemarcheTeaser";
import { FeaturedProducts } from "./_components/home/FeaturedProducts";
import { SarthemapPostit } from "./_components/home/SarthemapPostit";
import { Reassurance } from "./_components/home/Reassurance";
import { CtaBand } from "./_components/home/CtaBand";
import { AccountDeletedBanner } from "./_components/home/AccountDeletedBanner";

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

// searchParams typing : Next 16 le passe en Promise<Record<string, string |
// string[]>>. On le destructure de façon défensive (le param peut être
// absent dans 99% des hits home).
export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<{ "compte-supprime"?: string | string[] }>;
}) {
  const resolved = (await searchParams) ?? {};
  const showAccountDeleted = resolved["compte-supprime"] === "1";

  return (
    <>
      {showAccountDeleted ? <AccountDeletedBanner /> : null}
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
