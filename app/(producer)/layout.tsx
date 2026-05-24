import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchProducerForUser } from "@/lib/producers/context";
import {
  fetchProducerNavBadges,
  type ProducerNavBadges,
} from "@/lib/producers/nav-badges";
import { ProducerSidebar } from "./_components/ProducerSidebar";
import { ProducerHeader } from "./_components/ProducerHeader";

// Audit Auth 2026-05-05 H-4 : defense-in-depth. Vérifie session + host.
// Le middleware reste la 1re barrière (redirige non-auth vers /connexion,
// redirige producer draft vers /onboarding). Ce check serveur protège si
// le middleware est désactivé / contourné. Pas de check role producer ici
// (le middleware §3b s'en occupe et redirige déjà selon producer.statut).
//
// Audit régression 2026-05-05 N-2 : check host gardé prod-only — en dev
// (NODE_ENV !== 'production') localhost:3000 / vercel preview ne match pas
// "pro.*" et serait hard-redirigé vers la prod. Le check session reste
// actif partout (pas de relâchement sécurité).
//
// ADR-0011 : la coquille (sidebar + main) est rendue ici au niveau layout
// (parallèle à l'admin), plus dans chaque page. Les badges de nav sont
// fetchés côté serveur, fail-open : producteur introuvable → 0 badge et pas
// de redirect ici (chaque page gère son propre redirect('/invitation')).
export default async function ProducerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionUser();
  if (!session) redirect("/connexion");

  const host = (await headers()).get("host") ?? "";
  if (process.env.NODE_ENV === "production" && !host.startsWith("pro.")) {
    redirect("https://pro.terroir-local.fr/dashboard");
  }

  const admin = createSupabaseAdminClient();
  const producer = await fetchProducerForUser(admin, session.id);
  const badges: ProducerNavBadges = producer
    ? await fetchProducerNavBadges(admin, producer.id)
    : { ordersToConfirm: 0, stockRuptures: 0 };

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <ProducerHeader />
      <div className="flex flex-1">
        <ProducerSidebar badges={badges} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
