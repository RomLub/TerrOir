import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { AdminHeader } from "./_components/AdminHeader";
import { AdminSidebar } from "./_components/AdminSidebar";

// Audit Auth 2026-05-05 H-4 : defense-in-depth. Le middleware reste la 1re
// barrière (redirige non-admin vers /connexion, redirige admin sur non-admin
// host). Ce check serveur dans le layout protège si le middleware est
// désactivé / contourné (matcher cassé, header injection, régression
// isolation cookies). Coût : un getUser() supplémentaire par route admin —
// dédupliqué par React cache via getSessionUser().
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionUser();
  if (!session?.isAdmin) redirect("/connexion");

  const host = headers().get("host") ?? "";
  if (!host.startsWith("admin.")) {
    redirect("https://admin.terroir-local.fr/tableau-de-bord");
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <AdminHeader />
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-8 py-8">
        <AdminSidebar />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
