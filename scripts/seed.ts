/**
 * Seed de démonstration TerrOir.
 *
 * Crée un producteur test (GAEC du Rheu) avec 5 produits, 3 créneaux,
 * 2 commandes terminées et 2 avis publiés. Idempotent : peut être relancé,
 * les lignes sont détectées par email (users) ou slug (producers).
 *
 * Usage :
 *   npx tsx scripts/seed.ts
 *   # ou, avec Node 22.6+ :
 *   node --env-file=.env.local --experimental-strip-types scripts/seed.ts
 *
 * Variables requises :
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "❌ Manque NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY. " +
      "Source .env.local avant de lancer le script.",
  );
  process.exit(1);
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PRODUCER = {
  slug: "gaec-du-rheu",
  email: "gaec-du-rheu@terroir.test",
  prenom: "Julien",
  nom: "Rheu",
  nom_exploitation: "GAEC du Rheu",
  adresse: "Lieu-dit Bresteau",
  commune: "Saint-Denis-d'Orques",
  code_postal: "72350",
  latitude: 48.0333,
  longitude: -0.3,
  description:
    "Élevage familial en polyculture-élevage sur les coteaux de Saint-Denis-d'Orques : bovins, porcins et ovins élevés au grand air.",
  histoire:
    "Installé depuis trois générations à Bresteau, le GAEC du Rheu associe deux frères qui perpétuent un élevage extensif sur 68 hectares de prairies bocagères.\n\nNous pratiquons une rotation longue, sans intrants de synthèse, et vendons la quasi-totalité de notre production en direct.",
  annee_creation: 1978,
  generations: 3,
  especes: ["bovin", "porcin", "ovin"] as const,
  labels: ["label_rouge", "bio"] as const,
};

const CONSUMERS = [
  {
    email: "camille.rousseau@terroir.test",
    prenom: "Camille",
    nom: "Rousseau",
    telephone: "06 12 34 56 78",
  },
  {
    email: "thomas.vignier@terroir.test",
    prenom: "Thomas",
    nom: "Vignier",
    telephone: "06 98 76 54 32",
  },
];

const PRODUCTS: Array<{
  nom: string;
  description: string;
  prix: number;
  unite: "kg" | "piece" | "colis";
  poids_estime_kg: number | null;
  stock_disponible: number;
  stock_illimite: boolean;
  delai_preparation_jours: number;
}> = [
  {
    nom: "Entrecôte maturée 21 jours",
    description:
      "Pièce noble de nos limousines, maturée sur os 21 jours pour une tendreté incomparable.",
    prix: 34.5,
    unite: "kg",
    poids_estime_kg: 0.3,
    stock_disponible: 8,
    stock_illimite: false,
    delai_preparation_jours: 2,
  },
  {
    nom: "Rôti de bœuf charolais",
    description:
      "Rôti de tranche grasse parée et ficelée. Cuisson au four recommandée.",
    prix: 24.9,
    unite: "kg",
    poids_estime_kg: 1.5,
    stock_disponible: 12,
    stock_illimite: false,
    delai_preparation_jours: 2,
  },
  {
    nom: "Saucisson sec fermier",
    description:
      "Porc élevé à l'ancienne, séché 4 semaines dans notre saloir.",
    prix: 18.0,
    unite: "piece",
    poids_estime_kg: 0.25,
    stock_disponible: 24,
    stock_illimite: false,
    delai_preparation_jours: 1,
  },
  {
    nom: "Côtelettes de porc fermier",
    description: "Côtelettes épaisses, viande persillée, idéales au grill.",
    prix: 15.9,
    unite: "kg",
    poids_estime_kg: null,
    stock_disponible: 10,
    stock_illimite: false,
    delai_preparation_jours: 2,
  },
  {
    nom: "Gigot d'agneau de pré",
    description:
      "Agneau de nos prés-salés, ficelé pour une cuisson au four parfaite.",
    prix: 28.0,
    unite: "kg",
    poids_estime_kg: 2.2,
    stock_disponible: 4,
    stock_illimite: false,
    delai_preparation_jours: 3,
  },
];

// Monday=1, Wednesday=3, Saturday=6 (Postgres DOW: Sunday=0..Saturday=6)
const SLOTS: Array<{ jour_semaine: number; heure_debut: string; heure_fin: string }> = [
  { jour_semaine: 3, heure_debut: "17:00", heure_fin: "19:00" },
  { jour_semaine: 5, heure_debut: "10:00", heure_fin: "12:00" },
  { jour_semaine: 6, heure_debut: "10:00", heure_fin: "13:00" },
];

const REVIEWS_DATA = [
  {
    consumerIndex: 0,
    note: 5,
    commentaire:
      "Viande exceptionnelle, maturation parfaite. On sent immédiatement la différence. Julien est passionné et prend le temps d'expliquer.",
  },
  {
    consumerIndex: 1,
    note: 4,
    commentaire:
      "Très bon rôti, cuisson réussie. Petit bémol sur l'attente au retrait, sinon rien à redire.",
  },
];

async function findUserIdByEmail(email: string): Promise<string | null> {
  const { data } = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function ensureAuthUser(
  email: string,
  role: "producer" | "consumer",
  prenom: string,
  nom: string,
  telephone?: string,
): Promise<string> {
  const existing = await findUserIdByEmail(email);
  if (existing) return existing;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password: `seed-${Math.random().toString(36).slice(2, 18)}`,
    user_metadata: { role, prenom, nom },
  });
  if (createError || !created.user) {
    throw new Error(`createUser(${email}) : ${createError?.message ?? "no user returned"}`);
  }

  const { error: upsertError } = await admin
    .from("users")
    .upsert(
      {
        id: created.user.id,
        email,
        role,
        prenom,
        nom,
        telephone: telephone ?? null,
        sms_optin: false,
      },
      { onConflict: "id" },
    );
  if (upsertError) throw new Error(`users upsert ${email} : ${upsertError.message}`);

  return created.user.id;
}

async function ensureProducer(userId: string): Promise<string> {
  const { data: existing } = await admin
    .from("producers")
    .select("id")
    .eq("slug", PRODUCER.slug)
    .maybeSingle();

  if (existing) {
    const { error: updateError } = await admin
      .from("producers")
      .update({
        user_id: userId,
        nom_exploitation: PRODUCER.nom_exploitation,
        adresse: PRODUCER.adresse,
        commune: PRODUCER.commune,
        code_postal: PRODUCER.code_postal,
        latitude: PRODUCER.latitude,
        longitude: PRODUCER.longitude,
        description: PRODUCER.description,
        histoire: PRODUCER.histoire,
        annee_creation: PRODUCER.annee_creation,
        generations: PRODUCER.generations,
        especes: [...PRODUCER.especes],
        labels: [...PRODUCER.labels],
        statut: "active",
      })
      .eq("id", existing.id);
    if (updateError) throw new Error(`producer update : ${updateError.message}`);
    return existing.id as string;
  }

  const { data: inserted, error: insertError } = await admin
    .from("producers")
    .insert({
      user_id: userId,
      slug: PRODUCER.slug,
      nom_exploitation: PRODUCER.nom_exploitation,
      adresse: PRODUCER.adresse,
      commune: PRODUCER.commune,
      code_postal: PRODUCER.code_postal,
      latitude: PRODUCER.latitude,
      longitude: PRODUCER.longitude,
      description: PRODUCER.description,
      histoire: PRODUCER.histoire,
      annee_creation: PRODUCER.annee_creation,
      generations: PRODUCER.generations,
      especes: [...PRODUCER.especes],
      labels: [...PRODUCER.labels],
      statut: "active",
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    throw new Error(`producer insert : ${insertError?.message ?? "no row"}`);
  }
  return inserted.id as string;
}

async function ensureProducts(producerId: string): Promise<string[]> {
  const { data: existing } = await admin
    .from("products")
    .select("id, nom")
    .eq("producer_id", producerId);

  const existingByName = new Map(
    (existing ?? []).map((p) => [p.nom as string, p.id as string]),
  );

  const ids: string[] = [];
  for (const p of PRODUCTS) {
    const existingId = existingByName.get(p.nom);
    if (existingId) {
      await admin
        .from("products")
        .update({
          description: p.description,
          prix: p.prix,
          unite: p.unite,
          poids_estime_kg: p.poids_estime_kg,
          stock_disponible: p.stock_disponible,
          stock_illimite: p.stock_illimite,
          delai_preparation_jours: p.delai_preparation_jours,
          actif: true,
        })
        .eq("id", existingId);
      ids.push(existingId);
      continue;
    }
    const { data: inserted, error } = await admin
      .from("products")
      .insert({
        producer_id: producerId,
        nom: p.nom,
        description: p.description,
        prix: p.prix,
        unite: p.unite,
        poids_estime_kg: p.poids_estime_kg,
        stock_disponible: p.stock_disponible,
        stock_illimite: p.stock_illimite,
        delai_preparation_jours: p.delai_preparation_jours,
        actif: true,
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(`product insert ${p.nom} : ${error?.message}`);
    ids.push(inserted.id as string);
  }
  return ids;
}

async function ensureSlots(producerId: string): Promise<string[]> {
  const { data: existing } = await admin
    .from("slots")
    .select("id, jour_semaine, heure_debut")
    .eq("producer_id", producerId);

  const existingKey = new Map<string, string>(
    (existing ?? []).map((s) => [
      `${s.jour_semaine}|${String(s.heure_debut).slice(0, 5)}`,
      s.id as string,
    ]),
  );

  const ids: string[] = [];
  for (const s of SLOTS) {
    const key = `${s.jour_semaine}|${s.heure_debut}`;
    const existingId = existingKey.get(key);
    if (existingId) {
      ids.push(existingId);
      continue;
    }
    const { data: inserted, error } = await admin
      .from("slots")
      .insert({
        producer_id: producerId,
        jour_semaine: s.jour_semaine,
        heure_debut: s.heure_debut,
        heure_fin: s.heure_fin,
        actif: true,
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(`slot insert : ${error?.message}`);
    ids.push(inserted.id as string);
  }
  return ids;
}

async function ensureCompletedOrder(
  consumerId: string,
  producerId: string,
  slotId: string,
  productId: string,
  quantite: number,
  prix: number,
  dateRetraitDaysAgo: number,
): Promise<string> {
  // Idempotence : une seule commande seedée par (consumer, producer, product).
  const { data: existing } = await admin
    .from("orders")
    .select("id, order_items!inner(product_id)")
    .eq("consumer_id", consumerId)
    .eq("producer_id", producerId)
    .eq("statut", "completed")
    .limit(10);
  if (existing) {
    for (const o of existing) {
      const items = Array.isArray(o.order_items) ? o.order_items : [o.order_items];
      if (items.some((it) => (it as { product_id: string }).product_id === productId)) {
        return o.id as string;
      }
    }
  }

  const retrait = new Date();
  retrait.setUTCDate(retrait.getUTCDate() - dateRetraitDaysAgo);
  const dateIso = retrait.toISOString().slice(0, 10);
  const total = Math.round(quantite * prix * 100) / 100;
  const commission = Math.round(total * 0.06 * 100) / 100;

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      consumer_id: consumerId,
      producer_id: producerId,
      slot_id: slotId,
      date_retrait: dateIso,
      heure_retrait: "10:00",
      statut: "completed",
      montant_total: total,
      commission_terroir: commission,
      montant_net_producteur: total - commission,
      completed_at: new Date(retrait.getTime() + 11 * 3600 * 1000).toISOString(),
      confirmed_at: new Date(retrait.getTime() - 2 * 24 * 3600 * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (orderError || !order) {
    throw new Error(`order insert : ${orderError?.message ?? "no row"}`);
  }

  const { error: itemError } = await admin.from("order_items").insert({
    order_id: order.id,
    product_id: productId,
    quantite,
    prix_unitaire: prix,
    sous_total: total,
  });
  if (itemError) throw new Error(`order_items insert : ${itemError.message}`);

  return order.id as string;
}

async function ensureReview(
  orderId: string,
  consumerId: string,
  producerId: string,
  note: number,
  commentaire: string,
): Promise<void> {
  const { data: existing } = await admin
    .from("reviews")
    .select("id")
    .eq("order_id", orderId)
    .maybeSingle();
  if (existing) {
    await admin
      .from("reviews")
      .update({
        note,
        commentaire,
        statut: "published",
        published_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    return;
  }

  const { error } = await admin.from("reviews").insert({
    order_id: orderId,
    consumer_id: consumerId,
    producer_id: producerId,
    note,
    commentaire,
    statut: "published",
    published_at: new Date().toISOString(),
  });
  if (error) throw new Error(`review insert : ${error.message}`);
}

async function refreshProducerRatingCache(producerId: string): Promise<void> {
  const { data } = await admin
    .from("reviews")
    .select("note")
    .eq("producer_id", producerId)
    .eq("statut", "published");

  const rows = data ?? [];
  const nb = rows.length;
  const avg =
    nb > 0
      ? Math.round((rows.reduce((s, r) => s + Number(r.note), 0) / nb) * 100) / 100
      : 0;

  await admin
    .from("producers")
    .update({ note_moyenne: avg, nb_avis: nb })
    .eq("id", producerId);
}

async function main() {
  console.log("🌱 Seed TerrOir …");

  const producerUserId = await ensureAuthUser(
    PRODUCER.email,
    "producer",
    PRODUCER.prenom,
    PRODUCER.nom,
  );
  console.log(`  ✓ user producteur ${PRODUCER.email}`);

  const producerId = await ensureProducer(producerUserId);
  console.log(`  ✓ producteur ${PRODUCER.nom_exploitation} (${producerId})`);

  const productIds = await ensureProducts(producerId);
  console.log(`  ✓ ${productIds.length} produits`);

  const slotIds = await ensureSlots(producerId);
  console.log(`  ✓ ${slotIds.length} créneaux`);

  const consumerIds: string[] = [];
  for (const c of CONSUMERS) {
    const id = await ensureAuthUser(c.email, "consumer", c.prenom, c.nom, c.telephone);
    consumerIds.push(id);
  }
  console.log(`  ✓ ${consumerIds.length} consommateurs`);

  // 2 commandes terminées pour pouvoir rattacher 2 avis.
  const orderId1 = await ensureCompletedOrder(
    consumerIds[0],
    producerId,
    slotIds[1],
    productIds[0], // entrecôte
    0.75,
    PRODUCTS[0].prix,
    14,
  );
  const orderId2 = await ensureCompletedOrder(
    consumerIds[1],
    producerId,
    slotIds[2],
    productIds[1], // rôti
    1.5,
    PRODUCTS[1].prix,
    21,
  );
  console.log(`  ✓ 2 commandes terminées`);

  await ensureReview(
    orderId1,
    consumerIds[REVIEWS_DATA[0].consumerIndex],
    producerId,
    REVIEWS_DATA[0].note,
    REVIEWS_DATA[0].commentaire,
  );
  await ensureReview(
    orderId2,
    consumerIds[REVIEWS_DATA[1].consumerIndex],
    producerId,
    REVIEWS_DATA[1].note,
    REVIEWS_DATA[1].commentaire,
  );
  await refreshProducerRatingCache(producerId);
  console.log(`  ✓ 2 avis publiés + cache note_moyenne`);

  console.log("\n✅ Seed terminé.");
  console.log(`   Producteur public : /producteurs/${PRODUCER.slug}`);
}

main().catch((err) => {
  console.error("❌ Seed échoué :", err);
  process.exit(1);
});
