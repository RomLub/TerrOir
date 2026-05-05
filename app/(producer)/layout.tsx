import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";

// Audit Auth 2026-05-05 H-4 : defense-in-depth. Vérifie session + host.
// Le middleware reste la 1re barrière (redirige non-auth vers /connexion,
// redirige producer draft vers /onboarding). Ce check serveur protège si
// le middleware est désactivé / contourné. Pas de check role producer ici
// (le middleware §3b s'en occupe et redirige déjà selon producer.statut).
export default async function ProducerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionUser();
  if (!session) redirect("/connexion");

  const host = headers().get("host") ?? "";
  if (!host.startsWith("pro.")) {
    redirect("https://pro.terroir-local.fr/dashboard");
  }

  return <div className="producer-layout">{children}</div>;
}
