/**
 * Seed des 10 références gms_prices initiales — Phase A page /notre-demarche.
 *
 * Cible : Supabase prod. Idempotent par slug (SELECT puis UPDATE/INSERT).
 *
 * Prix initiaux : placeholder Kantar Worldpanel / FranceAgriMer à calibrer
 * sur sources réelles plus tard (panel boucherie GMS moyenne nationale
 * 2026-04). Romain valide les chiffres avant publication Phase C.
 *
 * Usage :
 *   npx tsx scripts/seed-gms-prices.ts --dry-run   # n'écrit rien
 *   npx tsx scripts/seed-gms-prices.ts             # prompt (y/n) puis écrit
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

type Filiere = "bovin" | "porcin" | "ovin";

type GmsPriceSeed = {
  slug: string;
  filiere: Filiere;
  libelle: string;
  description_courte: string;
  prix_gms_kg: number;
  prix_terroir_kg_min: number;
  prix_terroir_kg_max: number;
  prix_terroir_kg_moyen: number;
  ordre_affichage: number;
};

const MOIS_REFERENCE = "2026-04";
const SOURCE =
  "FranceAgriMer / OFPM (Kantar Worldpanel) — placeholder à calibrer";
const DESCRIPTION_COURTE =
  "Boucherie GMS, panel Kantar Worldpanel — moyenne nationale";

const REFERENCES: GmsPriceSeed[] = [
  {
    slug: "boeuf-steak-hache-15",
    filiere: "bovin",
    libelle: "Steak haché frais 15% MG",
    description_courte: DESCRIPTION_COURTE,
    prix_gms_kg: 13.5,
    prix_terroir_kg_min: 18.0,
    prix_terroir_kg_max: 24.0,
    prix_terroir_kg_moyen: 21.0,
    ordre_affichage: 1,
  },
  {
    slug: "boeuf-entrecote",
    filiere: "bovin",
    libelle: "Entrecôte",
    description_courte: DESCRIPTION_COURTE,
    prix_gms_kg: 28.5,
    prix_terroir_kg_min: 36.0,
    prix_terroir_kg_max: 48.0,
    prix_terroir_kg_moyen: 42.0,
    ordre_affichage: 2,
  },
  {
    slug: "boeuf-bourguignon",
    filiere: "bovin",
    libelle: "Bourguignon (pavé à mijoter)",
    description_courte: DESCRIPTION_COURTE,
    prix_gms_kg: 14.0,
    prix_terroir_kg_min: 18.0,
    prix_terroir_kg_max: 24.0,
    prix_terroir_kg_moyen: 21.0,
    ordre_affichage: 3,
  },
  {
    slug: "boeuf-rumsteck",
    filiere: "bovin",
    libelle: "Rumsteck",
    description_courte: DESCRIPTION_COURTE,
    prix_gms_kg: 24.0,
    prix_terroir_kg_min: 32.0,
    prix_terroir_kg_max: 42.0,
    prix_terroir_kg_moyen: 37.0,
    ordre_affichage: 4,
  },
  {
    slug: "porc-cote",
    filiere: "porcin",
    libelle: "Côte de porc",
    description_courte: DESCRIPTION_COURTE,
    prix_gms_kg: 8.5,
    prix_terroir_kg_min: 12.0,
    prix_terroir_kg_max: 16.0,
    prix_terroir_kg_moyen: 14.0,
    ordre_affichage: 5,
  },
  {
    slug: "porc-roti-filet",
    filiere: "porcin",
    libelle: "Rôti de porc dans le filet",
    description_courte: DESCRIPTION_COURTE,
    prix_gms_kg: 9.5,
    prix_terroir_kg_min: 13.0,
    prix_terroir_kg_max: 17.0,
    prix_terroir_kg_moyen: 15.0,
    ordre_affichage: 6,
  },
  {
    slug: "porc-travers",
    filiere: "porcin",
    libelle: "Travers de porc",
    description_courte: DESCRIPTION_COURTE,
    prix_gms_kg: 7.0,
    prix_terroir_kg_min: 9.5,
    prix_terroir_kg_max: 13.5,
    prix_terroir_kg_moyen: 11.5,
    ordre_affichage: 7,
  },
  {
    slug: "agneau-cotelettes",
    filiere: "ovin",
    libelle: "Côtelettes d'agneau",
    description_courte: DESCRIPTION_COURTE,
    prix_gms_kg: 26.0,
    prix_terroir_kg_min: 32.0,
    prix_terroir_kg_max: 42.0,
    prix_terroir_kg_moyen: 37.0,
    ordre_affichage: 8,
  },
  {
    slug: "agneau-gigot",
    filiere: "ovin",
    libelle: "Gigot d'agneau",
    description_courte: DESCRIPTION_COURTE,
    prix_gms_kg: 22.0,
    prix_terroir_kg_min: 28.0,
    prix_terroir_kg_max: 38.0,
    prix_terroir_kg_moyen: 33.0,
    ordre_affichage: 9,
  },
  {
    slug: "agneau-epaule",
    filiere: "ovin",
    libelle: "Épaule d'agneau",
    description_courte: DESCRIPTION_COURTE,
    prix_gms_kg: 17.0,
    prix_terroir_kg_min: 22.0,
    prix_terroir_kg_max: 30.0,
    prix_terroir_kg_moyen: 26.0,
    ordre_affichage: 10,
  },
];

function log(label: string, payload: unknown): void {
  console.log(`\n[${label}]`);
  console.log(JSON.stringify(payload, null, 2));
}

async function ensureGmsPrice(
  ref: GmsPriceSeed,
): Promise<"inserted" | "updated" | "dry"> {
  const payload = {
    slug: ref.slug,
    filiere: ref.filiere,
    libelle: ref.libelle,
    description_courte: ref.description_courte,
    prix_gms_kg: ref.prix_gms_kg,
    prix_terroir_kg_min: ref.prix_terroir_kg_min,
    prix_terroir_kg_max: ref.prix_terroir_kg_max,
    prix_terroir_kg_moyen: ref.prix_terroir_kg_moyen,
    mois_reference: MOIS_REFERENCE,
    source: SOURCE,
    source_url: null,
    ordre_affichage: ref.ordre_affichage,
    active: true,
  };

  if (DRY_RUN) {
    log(`gms_prices INSERT ${ref.slug}`, payload);
    return "dry";
  }

  const { data: existing, error: selError } = await admin
    .from("gms_prices")
    .select("id")
    .eq("slug", ref.slug)
    .maybeSingle();
  if (selError)
    throw new Error(`gms_prices select ${ref.slug}: ${selError.message}`);

  if (existing) {
    log(`gms_prices UPDATE ${ref.slug}`, { id: existing.id, ...payload });
    const { error } = await admin
      .from("gms_prices")
      .update(payload)
      .eq("id", existing.id);
    if (error)
      throw new Error(`gms_prices update ${ref.slug}: ${error.message}`);
    return "updated";
  }

  log(`gms_prices INSERT ${ref.slug}`, payload);
  const { error } = await admin.from("gms_prices").insert(payload);
  if (error) throw new Error(`gms_prices insert ${ref.slug}: ${error.message}`);
  return "inserted";
}

async function confirm(): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(
    `\n⚠️  Connexion à ${SUPABASE_URL}\n   ${REFERENCES.length} références gms_prices vont être insérées/mises à jour.\n   Continuer ? (y/N) `,
  );
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

async function main(): Promise<void> {
  console.log("=".repeat(70));
  console.log(`Supabase : ${SUPABASE_URL}`);
  console.log(
    `Mode     : ${DRY_RUN ? "DRY-RUN (aucune écriture)" : "ÉCRITURE RÉELLE"}`,
  );
  console.log(`Références : ${REFERENCES.length} (mois ${MOIS_REFERENCE})`);
  console.log("=".repeat(70));

  if (!DRY_RUN) {
    const ok = await confirm();
    if (!ok) {
      console.log("Annulé.");
      process.exit(0);
    }
  }

  let inserted = 0;
  let updated = 0;
  let dry = 0;

  for (const ref of REFERENCES) {
    console.log(`\n─── ${ref.slug} (${ref.filiere}) ───`);
    const result = await ensureGmsPrice(ref);
    if (result === "inserted") inserted++;
    else if (result === "updated") updated++;
    else dry++;
  }

  console.log("\n" + "=".repeat(70));
  console.log(
    `✓ Terminé : ${inserted} inséré(s) · ${updated} mis à jour · ${dry} dry`,
  );
  if (DRY_RUN) console.log("  (dry-run, rien n'a été écrit)");
  console.log("=".repeat(70));
}

main().catch((err) => {
  console.error("\n✗ Erreur :", err);
  process.exit(1);
});
