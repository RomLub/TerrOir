import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui";

// Page placeholder /livraison — créée pour que le maillage interne
// /contact → /livraison pointe vers une cible existante (audit P0
// légales 2026-05-06). `robots: noindex` jusqu'à rédaction du contenu
// réel : on évite que Google référence une page vide.

export const metadata: Metadata = {
  title: "Livraison et retrait — TerrOir",
  description:
    "Livraison et retrait sur TerrOir : page en cours de rédaction. Pour toute question sur les modalités, contactez-nous.",
  robots: { index: false, follow: false },
};

export default function LivraisonPage() {
  return (
    <div className="bg-bg">
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-24 text-center">
        <span className="text-[11px] uppercase tracking-[0.2em] text-terra-700 font-semibold">
          Pratique
        </span>
        <h1 className="mt-3 font-serif text-[44px] md:text-[64px] text-green-900 leading-[1.04] tracking-tight">
          Livraison et retrait
        </h1>
        <p className="mt-6 text-[17px] text-dark/70 max-w-xl mx-auto leading-relaxed">
          Cette page est en cours de rédaction. Pour toute question sur les
          modalités de retrait à la ferme ou de livraison, contactez-nous —
          réponse sous 24 heures ouvrées.
        </p>
        <div className="mt-10">
          <Link href="/contact">
            <Button size="lg">Nous contacter →</Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
