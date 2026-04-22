/**
 * Seed de 5 producteurs fictifs (Sarthe) + 15 produits.
 *
 * Cible : Supabase prod. Cleanable via cleanup-seed.ts (email suffix
 * @seed.terroir-local.fr).
 *
 * Idempotent : détection par email (users) / slug (producers) / (producer, nom)
 * pour les produits. Relancer ne duplique pas.
 *
 * Usage :
 *   npx tsx scripts/seed-producers.ts --dry-run   # n'écrit rien, logue les payloads
 *   npx tsx scripts/seed-producers.ts             # prompt (y/n) puis écrit en base
 *
 * Variables d'env requises (source .env.local) :
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const DRY_RUN = process.argv.includes("--dry-run");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Manque NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY. " +
      "Source .env.local avant de lancer le script.",
  );
  process.exit(1);
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SEED_PASSWORD = "SeedPass2026!";
const EMAIL_SUFFIX = "@seed.terroir-local.fr";

type Unite = "kg" | "piece" | "colis";

type SlotRuleSeed = {
  days_of_week: number[];
  start_time: string; // HH:MM:SS
  end_time: string; // HH:MM:SS
  slot_duration_minutes: number;
  capacity_per_slot: number;
  periodicity_weeks?: number;
};

type ProducerSeed = {
  slug: string;
  email: string;
  prenom: string;
  nom: string;
  telephone: string;
  nom_exploitation: string;
  adresse: string;
  commune: string;
  code_postal: string;
  latitude: number;
  longitude: number;
  siret: string;
  description: string;
  histoire: string;
  annee_creation: number;
  generations: number;
  especes: string[];
  labels: string[];
  coverPhotoId: string;
  produits: Array<{
    nom: string;
    description: string;
    prix: number;
    unite: Unite;
    poids_estime_kg: number | null;
    stock_disponible: number;
    photoId: string;
  }>;
  slotRule: SlotRuleSeed;
};

const PRODUCERS: ProducerSeed[] = [
  {
    slug: "vergers-huisne",
    email: `jb.moreau${EMAIL_SUFFIX}`,
    prenom: "Jean-Baptiste",
    nom: "Moreau",
    telephone: "02 43 00 10 01",
    nom_exploitation: "Les Vergers de l'Huisne",
    adresse: "Route de Parigné, lieu-dit Le Clos des Pommiers",
    commune: "Le Mans",
    code_postal: "72000",
    latitude: 48.0061,
    longitude: 0.1996,
    siret: "39012345600011",
    description:
      "Arboriculture fruitière familiale sur les coteaux de l'Huisne : 18 variétés de pommes et poires anciennes, transformation à la ferme (jus, compotes).",
    histoire:
      "Entreprise Individuelle (EI). Trois générations de Moreau sur ces douze hectares de vergers posés sur les coteaux crayeux de l'Huisne. Mon grand-père y a planté ses premières Reine des Reinettes en 1962 ; mon père a ajouté les Conférence dans les années 80. Je reprends l'exploitation en 2018 avec l'idée d'y ramener des variétés oubliées — la Belle de Boskoop, la Court-pendu gris, la Patte de Loup — et de transformer plus de fruits sur place. Pas d'intrants de synthèse depuis 2015, conversion bio actée en 2020. La cueillette se fait à la main, au bon moment, arbre par arbre. Le jus est pressé dans l'atelier derrière la maison, sans filtrage poussé : c'est trouble, c'est vivant, c'est comme ça qu'on l'aime.",
    annee_creation: 1962,
    generations: 3,
    especes: [],
    labels: ["bio"],
    coverPhotoId: "photo-1537811465496-6c38a51d2d81",
    produits: [
      {
        nom: "Pommes Reine des Reinettes — colis 5 kg",
        description:
          "Variété ancienne, chair ferme et parfumée, excellente en tarte ou au four. Cueillie à la main début octobre.",
        prix: 12.5,
        unite: "colis",
        poids_estime_kg: 5,
        stock_disponible: 30,
        photoId: "photo-1560806887-1e4cd0b6cbd6",
      },
      {
        nom: "Poires Conférence — colis 3 kg",
        description:
          "Fondantes, juteuses, calibrage moyen. À déguster crues ou pochées au vin rouge.",
        prix: 8.5,
        unite: "colis",
        poids_estime_kg: 3,
        stock_disponible: 25,
        photoId: "photo-1615484477778-ca3b77940c25",
      },
      {
        nom: "Jus de pomme artisanal — bouteille 1 L",
        description:
          "Pur jus, non filtré, pasteurisé basse température. Assemblage de nos variétés de saison.",
        prix: 4.5,
        unite: "piece",
        poids_estime_kg: 1,
        stock_disponible: 80,
        photoId: "photo-1567306226416-28f0efdc88ce",
      },
    ],
    slotRule: {
      days_of_week: [3, 6], // mercredi, samedi
      start_time: "09:00:00",
      end_time: "12:00:00",
      slot_duration_minutes: 30,
      capacity_per_slot: 5,
    },
  },
  {
    slug: "perche-sarthois",
    email: `vasseur${EMAIL_SUFFIX}`,
    prenom: "Claire",
    nom: "Vasseur",
    telephone: "02 43 00 10 02",
    nom_exploitation: "Ferme du Perche Sarthois",
    adresse: "La Rouge, route de Bellême",
    commune: "Mamers",
    code_postal: "72600",
    latitude: 48.3511,
    longitude: 0.3661,
    siret: "39012345600028",
    description:
      "Élevage bovin extensif (race Limousine) sur les herbages du Perche Sarthois. Vente directe viande + lait cru.",
    histoire:
      "GAEC réunissant Claire et Thomas Vasseur depuis 2011. Quarante-cinq hectares d'herbages bocagers, soixante mères Limousines et leurs veaux, une petite traite de huit vaches pour le lait cru. Nos bêtes pâturent de mars à novembre, foin l'hiver, zéro ensilage. Les veaux sont sevrés tardivement et engraissés sur place jusqu'à 28-30 mois pour la viande — c'est long, c'est cher, c'est ce qui donne ce persillé. Le lait cru, on le met en bouteille le matin même ; il part chez les clients dans la journée. Label Rouge depuis 2018 sur la viande bovine ; conversion bio en cours sur l'atelier laitier.",
    annee_creation: 1995,
    generations: 2,
    especes: ["bovin"],
    labels: ["label_rouge"],
    coverPhotoId: "photo-1636998980792-63f27ddea4e3",
    produits: [
      {
        nom: "Côte de bœuf Limousine — 1 kg",
        description:
          "Pièce maturée 21 jours sur os, race Limousine élevée à l'herbe. Parfaite au grill.",
        prix: 42,
        unite: "kg",
        poids_estime_kg: 1,
        stock_disponible: 12,
        photoId: "photo-1588168333986-5078d3ae3976",
      },
      {
        nom: "Rôti de bœuf — 1,5 kg",
        description:
          "Rôti de tranche grasse paré et ficelé. Cuisson au four 15 min par livre.",
        prix: 54,
        unite: "colis",
        poids_estime_kg: 1.5,
        stock_disponible: 10,
        photoId: "photo-1608877907149-a206d75ba011",
      },
      {
        nom: "Lait fermier cru — bouteille 1 L",
        description:
          "Mis en bouteille le matin, à consommer dans les 3 jours. À faire bouillir avant consommation pour les plus fragiles.",
        prix: 1.8,
        unite: "piece",
        poids_estime_kg: 1,
        stock_disponible: 40,
        photoId: "photo-1768850418251-17480117ac9b",
      },
    ],
    slotRule: {
      days_of_week: [6], // samedi
      start_time: "10:00:00",
      end_time: "13:00:00",
      slot_duration_minutes: 30,
      capacity_per_slot: 10,
    },
  },
  {
    slug: "alpes-mancelles",
    email: `a.fouquet${EMAIL_SUFFIX}`,
    prenom: "Amélie",
    nom: "Fouquet",
    telephone: "02 43 00 10 03",
    nom_exploitation: "Maraîchage des Alpes Mancelles",
    adresse: "Les Gués, chemin du Moulin",
    commune: "Saint-Léonard-des-Bois",
    code_postal: "72130",
    latitude: 48.3706,
    longitude: -0.0656,
    siret: "39012345600035",
    description:
      "Maraîchage diversifié sur 1,8 hectare en bio, plus de 50 légumes cultivés sur l'année. Panier hebdo, variétés anciennes.",
    histoire:
      "Entreprise Individuelle (EI). Installation en 2019, après huit ans de recherche en agronomie à Angers. J'ai choisi ce vallon des Alpes Mancelles pour la qualité de la terre (limon sableux sur sable grésifère) et l'eau de source qui traverse la parcelle. Culture sur sol vivant, pas de labour depuis la deuxième année, couverts végétaux systématiques entre deux cultures. Je fais mes plants moi-même dans une petite serre bioclimatique. Les variétés anciennes, c'est un parti pris : la Noire de Crimée, la Green Zebra, le Miel du Mexique, la carotte Jaune du Doubs. Moins de rendement, plus de goût. Certifiée bio depuis 2021.",
    annee_creation: 2019,
    generations: 1,
    especes: [],
    labels: ["bio"],
    coverPhotoId: "photo-1515150144380-bca9f1650ed9",
    produits: [
      {
        nom: "Panier légumes de saison — 5 kg",
        description:
          "Composition au choix du maraîchage selon la cueillette. 6 à 8 légumes, variétés de saison.",
        prix: 18,
        unite: "colis",
        poids_estime_kg: 5,
        stock_disponible: 20,
        photoId: "photo-1594144972490-a4177d70593a",
      },
      {
        nom: "Tomates anciennes — colis 2 kg",
        description:
          "Assortiment de 4 variétés anciennes : Noire de Crimée, Green Zebra, Cœur de Bœuf, Ananas.",
        prix: 8,
        unite: "colis",
        poids_estime_kg: 2,
        stock_disponible: 18,
        photoId: "photo-1567375698463-b8dabb1319cf",
      },
      {
        nom: "Salade mesclun — sachet 300 g",
        description:
          "Jeunes pousses mélangées : roquette, mizuna, moutarde, épinard, chêne rouge. Lavées.",
        prix: 4.5,
        unite: "piece",
        poids_estime_kg: 0.3,
        stock_disponible: 50,
        photoId: "photo-1607532941433-304659e8198a",
      },
    ],
    slotRule: {
      days_of_week: [1, 3, 5], // lundi, mercredi, vendredi
      start_time: "16:00:00",
      end_time: "19:00:00",
      slot_duration_minutes: 30,
      capacity_per_slot: 8,
    },
  },
  {
    slug: "ruchers-sarthe",
    email: `p.delaunay${EMAIL_SUFFIX}`,
    prenom: "Pierre",
    nom: "Delaunay",
    telephone: "02 43 00 10 04",
    nom_exploitation: "Ruchers de la Sarthe",
    adresse: "La Bergerie, route du Lude",
    commune: "La Flèche",
    code_postal: "72200",
    latitude: 47.6989,
    longitude: -0.0747,
    siret: "39012345600042",
    description:
      "Apiculture sédentaire et transhumante sur 220 ruches. Miels de cru (fleurs, acacia, châtaignier, tilleul) et pain d'épices maison.",
    histoire:
      "Entreprise Individuelle (EI). Apiculteur depuis 2008 — second métier après une quinzaine d'années comme menuisier. J'ai commencé avec 10 ruches et un essaim offert par un voisin ; je conduis aujourd'hui 220 colonies réparties sur la vallée du Loir et les coteaux de Jupilles. Transhumance légère sur l'acacia et le châtaignier, le reste du temps les ruches sont au rucher-maison. Pas de traitement chimique contre le varroa : acide oxalique biologique en hiver, sélection d'abeilles résistantes. Récolte à la main, extraction à froid, décantation 48h avant mise en pot. Le pain d'épices, c'est la recette de ma grand-mère — miel de châtaignier, farine de seigle, épices torréfiées sur place.",
    annee_creation: 2008,
    generations: 1,
    especes: [],
    labels: [],
    coverPhotoId: "photo-1647427062468-74ff21e8934f",
    produits: [
      {
        nom: "Miel de fleurs — pot 500 g",
        description:
          "Miel polyfloral de printemps, cristallisation fine naturelle, goût doux et floral.",
        prix: 9.5,
        unite: "piece",
        poids_estime_kg: 0.5,
        stock_disponible: 60,
        photoId: "photo-1679941279735-b3b35e8bc476",
      },
      {
        nom: "Miel de châtaignier — pot 500 g",
        description:
          "Miel ambré, corsé, légèrement amer. Idéal sur un fromage de chèvre ou en sauce.",
        prix: 11,
        unite: "piece",
        poids_estime_kg: 0.5,
        stock_disponible: 45,
        photoId: "photo-1587049352851-8d4e89133924",
      },
      {
        nom: "Pain d'épices artisanal — 400 g",
        description:
          "Recette familiale : miel de châtaignier maison, farine de seigle, cannelle, anis, girofle.",
        prix: 8.5,
        unite: "piece",
        poids_estime_kg: 0.4,
        stock_disponible: 25,
        photoId: "photo-1608563794211-e06ae1e58c1b",
      },
    ],
    slotRule: {
      days_of_week: [2, 5], // mardi, vendredi
      start_time: "14:00:00",
      end_time: "17:00:00",
      slot_duration_minutes: 60,
      capacity_per_slot: 3,
    },
  },
  {
    slug: "clos-cenomane",
    email: `carrel${EMAIL_SUFFIX}`,
    prenom: "Julien",
    nom: "Carrel",
    telephone: "02 43 00 10 05",
    nom_exploitation: "GAEC du Clos Cenomane",
    adresse: "La Fournière, route d'Yvré-l'Évêque",
    commune: "Écommoy",
    code_postal: "72220",
    latitude: 47.8297,
    longitude: 0.2750,
    siret: "39012345600059",
    description:
      "Boulangerie paysanne sur la ferme : blés anciens cultivés sur 12 ha, meunerie sur meule de pierre, fournil au levain naturel, cuisson au feu de bois.",
    histoire:
      "GAEC réunissant Julien et Sophie Carrel depuis 2016. Paysans-boulangers : on cultive nos blés (Rouge de Bordeaux, Barbu du Mans, Poulard d'Auvergne), on les moud sur place à la meule de pierre, on les panifie au levain naturel et on cuit au feu de bois dans un four à sole maçonné par Julien en 2017. Le pain repose 24h au levain, c'est long, c'est digeste, ça se garde une semaine. Farine T80 vendue brute pour ceux qui boulangent à la maison. La brioche, c'est Sophie qui la fait le vendredi matin — beurre de la ferme voisine, œufs de nos poules, zeste d'orange confite. Conversion bio acquise en 2019.",
    annee_creation: 2016,
    generations: 1,
    especes: [],
    labels: ["bio"],
    coverPhotoId: "photo-1711672284661-bd70e38f31b2",
    produits: [
      {
        nom: "Pain de campagne au levain — 800 g",
        description:
          "Blé ancien, levain naturel, fermentation 24 h, cuit au feu de bois. Se conserve 5 à 7 jours.",
        prix: 5.5,
        unite: "piece",
        poids_estime_kg: 0.8,
        stock_disponible: 35,
        photoId: "photo-1549413468-cd78edb7e75c",
      },
      {
        nom: "Farine T80 bio — sac 1 kg",
        description:
          "Moulue sur meule de pierre, blé Rouge de Bordeaux. Idéale pour pain maison et pâte à tarte.",
        prix: 4,
        unite: "piece",
        poids_estime_kg: 1,
        stock_disponible: 50,
        photoId: "photo-1610725664285-7c57e6eeac3f",
      },
      {
        nom: "Brioche au beurre — 400 g",
        description:
          "Recette familiale, beurre fermier, œufs plein air, zeste d'orange confite. Cuite le vendredi matin.",
        prix: 7,
        unite: "piece",
        poids_estime_kg: 0.4,
        stock_disponible: 20,
        photoId: "photo-1532250327408-9bd6e0ce2c49",
      },
    ],
    slotRule: {
      days_of_week: [3, 6], // mercredi, samedi
      start_time: "15:00:00",
      end_time: "18:00:00",
      slot_duration_minutes: 45,
      capacity_per_slot: 6,
    },
  },
];

// Photos thématiques via images.unsplash.com — photoId curé à la main
// pour chaque producteur/produit (voir scripts/seed-producers-photos.md
// si ajout futur). Format photoId : "photo-{timestamp}-{hash}". Loremflickr
// a été abandonné (pool de tags Flickr trop bruité), source.unsplash.com
// est mort depuis 2023.
function coverUrl(photoId: string): string {
  return `https://images.unsplash.com/${photoId}?w=1200&h=600&fit=crop&q=80`;
}

function productPhotoUrl(photoId: string): string {
  return `https://images.unsplash.com/${photoId}?w=800&h=600&fit=crop&q=80`;
}

function productSlug(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function log(label: string, payload: unknown): void {
  console.log(`\n[${label}]`);
  console.log(JSON.stringify(payload, null, 2));
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const { data } = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  // listUsers est paginé, mais 5 seeds c'est ok si on est sur la 1ère page.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw new Error(`listUsers: ${error.message}`);
  const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  return found?.id ?? null;
}

async function ensureAuthAndUser(p: ProducerSeed): Promise<string> {
  // 1. cherche via public.users (si déjà seedé)
  const existingPublic = await findUserIdByEmail(p.email);
  if (existingPublic) {
    log(`users UPDATE ${p.email}`, {
      id: existingPublic,
      roles: ["consumer", "producer"],
      prenom: p.prenom,
      nom: p.nom,
      telephone: p.telephone,
    });
    if (!DRY_RUN) {
      const { error } = await admin
        .from("users")
        .update({
          roles: ["consumer", "producer"],
          prenom: p.prenom,
          nom: p.nom,
          telephone: p.telephone,
        })
        .eq("id", existingPublic);
      if (error) throw new Error(`users update ${p.email}: ${error.message}`);
    }
    return existingPublic;
  }

  // 2. cherche dans auth (cas où seed partiel : auth créé, public.users échoué)
  const existingAuthId = await findAuthUserIdByEmail(p.email);
  let userId = existingAuthId;

  if (!userId) {
    log(`auth.createUser ${p.email}`, {
      email: p.email,
      email_confirm: true,
      password: "***",
    });
    if (DRY_RUN) {
      // id fictif pour la suite du dry-run
      userId = `00000000-dry-${p.slug.slice(0, 8).padEnd(8, "x")}-run0-000000000000`.slice(0, 36);
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: p.email,
        password: SEED_PASSWORD,
        email_confirm: true,
        user_metadata: { prenom: p.prenom, nom: p.nom, seed: true },
      });
      if (error || !data.user) {
        throw new Error(`createUser ${p.email}: ${error?.message ?? "no user"}`);
      }
      userId = data.user.id;
    }
  }

  // 3. insert public.users
  log(`users INSERT ${p.email}`, {
    id: userId,
    email: p.email,
    roles: ["consumer", "producer"],
    prenom: p.prenom,
    nom: p.nom,
    telephone: p.telephone,
    sms_optin: false,
  });
  if (!DRY_RUN) {
    const { error } = await admin.from("users").upsert(
      {
        id: userId,
        email: p.email,
        roles: ["consumer", "producer"],
        prenom: p.prenom,
        nom: p.nom,
        telephone: p.telephone,
        sms_optin: false,
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(`users upsert ${p.email}: ${error.message}`);
  }

  return userId!;
}

async function ensureProducer(p: ProducerSeed, userId: string): Promise<string> {
  const cover = coverUrl(p.coverPhotoId);
  const base = {
    user_id: userId,
    slug: p.slug,
    nom_exploitation: p.nom_exploitation,
    siret: p.siret,
    adresse: p.adresse,
    commune: p.commune,
    code_postal: p.code_postal,
    latitude: p.latitude,
    longitude: p.longitude,
    description: p.description,
    histoire: p.histoire,
    photo_principale: cover,
    photos: [cover],
    annee_creation: p.annee_creation,
    generations: p.generations,
    especes: p.especes,
    labels: p.labels,
    statut: "public" as const,
  };

  const { data: existing } = await admin
    .from("producers")
    .select("id")
    .eq("slug", p.slug)
    .maybeSingle();

  if (existing) {
    log(`producers UPDATE ${p.slug}`, { id: existing.id, ...base });
    if (!DRY_RUN) {
      const { error } = await admin.from("producers").update(base).eq("id", existing.id);
      if (error) throw new Error(`producer update ${p.slug}: ${error.message}`);
    }
    return existing.id as string;
  }

  log(`producers INSERT ${p.slug}`, base);
  if (DRY_RUN) {
    return `00000000-dry-prod-${p.slug.slice(0, 12).padEnd(12, "x")}`.slice(0, 36);
  }
  const { data, error } = await admin.from("producers").insert(base).select("id").single();
  if (error || !data) throw new Error(`producer insert ${p.slug}: ${error?.message}`);
  return data.id as string;
}

async function ensureProducts(p: ProducerSeed, producerId: string): Promise<number> {
  let count = 0;
  for (const prod of p.produits) {
    const pslug = productSlug(prod.nom);
    const payload = {
      producer_id: producerId,
      nom: prod.nom,
      description: prod.description,
      photos: [productPhotoUrl(prod.photoId)],
      prix: prod.prix,
      unite: prod.unite,
      poids_estime_kg: prod.poids_estime_kg,
      stock_disponible: prod.stock_disponible,
      stock_illimite: false,
      delai_preparation_jours: 1,
      active: true,
    };

    // idempotence : (producer_id, nom)
    const { data: existing } = DRY_RUN
      ? { data: null as { id: string } | null }
      : await admin
          .from("products")
          .select("id")
          .eq("producer_id", producerId)
          .eq("nom", prod.nom)
          .maybeSingle();

    if (existing) {
      log(`products UPDATE ${pslug}`, { id: existing.id, ...payload });
      if (!DRY_RUN) {
        const { error } = await admin.from("products").update(payload).eq("id", existing.id);
        if (error) throw new Error(`product update ${prod.nom}: ${error.message}`);
      }
    } else {
      log(`products INSERT ${pslug}`, payload);
      if (!DRY_RUN) {
        const { error } = await admin.from("products").insert(payload);
        if (error) throw new Error(`product insert ${prod.nom}: ${error.message}`);
      }
    }
    count++;
  }
  return count;
}

// Idempotent : match sur (producer_id, start_time) — une seule rule par
// producer et par start_time dans le seed. Si trouvée, UPDATE ; sinon INSERT.
// Le générateur matérialisera les slots au prochain hit de la page produit.
async function ensureSlotRule(
  p: ProducerSeed,
  producerId: string,
): Promise<"inserted" | "updated" | "dry"> {
  const rule = p.slotRule;
  const payload = {
    producer_id: producerId,
    days_of_week: rule.days_of_week,
    periodicity_weeks: rule.periodicity_weeks ?? 1,
    start_time: rule.start_time,
    end_time: rule.end_time,
    slot_duration_minutes: rule.slot_duration_minutes,
    capacity_per_slot: rule.capacity_per_slot,
    active: true,
  };

  if (DRY_RUN) {
    log(`slot_rules INSERT ${p.slug}`, payload);
    return "dry";
  }

  const { data: existing, error: selError } = await admin
    .from("slot_rules")
    .select("id")
    .eq("producer_id", producerId)
    .eq("start_time", rule.start_time)
    .maybeSingle();
  if (selError) throw new Error(`slot_rules select ${p.slug}: ${selError.message}`);

  if (existing) {
    log(`slot_rules UPDATE ${p.slug}`, { id: existing.id, ...payload });
    const { error } = await admin
      .from("slot_rules")
      .update(payload)
      .eq("id", existing.id);
    if (error) throw new Error(`slot_rules update ${p.slug}: ${error.message}`);
    return "updated";
  }

  log(`slot_rules INSERT ${p.slug}`, payload);
  const { error } = await admin.from("slot_rules").insert(payload);
  if (error) throw new Error(`slot_rules insert ${p.slug}: ${error.message}`);
  return "inserted";
}

async function confirm(): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(
    `\n⚠️  Connexion à ${SUPABASE_URL}\n   5 producteurs + 15 produits + 5 slot_rules vont être insérés/mis à jour.\n   Continuer ? (y/N) `,
  );
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

async function main(): Promise<void> {
  console.log("=".repeat(70));
  console.log(`Supabase : ${SUPABASE_URL}`);
  console.log(`Mode     : ${DRY_RUN ? "DRY-RUN (aucune écriture)" : "ÉCRITURE RÉELLE"}`);
  console.log(`Producteurs : ${PRODUCERS.length} · Produits : ${PRODUCERS.reduce((s, p) => s + p.produits.length, 0)}`);
  console.log("=".repeat(70));

  if (!DRY_RUN) {
    const ok = await confirm();
    if (!ok) {
      console.log("Annulé.");
      process.exit(0);
    }
  }

  let producersCount = 0;
  let productsCount = 0;
  let slotRulesCount = 0;

  for (const p of PRODUCERS) {
    console.log(`\n─── ${p.nom_exploitation} (${p.slug}) ───`);
    const userId = await ensureAuthAndUser(p);
    const producerId = await ensureProducer(p, userId);
    const n = await ensureProducts(p, producerId);
    await ensureSlotRule(p, producerId);
    producersCount++;
    productsCount += n;
    slotRulesCount++;
  }

  console.log("\n" + "=".repeat(70));
  console.log(
    `✓ Terminé : ${producersCount} producteurs · ${productsCount} produits · ${slotRulesCount} slot_rules`,
  );
  if (DRY_RUN) console.log("  (dry-run, rien n'a été écrit)");
  console.log("=".repeat(70));
}

main().catch((err) => {
  console.error("\n✗ Erreur :", err);
  process.exit(1);
});
