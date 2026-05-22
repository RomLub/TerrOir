import Link from "next/link";
import { Button } from "@/components/ui";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyPrefillToken } from "@/lib/leads/prefill-token";
import { SignupForm, type PrefillData } from "./_components/SignupForm";

// Chantier 3 Phase 2bis — /devenir-producteur en self-service. Server Component :
// lit ?prefill (lien personnel prospect), vérifie le token + la correspondance
// avec la colonne stockée (révocation), charge le lead pour pré-remplir le
// formulaire et verrouiller l'email. Le reste de la page (marketing + form) est
// statique ; seul le formulaire est interactif (Client Component).

export const dynamic = "force-dynamic";

const ADVANTAGES = [
  {
    n: "6%",
    title: "Commission unique",
    text: "Pas d'abonnement, pas de frais cachés. Vous payez 6% uniquement sur les commandes finalisées.",
  },
  {
    n: "01",
    title: "Une page dédiée à votre ferme",
    text: "Racontez votre histoire, mettez en avant vos labels et vos pratiques. Une vitrine que vous contrôlez.",
  },
  {
    n: "✓",
    title: "Paiement garanti",
    text: "Le client paie en ligne au moment de la commande. Pas d'impayés, pas de relances : vous préparez la commande en toute sérénité.",
  },
];

async function loadPrefill(token: string): Promise<PrefillData | null> {
  const v = verifyPrefillToken(token);
  if (!v.valid) return null;
  const admin = createSupabaseAdminClient();
  const { data: lead } = await admin
    .from("producer_interests")
    .select("id, email, prenom, nom, telephone, nom_exploitation, commune, prefill_token")
    .eq("id", v.leadId)
    .maybeSingle();
  if (!lead || lead.prefill_token !== token) return null;
  return {
    token,
    email: (lead.email as string) ?? "",
    prenom: (lead.prenom as string | null) ?? "",
    nom: (lead.nom as string | null) ?? "",
    telephone: (lead.telephone as string | null) ?? "",
    nom_exploitation: (lead.nom_exploitation as string | null) ?? "",
    commune: (lead.commune as string | null) ?? "",
  };
}

export default async function DevenirProducteurPage({
  searchParams,
}: {
  searchParams: Promise<{ prefill?: string }>;
}) {
  const sp = await searchParams;
  const prefill =
    typeof sp.prefill === "string" && sp.prefill.length > 0
      ? await loadPrefill(sp.prefill)
      : null;

  return (
    <div className="bg-bg">
      <section className="bg-terra-700 text-white">
        <div className="max-w-7xl mx-auto px-6 py-20 md:py-28 grid md:grid-cols-[6fr_5fr] gap-10 items-center">
          <div>
            <span className="text-[11px] uppercase tracking-[0.2em] text-terra-100 font-semibold">
              Pour les éleveurs sarthois
            </span>
            <h1 className="mt-3 font-serif text-[44px] md:text-[68px] leading-[1.02] tracking-tight">
              Devenez producteur
              <br />
              TerrOir.
            </h1>
            <p className="mt-6 text-[17px] text-terra-100/90 max-w-lg leading-relaxed">
              Créez votre espace en quelques minutes et commencez à vendre vos
              produits près de chez vous. Notre équipe vous accompagne à chaque
              étape.
            </p>
            <div className="mt-8 flex items-center gap-6 flex-wrap">
              <a href="#formulaire">
                <Button size="lg" className="bg-white text-terra-700 hover:bg-terra-100">
                  Créer mon espace →
                </Button>
              </a>
              <span className="text-[13px] text-terra-100/80">
                Sans engagement · Vous gardez la main
              </span>
            </div>
          </div>
          <div
            className="aspect-4/5 rounded-2xl hidden md:flex items-center justify-center text-white/40 font-mono text-[11px] uppercase tracking-wider"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0 14px, rgba(255,255,255,0.04) 14px 28px)",
            }}
          >
            Photo éleveur en pré
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 py-20 md:py-24">
        <div className="text-center mb-12">
          <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">
            Pourquoi TerrOir
          </span>
          <h2 className="mt-2 font-serif text-[36px] md:text-[44px] text-green-900 leading-tight">
            Trois engagements, pour vous.
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {ADVANTAGES.map((a) => (
            <article
              key={a.title}
              className="bg-white rounded-2xl p-7 border border-dark/[0.06] shadow-soft"
            >
              <div className="font-serif text-[56px] text-terra-700 tabular-nums leading-none">
                {a.n}
              </div>
              <h3 className="mt-4 font-serif text-[24px] text-green-900 leading-tight">
                {a.title}
              </h3>
              <p className="mt-3 text-[14px] text-dark/75 leading-relaxed">{a.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        id="formulaire"
        className="bg-green-100/40 border-y border-dark/[0.04] scroll-mt-20"
      >
        <div className="max-w-3xl mx-auto px-6 py-20 md:py-24">
          <div className="text-center mb-10">
            <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">
              Créer mon espace
            </span>
            <h2 className="mt-2 font-serif text-[36px] md:text-[44px] text-green-900 leading-tight">
              Parlez-nous de votre exploitation.
            </h2>
            <p className="mt-3 text-[15px] text-dark/70">
              Créez votre compte producteur. Vous accédez immédiatement à votre
              espace pour le compléter à votre rythme.
            </p>
          </div>

          <SignupForm prefill={prefill} />

          <p className="mt-6 text-center text-[13px] text-dark/60">
            Une question avant de vous lancer ?{" "}
            <Link href="/contact" className="text-terra-700 underline">
              Contactez l&rsquo;équipe
            </Link>{" "}
            — nous vous répondons sous 24 heures ouvrées.
          </p>
        </div>
      </section>
    </div>
  );
}
