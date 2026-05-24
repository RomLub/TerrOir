import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/session";
import {
  setAdminPrivilege,
  adminOpMessage,
  type AdminPrivilege,
} from "@/lib/admin/admins/operations";

// POST /api/admin/admins/[id]/privilege — chantier 6. Change le niveau d'un
// admin (super_admin ↔ standard). Réservé au super_admin. Gardes self-action
// + dernier super_admin actif côté RPC. Body : { privilege }.
export async function POST(
  request: Request,
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

  let body: { privilege?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
  if (body.privilege !== "super_admin" && body.privilege !== "standard") {
    return NextResponse.json({ error: "Niveau invalide." }, { status: 400 });
  }
  const privilege = body.privilege as AdminPrivilege;

  const result = await setAdminPrivilege(session.id, id, privilege);
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
