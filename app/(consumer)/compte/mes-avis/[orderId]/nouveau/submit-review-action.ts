"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Server action : soumission d'un avis depuis /mes-avis/[orderId]/nouveau.
//
// Validation Zod conditionnelle (cycle qualité 2026-05-07) : pour les notes
// basses (≤ 3 étoiles), un commentaire d'au moins 10 caractères est exigé.
// Justification UX : forcer le consumer mécontent à expliquer permet au
// producer de comprendre + admin de modérer plus efficacement.
//
// Cohérent avec l'API publique POST /api/reviews/create (même schéma).
//
// Pattern aligné avec les autres server actions consumer :
//   - getSessionUser() pour auth
//   - user-client SELECT order (RLS-aware)
//   - applicatif check consumer_id (defense-in-depth)
//   - INSERT review user-client (RLS valide auth.uid()=consumer_id)
//   - notifications admin via admin-client (RLS bloque INSERT user-client)
//   - redirect("/mes-avis?success=1") on success

const formSchema = z
  .object({
    order_id: z.string().uuid("Order ID invalide"),
    note: z.coerce.number().int().min(1).max(5),
    commentaire: z.string().trim().max(500).optional(),
  })
  .refine(
    (data) => {
      if (data.note <= 3) {
        return (
          typeof data.commentaire === "string" &&
          data.commentaire.length >= 10
        );
      }
      return true;
    },
    {
      message:
        "Pour une note de 3 étoiles ou moins, un commentaire d'au moins 10 caractères est requis",
      path: ["commentaire"],
    },
  );

export type SubmitReviewState = {
  error?: string;
  fieldErrors?: { note?: string; commentaire?: string };
};

export async function submitReviewAction(
  _prev: SubmitReviewState,
  formData: FormData,
): Promise<SubmitReviewState> {
  const session = await getSessionUser();
  if (!session) {
    return { error: "Session expirée. Reconnectez-vous." };
  }

  const parsed = formSchema.safeParse({
    order_id: formData.get("order_id"),
    note: formData.get("note"),
    commentaire: formData.get("commentaire") || undefined,
  });

  if (!parsed.success) {
    const fieldErrors: SubmitReviewState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (path === "note") fieldErrors.note = issue.message;
      if (path === "commentaire") fieldErrors.commentaire = issue.message;
    }
    return {
      error: parsed.error.issues[0]?.message ?? "Saisie invalide",
      fieldErrors,
    };
  }

  const supabase = await createSupabaseServerClient();

  // RLS "orders parties read" filtre naturellement.
  const { data: order } = await supabase
    .from("orders")
    .select("id, producer_id, consumer_id, statut")
    .eq("id", parsed.data.order_id)
    .maybeSingle();

  if (!order) {
    return { error: "Commande introuvable." };
  }
  if (order.consumer_id !== session.id) {
    return { error: "Cette commande ne vous appartient pas." };
  }
  if (order.statut !== "completed") {
    return { error: "La commande doit être terminée pour la noter." };
  }

  // Anti-doublon (RLS "reviews author read" filtre sur consumer_id = auth.uid()).
  const { data: existing } = await supabase
    .from("reviews")
    .select("id")
    .eq("order_id", order.id)
    .maybeSingle();
  if (existing) {
    return { error: "Un avis existe déjà pour cette commande." };
  }

  const { data: review, error: insertError } = await supabase
    .from("reviews")
    .insert({
      order_id: order.id,
      consumer_id: order.consumer_id,
      producer_id: order.producer_id,
      note: parsed.data.note,
      commentaire: parsed.data.commentaire ?? null,
      statut: "pending",
    })
    .select("id")
    .single();

  if (insertError || !review) {
    console.error(
      `[REVIEW_INSERT_ERR] order_id=${order.id} error=${insertError?.message ?? "unknown"}`,
    );
    return { error: "Impossible d'enregistrer ton avis. Réessaye plus tard." };
  }

  // Notifications admin : admin-client requis (RLS notifications n'autorise
  // que self-read côté authenticated).
  const admin = createSupabaseAdminClient();
  const { data: admins } = await admin.from("admin_users").select("id");
  if (admins && admins.length > 0) {
    const { error: notifErr } = await admin.from("notifications").insert(
      admins.map((a) => ({
        user_id: a.id,
        type: "email",
        template: "admin_review_pending",
        statut: "sent",
        metadata: {
          review_id: review.id,
          order_id: order.id,
          producer_id: order.producer_id,
          note: parsed.data.note,
        },
      })),
    );
    if (notifErr) {
      console.error(
        `[NOTIF_INSERT_ERR] template=admin_review_pending count=${admins.length} error=${notifErr.message}`,
      );
    }
  }

  redirect("/compte/mes-avis?success=1");
}
