import "server-only";

// Types partagés pour le pipeline admin reviews. La page /admin/avis (Server
// Component dynamique) fetch via service_role (bypass RLS — la table reviews
// n'a pas de policy admin, cf. AUDIT_ADMIN § 4.5) et passe les rows mappés à
// un sous-composant client pour les interactions (publish/reject + delete
// response). Les rows DB embarquent `consumer` + `producer` via jointure,
// chacun pouvant arriver en array (Supabase PostgREST) ou en objet selon les
// versions du client — on tolère les deux dans le mapper.

// ─── Row DB brut côté reviews pending ────────────────────────────────────
export type ReviewPendingDbRow = {
  id: string;
  note: number;
  commentaire: string | null;
  created_at: string;
  consumer:
    | { prenom: string | null; nom: string | null }
    | Array<{ prenom: string | null; nom: string | null }>
    | null;
  producer:
    | { nom_exploitation: string; slug: string }
    | Array<{ nom_exploitation: string; slug: string }>
    | null;
};

// ─── Row DB brut côté reviews publiées avec réponse producer ────────────
export type ReviewWithResponseDbRow = ReviewPendingDbRow & {
  producer_response: string;
  producer_response_at: string;
  producer_response_status: "published";
};

// ─── Row affichable côté UI (pending) ────────────────────────────────────
export type AdminReviewRow = {
  id: string;
  author: string;
  rating: number;
  comment: string;
  producer: string;
  producerSlug: string;
  date: string;
};

// ─── Row affichable côté UI (published + producer response) ─────────────
export type AdminReviewWithResponseRow = AdminReviewRow & {
  response: string;
  responseAt: string;
  responseStatus: "published";
};
