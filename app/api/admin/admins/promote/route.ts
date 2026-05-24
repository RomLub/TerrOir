import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/session";
import {
  promoteAdminByEmail,
  adminOpMessage,
  type AdminPrivilege,
} from "@/lib/admin/admins/operations";

// POST /api/admin/admins/promote — chantier 6. Promeut un compte client
// (par email) en admin. Réservé au super_admin (gate session + garde RPC).
// Body : { email: string, privilege?: "super_admin" | "standard" }.
export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!session.isSuperAdmin) {
    return NextResponse.json({ error: adminOpMessage("forbidden") }, { status: 403 });
  }

  let body: { email?: string; privilege?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  const email = (body.email ?? "").trim();
  if (!email) {
    return NextResponse.json({ error: "Email requis." }, { status: 400 });
  }
  const privilege: AdminPrivilege =
    body.privilege === "super_admin" ? "super_admin" : "standard";

  const result = await promoteAdminByEmail(session.id, email, privilege);
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
