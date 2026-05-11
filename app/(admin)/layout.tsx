import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AdminHeader } from "./_components/AdminHeader";
import { AdminSidebar } from "./_components/AdminSidebar";

// Audit Auth 2026-05-05 H-4 : defense-in-depth. Le middleware reste la 1re
// barrière (redirige non-admin vers /connexion, redirige admin sur non-admin
// host). Ce check serveur dans le layout protège si le middleware est
// désactivé / contourné (matcher cassé, header injection, régression
// isolation cookies). Coût : un getUser() supplémentaire par route admin —
// dédupliqué par React cache via getSessionUser().
//
// Audit régression 2026-05-05 N-2 : check host gardé prod-only — en dev
// (NODE_ENV !== 'production') localhost:3000 / vercel preview ne match pas
// "admin.*" et serait hard-redirigé vers la prod. Le check session+isAdmin
// reste actif partout (pas de relâchement sécurité).
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionUser();
  if (!session?.isAdmin) redirect("/connexion");

  const host = (await headers()).get("host") ?? "";
  if (
    process.env.NODE_ENV === "production" &&
    !host.startsWith("admin.")
  ) {
    redirect("https://admin.terroir-local.fr/tableau-de-bord");
  }

  // F-014 v2 followup (audit P0 sweep) : count pending refunds pour badge
  // sidebar. Query coût négligeable (admin low-traffic, index status_idx).
  // Fail-open : si erreur, badge invisible (count=0).
  const admin = createSupabaseAdminClient();
  const { count: pendingRefundsCount } = await admin
    .from("pending_refunds")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <AdminHeader />
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-8 py-8">
        <AdminSidebar pendingRefundsCount={pendingRefundsCount ?? 0} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
