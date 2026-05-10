import "server-only";
import JSZip from "jszip";
import { serializeRowsToCsv } from "@/lib/exports/csv";
import type { SupabaseClient } from "@supabase/supabase-js";

// =============================================================================
// Export portabilité user-side (RGPD art. 20) — F-011 audit pré-launch 2026-05.
// =============================================================================
// Construit un zip téléchargeable contenant les données personnelles d'un user
// donné, dans une structure machine-readable (JSON source de vérité) + CSVs
// par catégorie pour les non-techniques (ouvrent dans Excel/Sheets).
//
// Périmètre (validé Romain) :
//   - Profil (users sauf colonnes admin/roles : pas roles, pas
//     stripe_customer_id — internes).
//   - Commandes + items (orders + order_items, montants, statuts, dates,
//     code retrait, producer nom_exploitation/commune).
//   - Reviews postés (note, contenu, date, order code référencé).
//   - Notifications (last 90 jours, type + template + date, métadonnées
//     opaques exclues — peuvent contenir tokens / payloads internes).
//   - Producer interests (1 ligne par lead enregistré sur l'email du user).
//
// Non inclus volontairement :
//   - audit_logs : trace forensique sécurité, art. 17 (droit à l'oubli) ne
//     s'applique pas, art. 20 (portabilité) limité aux données fournies par
//     l'user — les logs auth sont générés par TerrOir.
//   - email_change_otp_codes : données techniques internes, secrets hashés.
//   - stripe_customer_id : identifiant interne Stripe, pas une donnée user.
//   - roles : géré par TerrOir (admin/producer/consumer), pas une donnée user.
//
// Le helper est PUR (prend le client Supabase admin en argument) pour rester
// testable sans next/headers + sans server-only mock complexe. La server action
// `exportMyDataAction` ajoute auth + rate-limit + audit log autour.
// =============================================================================

export type ExportedProfile = {
  email: string | null;
  prenom: string | null;
  nom: string | null;
  telephone: string | null;
  sms_optin: boolean | null;
  cgu_version: string | null;
  cgu_accepted_at: string | null;
  created_at: string | null;
};

export type ExportedOrder = {
  id: string;
  code_commande: string | null;
  statut: string | null;
  date_retrait: string | null;
  heure_retrait: string | null;
  montant_total: number | null;
  commission_terroir: number | null;
  notes_client: string | null;
  created_at: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  producer_nom_exploitation: string | null;
  producer_commune: string | null;
};

export type ExportedOrderItem = {
  order_code: string | null;
  product_nom: string | null;
  quantite: number;
  prix_unitaire: number;
  sous_total: number;
};

export type ExportedReview = {
  id: string;
  note: number | null;
  commentaire: string | null;
  statut: string | null;
  created_at: string | null;
  published_at: string | null;
  order_code: string | null;
  producer_nom_exploitation: string | null;
};

export type ExportedNotification = {
  id: string;
  type: string | null;
  template: string;
  statut: string | null;
  created_at: string | null;
};

export type ExportedProducerInterest = {
  id: string;
  source: string;
  statut: string | null;
  prenom: string | null;
  nom: string;
  nom_exploitation: string | null;
  commune: string | null;
  telephone: string | null;
  message: string | null;
  created_at: string | null;
};

export type ExportPayload = {
  meta: {
    user_id: string;
    generated_at: string;
    notifications_window_days: 90;
    format_version: "1.0";
  };
  profil: ExportedProfile | null;
  commandes: ExportedOrder[];
  articles_commandes: ExportedOrderItem[];
  avis: ExportedReview[];
  notifications: ExportedNotification[];
  interets_producteurs: ExportedProducerInterest[];
};

const NOTIFICATIONS_WINDOW_DAYS = 90;

function isoMinusDays(days: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export async function buildExportPayload(
  admin: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<ExportPayload> {
  const since = isoMinusDays(NOTIFICATIONS_WINDOW_DAYS, now);

  const [profileRes, ordersRes, reviewsRes, notificationsRes] =
    await Promise.all([
      admin
        .from("users")
        .select(
          "email, prenom, nom, telephone, sms_optin, cgu_version, cgu_accepted_at, created_at",
        )
        .eq("id", userId)
        .maybeSingle(),
      admin
        .from("orders")
        .select(
          `id, code_commande, statut, date_retrait, heure_retrait,
           montant_total, commission_terroir, notes_client, created_at,
           confirmed_at, completed_at, cancelled_at,
           order_items(order_id, quantite, prix_unitaire, sous_total,
             products(nom)),
           producers(nom_exploitation, commune)`,
        )
        .eq("consumer_id", userId)
        .order("created_at", { ascending: false }),
      admin
        .from("reviews")
        .select(
          `id, note, commentaire, statut, created_at, published_at,
           orders(code_commande),
           producers(nom_exploitation)`,
        )
        .eq("consumer_id", userId)
        .order("created_at", { ascending: false }),
      admin
        .from("notifications")
        .select("id, type, template, statut, created_at")
        .eq("user_id", userId)
        .gte("created_at", since)
        .order("created_at", { ascending: false }),
    ]);

  // Producer interests : keying par email (un user peut être lead avant
  // signup, donc avant d'avoir un user_id côté DB). On lookup l'email courant
  // depuis le profil et on cherche les interests qui matchent (case-
  // insensitive aligné avec la doctrine `escapeIlikeEmail` du projet).
  let producerInterests: ExportedProducerInterest[] = [];
  const profileEmail = profileRes.data?.email ?? null;
  if (profileEmail) {
    const interestRes = await admin
      .from("producer_interests")
      .select(
        "id, source, statut, prenom, nom, nom_exploitation, commune, telephone, message, created_at",
      )
      .ilike("email", profileEmail)
      .order("created_at", { ascending: false });
    producerInterests = (interestRes.data ?? []) as ExportedProducerInterest[];
  }

  type OrderJoin = {
    id: string;
    code_commande: string | null;
    statut: string | null;
    date_retrait: string | null;
    heure_retrait: string | null;
    montant_total: number | null;
    commission_terroir: number | null;
    notes_client: string | null;
    created_at: string | null;
    confirmed_at: string | null;
    completed_at: string | null;
    cancelled_at: string | null;
    order_items:
      | Array<{
          order_id: string | null;
          quantite: number;
          prix_unitaire: number;
          sous_total: number;
          products: { nom: string | null } | null;
        }>
      | null;
    producers: { nom_exploitation: string | null; commune: string | null } | null;
  };

  // Cast via unknown : Supabase 2 type les relations many-to-one comme arrays
  // dans le retour inféré, mais le runtime retourne des objets singles (FK
  // côté orders → producer / FK côté order_items → product). On garde notre
  // forme typée propre et on assume au runtime — pattern aligné avec le
  // reste du codebase (cf. lib/products/fetch-products-public.ts).
  const ordersJoined = (ordersRes.data ?? []) as unknown as OrderJoin[];
  const commandes: ExportedOrder[] = ordersJoined.map((o) => ({
    id: o.id,
    code_commande: o.code_commande,
    statut: o.statut,
    date_retrait: o.date_retrait,
    heure_retrait: o.heure_retrait,
    montant_total: o.montant_total,
    commission_terroir: o.commission_terroir,
    notes_client: o.notes_client,
    created_at: o.created_at,
    confirmed_at: o.confirmed_at,
    completed_at: o.completed_at,
    cancelled_at: o.cancelled_at,
    producer_nom_exploitation: o.producers?.nom_exploitation ?? null,
    producer_commune: o.producers?.commune ?? null,
  }));

  const articles_commandes: ExportedOrderItem[] = ordersJoined.flatMap((o) =>
    (o.order_items ?? []).map((item) => ({
      order_code: o.code_commande,
      product_nom: item.products?.nom ?? null,
      quantite: item.quantite,
      prix_unitaire: item.prix_unitaire,
      sous_total: item.sous_total,
    })),
  );

  type ReviewJoin = {
    id: string;
    note: number | null;
    commentaire: string | null;
    statut: string | null;
    created_at: string | null;
    published_at: string | null;
    orders: { code_commande: string | null } | null;
    producers: { nom_exploitation: string | null } | null;
  };

  const reviewsJoined = (reviewsRes.data ?? []) as unknown as ReviewJoin[];
  const avis: ExportedReview[] = reviewsJoined.map((r) => ({
    id: r.id,
    note: r.note,
    commentaire: r.commentaire,
    statut: r.statut,
    created_at: r.created_at,
    published_at: r.published_at,
    order_code: r.orders?.code_commande ?? null,
    producer_nom_exploitation: r.producers?.nom_exploitation ?? null,
  }));

  const notifications: ExportedNotification[] = (notificationsRes.data ??
    []) as ExportedNotification[];

  return {
    meta: {
      user_id: userId,
      generated_at: now.toISOString(),
      notifications_window_days: NOTIFICATIONS_WINDOW_DAYS,
      format_version: "1.0",
    },
    profil: (profileRes.data ?? null) as ExportedProfile | null,
    commandes,
    articles_commandes,
    avis,
    notifications,
    interets_producteurs: producerInterests,
  };
}

// =============================================================================
// Build zip — pure (prend un payload et retourne un Buffer). Testable sans DB.
// =============================================================================

export async function buildExportZip(
  payload: ExportPayload,
): Promise<Uint8Array> {
  const zip = new JSZip();

  zip.file("README.txt", buildReadme(payload));
  zip.file("export.json", JSON.stringify(payload, null, 2));
  zip.file(
    "profil.csv",
    serializeRowsToCsv(payload.profil ? [payload.profil] : [], [
      { key: "email", header: "Email" },
      { key: "prenom", header: "Prénom" },
      { key: "nom", header: "Nom" },
      { key: "telephone", header: "Téléphone" },
      { key: "sms_optin", header: "SMS opt-in" },
      { key: "cgu_version", header: "Version CGU acceptée" },
      { key: "cgu_accepted_at", header: "Date acceptation CGU" },
      { key: "created_at", header: "Date création compte" },
    ]),
  );
  zip.file(
    "commandes.csv",
    serializeRowsToCsv(payload.commandes, [
      { key: "code_commande", header: "Code commande" },
      { key: "statut", header: "Statut" },
      { key: "date_retrait", header: "Date retrait" },
      { key: "heure_retrait", header: "Heure retrait" },
      { key: "montant_total", header: "Montant total (€)" },
      { key: "commission_terroir", header: "Commission TerrOir (€)" },
      { key: "notes_client", header: "Notes client" },
      { key: "producer_nom_exploitation", header: "Producteur" },
      { key: "producer_commune", header: "Commune producteur" },
      { key: "created_at", header: "Créée le" },
      { key: "confirmed_at", header: "Confirmée le" },
      { key: "completed_at", header: "Retirée le" },
      { key: "cancelled_at", header: "Annulée le" },
    ]),
  );
  zip.file(
    "articles_commandes.csv",
    serializeRowsToCsv(payload.articles_commandes, [
      { key: "order_code", header: "Code commande" },
      { key: "product_nom", header: "Produit" },
      { key: "quantite", header: "Quantité" },
      { key: "prix_unitaire", header: "Prix unitaire (€)" },
      { key: "sous_total", header: "Sous-total (€)" },
    ]),
  );
  zip.file(
    "avis.csv",
    serializeRowsToCsv(payload.avis, [
      { key: "note", header: "Note (sur 5)" },
      { key: "commentaire", header: "Commentaire" },
      { key: "statut", header: "Statut" },
      { key: "order_code", header: "Code commande" },
      { key: "producer_nom_exploitation", header: "Producteur" },
      { key: "created_at", header: "Posté le" },
      { key: "published_at", header: "Publié le" },
    ]),
  );
  zip.file(
    "notifications.csv",
    serializeRowsToCsv(payload.notifications, [
      { key: "type", header: "Type" },
      { key: "template", header: "Template" },
      { key: "statut", header: "Statut envoi" },
      { key: "created_at", header: "Date" },
    ]),
  );
  if (payload.interets_producteurs.length > 0) {
    zip.file(
      "interets_producteurs.csv",
      serializeRowsToCsv(payload.interets_producteurs, [
        { key: "source", header: "Source" },
        { key: "statut", header: "Statut" },
        { key: "prenom", header: "Prénom" },
        { key: "nom", header: "Nom" },
        { key: "nom_exploitation", header: "Nom exploitation" },
        { key: "commune", header: "Commune" },
        { key: "telephone", header: "Téléphone" },
        { key: "message", header: "Message" },
        { key: "created_at", header: "Date" },
      ]),
    );
  }

  return zip.generateAsync({ type: "uint8array" });
}

function buildReadme(payload: ExportPayload): string {
  const lines = [
    "Export de tes données personnelles TerrOir",
    "==========================================",
    "",
    `Date de génération : ${payload.meta.generated_at}`,
    `Identifiant utilisateur : ${payload.meta.user_id}`,
    `Format version : ${payload.meta.format_version}`,
    "",
    "Cet export contient toutes les données personnelles que TerrOir détient",
    "à ton sujet, à l'exception des journaux de sécurité (audit_logs)",
    "conservés pour la sécurité du service (1 an, RGPD art. 32).",
    "",
    "Contenu du zip :",
    "",
    "- export.json — la version complète, lisible par un programme.",
    "  Si tu sais lire du JSON ou que tu veux importer dans un autre service,",
    "  c'est le fichier de référence.",
    "",
    "- profil.csv — ton profil compte (email, prénom, nom, téléphone, dates).",
    "",
    "- commandes.csv — l'historique de tes commandes (1 ligne par commande)",
    "  avec code, statut, montant, dates, producteur.",
    "",
    "- articles_commandes.csv — le détail des articles dans chaque commande",
    "  (1 ligne par article : produit, quantité, prix).",
    "",
    "- avis.csv — les avis que tu as postés sur les producteurs.",
    "",
    `- notifications.csv — les notifications reçues sur ${payload.meta.notifications_window_days}`,
    "  derniers jours (au-delà, elles sont purgées automatiquement).",
    "",
    "- interets_producteurs.csv — si tu as déposé une candidature producteur",
    "  ou été invité par un admin (peut être absent si non applicable).",
    "",
    "Ouvre les CSV dans Excel, LibreOffice Calc ou Google Sheets.",
    "L'encodage est UTF-8 avec BOM pour bien afficher les accents.",
    "",
    "Une question ? Réponds simplement à un email TerrOir.",
  ];
  return lines.join("\n");
}

export function buildExportFilename(
  userId: string,
  now: Date = new Date(),
): string {
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
  return `terroir-export-${userId}-${date}.zip`;
}
