import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dbErrorResponse } from "@/lib/api/db-error-response";
import { logRefundIncidentsEvent } from "@/lib/audit-logs/log-refund-incidents-event";
import { isRefundIncidentActionable } from "@/lib/admin/refund-incidents/types";

// POST /api/admin/refund-incidents/[id]/resolve — PR3 feature/admin-new-
// surfaces (gap AUDIT_ADMIN.md §6 P0 #3). Marque un incident refund
// Stripe comme `manually_resolved` après intervention humaine (ex :
// virement bancaire hors-Stripe, contact consumer pour avoir, etc.).
//
// Pattern WRITE admin canonique (cf. PR1 /api/admin/producers/[id]/statut) :
// auth check session.isAdmin → Zod body → pre-SELECT pour 404 + snapshot
// audit → validation transition statut → UPDATE service_role → audit log
// obligatoire → revalidatePath caches admin.
//
// Validation transition : seuls les statuts `pending` et `retrying` sont
// actionnables. Bloque la résolution manuelle d'un incident déjà résolu
// (`succeeded` ou `manually_resolved`), épuisé (`exhausted`), ou annulé
// (`aborted`) pour préserver l'historique forensique. Cf.
// REFUND_INCIDENT_ACTIONABLE_STATUSES (lib/admin/refund-incidents/types).

const bodySchema = z.object({
  note: z
    .string()
    .min(5, "La note de résolution doit faire au moins 5 caractères")
    .max(2000, "La note de résolution est limitée à 2000 caractères"),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, props: RouteContext) {
  const { id } = await props.params;

  const session = await getSessionUser();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();

  // Pre-SELECT : 404 si introuvable + snapshot pour audit log (order_id,
  // status avant, montant via jointure orders). Cohérent pattern PR1
  // (cf. /api/admin/producers/[id]/statut/route.ts).
  const { data: before, error: selectError } = await admin
    .from("refund_incidents")
    .select(
      "id, order_id, status, order:order_id ( code_commande, montant_total )",
    )
    .eq("id", id)
    .maybeSingle();

  if (selectError) {
    return dbErrorResponse(selectError, "ADMIN_REFUND_INCIDENT_RESOLVE_SELECT", {
      admin_id: session.id,
      incident_id: id,
    });
  }
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Validation transition statut. Statuts actionnables strictement
  // limités à `pending` + `retrying` (cf. isRefundIncidentActionable) :
  // un incident déjà résolu / épuisé / annulé ne doit pas être rouvert
  // par cette surface — toute correction d'historique passe par une
  // requête SQL explicite côté SRE (avec trace).
  if (!isRefundIncidentActionable(before.status)) {
    return NextResponse.json(
      { error: "Incident dans un statut non actionnable" },
      { status: 409 },
    );
  }

  // UPDATE service_role. resolution_note + resolved_at = now() + status
  // = 'manually_resolved'. updated_at est géré côté DB (trigger ou
  // default — cf. migration T-102).
  const nowIso = new Date().toISOString();
  const { error: updateError } = await admin
    .from("refund_incidents")
    .update({
      status: "manually_resolved",
      resolution_note: parsed.data.note,
      resolved_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", id);

  if (updateError) {
    return dbErrorResponse(updateError, "ADMIN_REFUND_INCIDENT_RESOLVE_UPDATE", {
      admin_id: session.id,
      incident_id: id,
    });
  }

  // Extraction snapshot orders (jointure 1:1, peut être array ou objet
  // selon version du client Supabase). Montant en cents pour metadata
  // audit log (cohérence Stripe forensique).
  const orderJoin = Array.isArray(before.order)
    ? before.order[0]
    : before.order;
  const orderCode = orderJoin?.code_commande ?? null;
  const montantTotalRaw = orderJoin?.montant_total;
  const montantNum =
    typeof montantTotalRaw === "string"
      ? Number(montantTotalRaw)
      : (montantTotalRaw as number | null | undefined);
  const amountCents =
    montantNum !== null && montantNum !== undefined && Number.isFinite(montantNum)
      ? Math.round(montantNum * 100)
      : null;

  await logRefundIncidentsEvent({
    eventType: "refund_incident_resolved_manually",
    userId: session.id,
    metadata: {
      incident_id: id,
      order_id: before.order_id,
      order_code: orderCode,
      amount_cents: amountCents,
      previous_status: before.status,
      note: parsed.data.note,
    },
  });

  // Revalidation caches admin : liste (pour que la transition status
  // pending→manually_resolved disparaisse du tab "pending"/"retrying")
  // + détail (pour que la page courante reflète le nouvel état après
  // router.refresh() côté client).
  revalidatePath("/refund-incidents");
  revalidatePath(`/refund-incidents/${id}`);

  return NextResponse.json({ id, status: "manually_resolved" });
}
