"use server";

import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveProducerOwner } from "@/lib/producers/resolve-owner";
import {
  revalidatePublicStats,
  revalidatePublicProducts,
  revalidateProducerProducts,
  revalidateProducersSearch,
} from "@/lib/stats/revalidate";

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
  };
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

  // Inconditionnel : un flip active true→false impacte aussi les compteurs.
  await invalidateForProduct({
    productId,
    producerId: owner.id,
    slug: owner.slug,
    source: "producer-catalogue-update",
  });

  return { success: true };
}
