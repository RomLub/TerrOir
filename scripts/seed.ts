/**
 * Seed de démonstration TerrOir.
 *
 * Crée un producteur test (GAEC du Rheu) avec 5 produits, 1 slot_rule
 * hebdomadaire + 2 slots matérialisés dans le passé pour rattacher 2 commandes
 * terminées et 2 avis publiés. Idempotent : peut être relancé, les lignes sont
 * détectées par email (users) ou slug (producers).
 *
 * Cohabite avec scripts/seed-producers.ts : celui-ci produit les 5 seeds
 * "production-like" (Sarthe, photos unsplash, @seed.terroir-local.fr, cleanable
 * via cleanup-seed.ts). seed.ts produit un unique producteur de test avec un
 * flow de bout-en-bout (producer + produits + slot_rules + slots + orders +
 * reviews + cache note_moyenne) utile pour la démo live et les QA manuels.
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
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import type { UserRole } from "@/lib/auth/roles";

// Charge .env.local depuis la racine du repo AVANT toute lecture process.env.
// Ergonomie Windows PowerShell — pas besoin de sourcer manuellement.
loadEnv({ path: resolve(process.cwd(), ".env.local") });

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
  // Colonnes onboarding producteur (migration 20260421400000). Valeurs dans
  // les enums canoniques : 'gaec' (GAEC du Rheu) / 'elevage' (bovin/porcin/ovin).
  // type_production_precision reste NULL : il n'est affiché dans l'UI que
  // lorsque type_production = 'autre'.
  forme_juridique: "gaec" as const,
  type_production: "elevage" as const,
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

// Nouveau modèle créneaux (migration 20260422300000) : le producer configure
// des slot_rules qui sont matérialisées en instances `slots` par la fonction
// applicative generateSlotsForProducer. Ici on pose 1 rule hebdomadaire
// (mercredi + samedi, 9h-12h, créneaux de 30min, capacité 3) qui suffit
// pour démontrer le flow /creneaux producer + /producteurs/[slug] consumer.
const SLOT_RULES: Array<{
  days_of_week: number[];
  periodicity_weeks: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  capacity_per_slot: number;
  active: boolean;
}> = [
  {
    days_of_week: [3, 6], // mercredi + samedi (Postgres DOW : 0=dim..6=sam)
    periodicity_weeks: 1,
    start_time: "09:00",
    end_time: "12:00",
    slot_duration_minutes: 30,
    capacity_per_slot: 3,
    active: true,
  },
];

// Slots matérialisés à la main dans le passé pour rattacher les 2 commandes
// terminées du seed. Alignés sur le pattern de SLOT_RULES[0] (10:00 et 10:30
// tombent dans l'amplitude 9h-12h avec slots de 30min). En prod, la
// matérialisation est faite par lib/slots/generate.ts (slots futurs
// uniquement), donc on la court-circuite ici pour les dates passées.
const SEED_MATERIALIZED_SLOTS: Array<{
  daysAgo: number;
  hour: number;
  minute: number;
}> = [
  { daysAgo: 14, hour: 10, minute: 0 },
  { daysAgo: 21, hour: 10, minute: 0 },
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
  role: UserRole,
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
    user_metadata: { prenom, nom },
  });
  if (createError || !created.user) {
    throw new Error(`createUser(${email}) : ${createError?.message ?? "no user returned"}`);
  }

  // Rôles cumulables : tout producteur est aussi consumer par défaut.
  const roles = role === "producer" ? ["consumer", "producer"] : ["consumer"];

  const { error: upsertError } = await admin
    .from("users")
    .upsert(
      {
        id: created.user.id,
        email,
        roles,
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
  // statut='public' : visibilité publique immédiate (aligne sur seed-producers.ts
  // depuis commit fcc68e5). Les policies "public read when producer public"
  // (migration 20260422000000) filtrent sur cette valeur.
  const base = {
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
    forme_juridique: PRODUCER.forme_juridique,
    type_production: PRODUCER.type_production,
    statut: "public" as const,
  };

  const { data: existing } = await admin
    .from("producers")
    .select("id")
    .eq("slug", PRODUCER.slug)
    .maybeSingle();

  if (existing) {
    const { error: updateError } = await admin
      .from("producers")
      .update(base)
      .eq("id", existing.id);
    if (updateError) throw new Error(`producer update : ${updateError.message}`);
    return existing.id as string;
  }

  const { data: inserted, error: insertError } = await admin
    .from("producers")
    .insert({ slug: PRODUCER.slug, ...base })
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
          active: true,
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
        active: true,
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(`product insert ${p.nom} : ${error?.message}`);
    ids.push(inserted.id as string);
  }
  return ids;
}

async function ensureSlotRules(producerId: string): Promise<string[]> {
  // Idempotence : on mappe positionnellement les rules SEED → rules DB triées
  // par created_at. S'il y a déjà des rules pour ce producer, on update les N
  // premières pour matcher SLOT_RULES ; sinon on insère. Suffisant pour un
  // seed qui pose une seule rule.
  const { data: existing } = await admin
    .from("slot_rules")
    .select("id")
    .eq("producer_id", producerId)
    .order("created_at", { ascending: true });

  const ids: string[] = [];
  for (let i = 0; i < SLOT_RULES.length; i++) {
    const rule = SLOT_RULES[i];
    const existingId = existing?.[i]?.id as string | undefined;
    const payload = {
      days_of_week: rule.days_of_week,
      periodicity_weeks: rule.periodicity_weeks,
      start_time: rule.start_time,
      end_time: rule.end_time,
      slot_duration_minutes: rule.slot_duration_minutes,
      capacity_per_slot: rule.capacity_per_slot,
      active: rule.active,
    };
    if (existingId) {
      const { error } = await admin
        .from("slot_rules")
        .update(payload)
        .eq("id", existingId);
      if (error) throw new Error(`slot_rule update : ${error.message}`);
      ids.push(existingId);
      continue;
    }
    const { data: inserted, error } = await admin
      .from("slot_rules")
      .insert({ producer_id: producerId, ...payload })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(`slot_rule insert : ${error?.message}`);
    ids.push(inserted.id as string);
  }
  return ids;
}

async function materializeSeedSlots(
  producerId: string,
  ruleId: string,
): Promise<string[]> {
  // Matérialise les slots passés dont les orders seedées ont besoin. UPSERT
  // sur (producer_id, starts_at) (contrainte unique de la migration
  // 20260422300000) pour rester idempotent entre deux lancements.
  const durationMs = SLOT_RULES[0].slot_duration_minutes * 60_000;
  const capacity = SLOT_RULES[0].capacity_per_slot;

  const rows = SEED_MATERIALIZED_SLOTS.map((spec) => {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - spec.daysAgo);
    start.setUTCHours(spec.hour, spec.minute, 0, 0);
    const end = new Date(start.getTime() + durationMs);
    return {
      rule_id: ruleId,
      producer_id: producerId,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      capacity_per_slot: capacity,
    };
  });

  const { error: upsertError } = await admin
    .from("slots")
    .upsert(rows, { onConflict: "producer_id,starts_at" });
  if (upsertError) throw new Error(`slots upsert : ${upsertError.message}`);

  // Récupère les IDs via lookup par (producer_id, starts_at). On ne se fie
  // pas à l'ordre de retour de l'upsert.
  const { data: slots, error: selectError } = await admin
    .from("slots")
    .select("id, starts_at")
    .eq("producer_id", producerId)
    .in(
      "starts_at",
      rows.map((r) => r.starts_at),
    );
  if (selectError) throw new Error(`slots select : ${selectError.message}`);

  const byStart = new Map<string, string>(
    (slots ?? []).map((s) => [
      new Date(s.starts_at as string).toISOString(),
      s.id as string,
    ]),
  );
  return rows.map((r) => {
    const id = byStart.get(new Date(r.starts_at).toISOString());
    if (!id) throw new Error(`slot matérialisé introuvable : ${r.starts_at}`);
    return id;
  });
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

  const ruleIds = await ensureSlotRules(producerId);
  console.log(`  ✓ ${ruleIds.length} slot_rule(s)`);

  const slotIds = await materializeSeedSlots(producerId, ruleIds[0]);
  console.log(`  ✓ ${slotIds.length} slot(s) matérialisé(s) (passés, pour orders)`);

  const consumerIds: string[] = [];
  for (const c of CONSUMERS) {
    const id = await ensureAuthUser(c.email, "consumer", c.prenom, c.nom, c.telephone);
    consumerIds.push(id);
  }
  console.log(`  ✓ ${consumerIds.length} consommateurs`);

  // 2 commandes terminées pour pouvoir rattacher 2 avis. daysAgo aligné sur
  // SEED_MATERIALIZED_SLOTS pour que slot.starts_at et order.date_retrait
  // restent cohérents.
  const orderId1 = await ensureCompletedOrder(
    consumerIds[0],
    producerId,
    slotIds[0],
    productIds[0], // entrecôte
    0.75,
    PRODUCTS[0].prix,
    SEED_MATERIALIZED_SLOTS[0].daysAgo,
  );
  const orderId2 = await ensureCompletedOrder(
    consumerIds[1],
    producerId,
    slotIds[1],
    productIds[1], // rôti
    1.5,
    PRODUCTS[1].prix,
    SEED_MATERIALIZED_SLOTS[1].daysAgo,
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
