import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dbErrorResponse } from "@/lib/api/db-error-response";
import { logProducersAdminEvent } from "@/lib/audit-logs/log-producers-admin-event";
import { revalidatePublicStats } from "@/lib/stats/revalidate";
import { revalidateProducersSearch } from "@/lib/stats/revalidate";
import { PRODUCER_STATUS_VALUES } from "@/lib/admin/producers/types";

// PATCH /api/admin/producers/[id]/statut — refacto PR
// refactor/admin-pattern-uniform : remplace l'UPDATE direct browser-client
// (cf. audit § 7.2). Pattern WRITE admin canonique : auth check explicit
// session.isAdmin → service_role → audit log obligatoire → revalidation
// des caches publics impactés.
//
// Le trigger DB `producers_block_owner_admin_columns_trigger` (T-218,
// migration 20260506165934) bloque les self-updates owner sur `statut` ;
// le service_role bypass le trigger (cf. branchement
// `auth.role() = 'service_role'` ligne 67 de la fonction trigger). Côté
// authenticated admin, le bypass passe par `is_admin()` — mais ici on
// service_role pour aller plus vite et garder le pattern uniforme avec les
// autres routes admin de mutation.

const bodySchema = z.object({
  statut: z.enum(PRODUCER_STATUS_VALUES),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, props: RouteContext) {
  const { id } = await props.params;

  const session = await getSessionUser();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();

  // Pre-SELECT pour 404 + capture before pour audit log (previous_statut
  // + snapshot nom/slug utiles à la lecture forensique côté /audit-logs).
  // Sans cette SELECT, UPDATE eq id inexistant renvoie 0 rows sans erreur
  // (cohérent pattern categorisation/route.ts).
  const { data: before, error: selectError } = await admin
    .from("producers")
    .select("id, statut, nom_exploitation, slug")
    .eq("id", id)
    .maybeSingle();

  if (selectError) {
    return dbErrorResponse(selectError, "ADMIN_PRODUCER_STATUT_SELECT", {
      admin_id: session.id,
      producer_id: id,
    });
  }
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // No-op explicite : on retourne 200 sans audit ni revalidate pour éviter
  // un event audit_logs vide (previous == new). Cohérent avec les autres
  // routes admin de mutation qui filtrent les no-op au call site.
  if (before.statut === parsed.data.statut) {
    return NextResponse.json({ id, statut: parsed.data.statut, noop: true });
  }

  const { error: updateError } = await admin
    .from("producers")
    .update({ statut: parsed.data.statut })
    .eq("id", id);

  if (updateError) {
    return dbErrorResponse(updateError, "ADMIN_PRODUCER_STATUT_UPDATE", {
      admin_id: session.id,
      producer_id: id,
      new_statut: parsed.data.statut,
    });
  }

  await logProducersAdminEvent({
    eventType: "admin_producer_statut_changed",
    userId: session.id,
    metadata: {
      producer_id: id,
      previous_statut: before.statut,
      new_statut: parsed.data.statut,
      producer_name: before.nom_exploitation,
      producer_slug: before.slug,
    },
  });

  // Invalidation caches publics impactés. Toute transition admin peut faire
  // entrer/sortir le producer du filtre statut='public' du cache
  // public-stats et de la RPC search_producers. Inconditionnel pour
  // simplifier (le tag invalidation est cheap, le revalidate côté Next est
  // fait sur le tag). Cohérent ancien comportement page CSR
  // (revalidatePublicStats explicit après UPDATE).
  await revalidatePublicStats({
    source: "admin-producers-statut-patch",
    extra: { producerId: id, newStatut: parsed.data.statut },
  });
  await revalidateProducersSearch({
    source: "admin-producers-statut-patch",
    producerId: id,
  });

  // Re-render la page admin elle-même pour que le Server Component refetch
  // la liste à la prochaine navigation (le sub-client la rafraîchit via
  // router.refresh() côté UI mais le path-level revalidate garantit que
  // la nav directe (Back, lien Sidebar) re-fetch aussi).
  revalidatePath("/gestion-producteurs");

  return NextResponse.json({ id, statut: parsed.data.statut });
}
