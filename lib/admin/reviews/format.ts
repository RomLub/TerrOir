import "server-only";
import type {
  AdminReviewRow,
  AdminReviewWithResponseRow,
  ReviewPendingDbRow,
  ReviewWithResponseDbRow,
} from "./types";

// Helpers pure de mapping row DB → row UI. Pas d'I/O. Testables sans mock.

// Format ISO date → "13 mai 2026" (locale fr-FR). Fallback sur la string
// brute si parsing échoue (defensive : audit forensique post-migration).
export function formatReviewDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// Résout un champ embed PostgREST (toleré array ou objet selon version
// client). Retourne null si non présent.
function pickEmbedded<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

// Construit l'auteur affichable "Prénom N." à partir du nom complet
// consumer. Fallback "Anonyme" si tout est null.
function formatAuthor(
  consumer: { prenom: string | null; nom: string | null } | null,
): string {
  if (!consumer) return "Anonyme";
  const prenom = consumer.prenom?.trim() ?? "";
  const initiale = consumer.nom?.trim()?.[0] ?? "";
  const head = [prenom, initiale].filter(Boolean).join(" ").trim();
  if (!head) return "Anonyme";
  return initiale ? `${head}.` : head;
}

export function mapPendingReview(row: ReviewPendingDbRow): AdminReviewRow {
  const consumer = pickEmbedded(row.consumer);
  const producer = pickEmbedded(row.producer);
  return {
    id: row.id,
    author: formatAuthor(consumer),
    rating: row.note,
    comment: row.commentaire ?? "",
    producer: producer?.nom_exploitation ?? "—",
    producerSlug: producer?.slug ?? "",
    date: formatReviewDate(row.created_at),
  };
}

export function mapReviewWithResponse(
  row: ReviewWithResponseDbRow,
): AdminReviewWithResponseRow {
  return {
    ...mapPendingReview(row),
    response: row.producer_response,
    responseAt: formatReviewDate(row.producer_response_at),
    responseStatus: row.producer_response_status,
  };
}
