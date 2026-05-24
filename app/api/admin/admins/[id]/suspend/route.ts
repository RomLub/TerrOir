import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/session";
import { suspendAdmin, adminOpMessage } from "@/lib/admin/admins/operations";

// POST /api/admin/admins/[id]/suspend — chantier 6. Suspend un admin (perd
// l'accès immédiatement, snapshot révoqué). Réservé au super_admin.
export async function POST(
  _request: Request,
  props: { params: Promise<{ id: string }> },
) {
  const { id } = await props.params;
  const session = await getSessionUser();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!session.isSuperAdmin) {
    return NextResponse.json({ error: adminOpMessage("forbidden") }, { status: 403 });
  }

  const result = await suspendAdmin(session.id, id);
  if (!result.ok) {
    const status = result.errorCode === "forbidden" ? 403 : 400;
    return NextResponse.json(
      { error: adminOpMessage(result.errorCode), code: result.errorCode },
      { status },
    );
  }

  revalidatePath("/comptes-admins");
  return NextResponse.json({ ok: true });
}
