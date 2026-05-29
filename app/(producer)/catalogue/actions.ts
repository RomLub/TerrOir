"use server";

import { z } from "zod";
import { TZDate } from "@date-fns/tz";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveProducerOwner } from "@/lib/producers/resolve-owner";
import { adHocSlotSchema } from "@/lib/slots/validators";
import {
  revalidatePublicStats,
  revalidatePublicProducts,
  revalidateProducerProducts,
  revalidateProducersSearch,
} from "@/lib/stats/revalidate";

const TZ_PARIS = "Europe/Paris";

const reservedProductSlotSchema = z
  .object({
    start_at: z.string(),
    end_at: z.string(),
    capacity_per_slot: z.coerce.number().int(),
    mode: z.literal("libre").default("libre"),
  })
  .superRefine((slot, ctx) => {
    const parsed = adHocSlotSchema.safeParse(slot);
    if (parsed.success) return;
    const issue = parsed.error.issues[0];
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: issue?.path ?? [],
      message: issue?.message ?? "Creneau invalide",
    });
  });

// Actions serveur d'écriture du catalogue (chantier 3 — plomberie). Remplacent
// les insert/update Supabase navigateur. `producer_id` vient TOUJOURS de
// l'ownership serveur (resolveProducerOwner), jamais du client. La liste
// blanche zod borne les colonnes écrites (clés inconnues supprimées).
// NB : la table products est aussi protégée par la RLS « products owner all »,
// mais en service_role on la bypasse — l'ownership + le schema sont le contrôle.

export type ProductActionState = {
  error?: string;
  success?: boolean;
  productId?: string;
};

const productSchema = z.object({
  nom: z.string().trim().min(1, "Le nom est requis").max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  prix: z.number().positive("Le prix doit être positif"),
  unite: z.string().trim().min(1).max(20),
  poids_estime_kg: z.number().positive().nullable().optional(),
  stock_disponible: z.number().int().min(0),
  stock_illimite: z.boolean(),
  delai_preparation_jours: z.number().int().min(0).max(365),
  active: z.boolean(),
  photos: z.array(z.string().max(2000)).max(5).nullable().optional(),
  conseil_active: z.boolean(),
  conseil_texte: z.string().trim().max(280).nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  animal_id: z.string().uuid().nullable().optional(),
  cut_id: z.string().uuid().nullable().optional(),
  pickup_availability_mode: z
    .enum(["all_shared_slots", "selected_slots"])
    .default("all_shared_slots"),
  slot_ids: z.array(z.string().uuid()).default([]),
  reserved_slots: z
    .array(reservedProductSlotSchema)
    .max(5)
    .default([]),
});

export type ProductInput = z.input<typeof productSchema>;

function buildRow(d: z.infer<typeof productSchema>) {
  return {
    nom: d.nom,
    description: d.description ?? null,
    prix: d.prix,
    unite: d.unite,
    poids_estime_kg: d.poids_estime_kg ?? null,
    stock_disponible: d.stock_illimite ? 0 : d.stock_disponible,
    stock_illimite: d.stock_illimite,
    delai_preparation_jours: d.delai_preparation_jours,
    active: d.active,
    photos: d.photos && d.photos.length > 0 ? d.photos : null,
    conseil_active: d.conseil_active,
    conseil_texte: d.conseil_active ? (d.conseil_texte ?? null) : null,
    category_id: d.category_id ?? null,
    animal_id: d.animal_id ?? null,
    cut_id: d.cut_id ?? null,
    pickup_availability_mode: d.pickup_availability_mode,
  };
}

function uniqueIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids));
}

function localDateTimeToParisUTC(local: string): string {
  const [datePart, timePart = "00:00"] = local.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  return new TZDate(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, TZ_PARIS)
    .toISOString();
}

async function ensureSlotsBelongToProducer(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  producerId: string;
  slotIds: readonly string[];
}): Promise<{ ok: true } | { error: string }> {
  const slotIds = uniqueIds(params.slotIds);
  if (slotIds.length === 0) return { ok: true };

  const { data, error } = await params.admin
    .from("slots")
    .select("id, producer_id")
    .in("id", slotIds);

  if (error) {
    console.error(
      `PRODUCT_SLOT_VALIDATE_ERROR producer_id=${params.producerId} error=${error.message}`,
    );
    return { error: "Impossible de verifier les creneaux selectionnes." };
  }

  const ownedIds = new Set(
    ((data ?? []) as Array<{ id: string; producer_id: string | null }>)
      .filter((slot) => slot.producer_id === params.producerId)
      .map((slot) => slot.id),
  );

  if (ownedIds.size !== slotIds.length) {
    return { error: "Un creneau selectionne est introuvable." };
  }

  return { ok: true };
}

async function createReservedSlotsForProduct(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  producerId: string;
  reservedSlots: z.infer<typeof productSchema>["reserved_slots"];
}): Promise<{ slotIds: string[] } | { error: string }> {
  if (params.reservedSlots.length === 0) return { slotIds: [] };

  const rows = params.reservedSlots.map((slot) => ({
    producer_id: params.producerId,
    rule_id: null,
    starts_at: localDateTimeToParisUTC(slot.start_at),
    ends_at: localDateTimeToParisUTC(slot.end_at),
    capacity_per_slot: slot.capacity_per_slot,
    active: true,
    availability_scope: "product_restricted",
  }));

  const { data: conflictingSlots, error: conflictError } = await params.admin
    .from("slots")
    .select("id")
    .eq("producer_id", params.producerId)
    .in(
      "starts_at",
      rows.map((row) => row.starts_at),
    );

  if (conflictError) {
    console.error(
      `PRODUCT_RESERVED_SLOT_CONFLICT_CHECK_ERROR producer_id=${params.producerId} error=${conflictError.message}`,
    );
    return { error: "Impossible de verifier le creneau reserve." };
  }

  if ((conflictingSlots ?? []).length > 0) {
    return {
      error:
        "Un creneau existe deja a cet horaire. Selectionnez-le dans la liste.",
    };
  }

  const { data: insertedSlots, error: insertError } = await params.admin
    .from("slots")
    .insert(rows)
    .select("id");

  if (insertError || !insertedSlots) {
    console.error(
      `PRODUCT_RESERVED_SLOT_CREATE_ERROR producer_id=${params.producerId} error=${insertError?.message}`,
    );
    return { error: "Impossible de creer le creneau reserve." };
  }

  return {
    slotIds: (insertedSlots as Array<{ id: string }>).map((slot) => slot.id),
  };
}

async function getLinkedRestrictedSlotIds(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  productId: string;
}): Promise<string[]> {
  const { data: links } = await params.admin
    .from("product_slot_availabilities")
    .select("slot_id")
    .eq("product_id", params.productId);

  const linkedSlotIds = ((links ?? []) as Array<{ slot_id: string }>).map(
    (link) => link.slot_id,
  );
  if (linkedSlotIds.length === 0) return [];

  const { data: slots } = await params.admin
    .from("slots")
    .select("id, availability_scope")
    .in("id", linkedSlotIds);

  return ((slots ?? []) as Array<{ id: string; availability_scope: string }>)
    .filter((slot) => slot.availability_scope === "product_restricted")
    .map((slot) => slot.id);
}

async function syncProductSlotLinks(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  productId: string;
  desiredSlotIds: readonly string[];
}): Promise<{ ok: true } | { error: string }> {
  const desiredSlotIds = uniqueIds(params.desiredSlotIds);

  const { error: deleteError } = await params.admin
    .from("product_slot_availabilities")
    .delete()
    .eq("product_id", params.productId);

  if (deleteError) {
    console.error(
      `PRODUCT_SLOT_LINK_DELETE_ERROR product_id=${params.productId} error=${deleteError.message}`,
    );
    return { error: "Impossible de mettre a jour les creneaux du produit." };
  }

  if (desiredSlotIds.length === 0) return { ok: true };

  const { error: insertError } = await params.admin
    .from("product_slot_availabilities")
    .insert(
      desiredSlotIds.map((slotId) => ({
        product_id: params.productId,
        slot_id: slotId,
      })),
    );

  if (insertError) {
    console.error(
      `PRODUCT_SLOT_LINK_INSERT_ERROR product_id=${params.productId} error=${insertError.message}`,
    );
    return { error: "Impossible de mettre a jour les creneaux du produit." };
  }

  return { ok: true };
}

async function invalidateForProduct(opts: {
  productId: string;
  producerId: string;
  slug: string;
  source: string;
}) {
  await revalidatePublicStats({
    source: opts.source,
    extra: { productId: opts.productId },
  });
  await revalidatePublicProducts({
    source: opts.source,
    productId: opts.productId,
  });
  if (opts.slug) {
    await revalidateProducerProducts({ slug: opts.slug, source: opts.source });
  }
  await revalidateProducersSearch({
    source: opts.source,
    producerId: opts.producerId,
    extra: { productId: opts.productId },
  });
}

export async function createProductAction(
  input: ProductInput,
): Promise<ProductActionState> {
  const session = await getSessionUser();
  if (!session) return { error: "Non authentifié" };

  const res = await resolveProducerOwner(session.id);
  if ("error" in res) return { error: res.error };
  const { owner } = res;

  const parsed = productSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }

  const admin = createSupabaseAdminClient();
  const selectedSlotIds =
    parsed.data.pickup_availability_mode === "selected_slots"
      ? uniqueIds(parsed.data.slot_ids)
      : [];

  if (
    parsed.data.pickup_availability_mode === "selected_slots" &&
    selectedSlotIds.length === 0 &&
    parsed.data.reserved_slots.length === 0
  ) {
    return { error: "Selectionnez au moins un creneau pour ce produit." };
  }

  const slotsValidation = await ensureSlotsBelongToProducer({
    admin,
    producerId: owner.id,
    slotIds: selectedSlotIds,
  });
  if ("error" in slotsValidation) return slotsValidation;

  const { data: inserted, error: insertError } = await admin
    .from("products")
    .insert({ ...buildRow(parsed.data), producer_id: owner.id })
    .select("id")
    .single();

  if (insertError || !inserted) {
    console.error(
      `CREATE_PRODUCT_ERROR producer_id=${owner.id} error=${insertError?.message}`,
    );
    return { error: "Impossible de créer le produit." };
  }

  const productId = inserted.id as string;
  const reservedSlotsRes = await createReservedSlotsForProduct({
    admin,
    producerId: owner.id,
    reservedSlots: parsed.data.reserved_slots,
  });
  if ("error" in reservedSlotsRes) return reservedSlotsRes;

  const desiredSlotIds =
    parsed.data.pickup_availability_mode === "selected_slots"
      ? [...selectedSlotIds, ...reservedSlotsRes.slotIds]
      : reservedSlotsRes.slotIds;

  const linksRes = await syncProductSlotLinks({
    admin,
    productId,
    desiredSlotIds,
  });
  if ("error" in linksRes) return linksRes;

  if (parsed.data.active) {
    await invalidateForProduct({
      productId,
      producerId: owner.id,
      slug: owner.slug,
      source: "producer-catalogue-create",
    });
  }

  return { success: true, productId };
}

export async function updateProductAction(
  productId: string,
  input: ProductInput,
): Promise<ProductActionState> {
  const session = await getSessionUser();
  if (!session) return { error: "Non authentifié" };

  const res = await resolveProducerOwner(session.id);
  if ("error" in res) return { error: res.error };
  const { owner } = res;

  const admin = createSupabaseAdminClient();

  // Ownership : le produit doit appartenir au producteur de la session.
  const { data: existing } = await admin
    .from("products")
    .select("id, producer_id")
    .eq("id", productId)
    .maybeSingle();
  if (!existing || existing.producer_id !== owner.id) {
    return { error: "Produit introuvable." };
  }

  const parsed = productSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }

  const selectedSlotIds =
    parsed.data.pickup_availability_mode === "selected_slots"
      ? uniqueIds(parsed.data.slot_ids)
      : [];
  if (
    parsed.data.pickup_availability_mode === "selected_slots" &&
    selectedSlotIds.length === 0 &&
    parsed.data.reserved_slots.length === 0
  ) {
    return { error: "Selectionnez au moins un creneau pour ce produit." };
  }

  const slotsValidation = await ensureSlotsBelongToProducer({
    admin,
    producerId: owner.id,
    slotIds: selectedSlotIds,
  });
  if ("error" in slotsValidation) return slotsValidation;

  const { error: updateError } = await admin
    .from("products")
    .update(buildRow(parsed.data))
    .eq("id", productId);

  if (updateError) {
    console.error(
      `UPDATE_PRODUCT_ERROR product_id=${productId} error=${updateError.message}`,
    );
    return { error: "Impossible de mettre à jour le produit." };
  }

  const reservedSlotsRes = await createReservedSlotsForProduct({
    admin,
    producerId: owner.id,
    reservedSlots: parsed.data.reserved_slots,
  });
  if ("error" in reservedSlotsRes) return reservedSlotsRes;

  const preservedRestrictedSlotIds =
    parsed.data.pickup_availability_mode === "all_shared_slots"
      ? await getLinkedRestrictedSlotIds({ admin, productId })
      : [];
  const desiredSlotIds =
    parsed.data.pickup_availability_mode === "selected_slots"
      ? [...selectedSlotIds, ...reservedSlotsRes.slotIds]
      : [...preservedRestrictedSlotIds, ...reservedSlotsRes.slotIds];

  const linksRes = await syncProductSlotLinks({
    admin,
    productId,
    desiredSlotIds,
  });
  if ("error" in linksRes) return linksRes;

  // Inconditionnel : un flip active true→false impacte aussi les compteurs.
  await invalidateForProduct({
    productId,
    producerId: owner.id,
    slug: owner.slug,
    source: "producer-catalogue-update",
  });

  return { success: true };
}
