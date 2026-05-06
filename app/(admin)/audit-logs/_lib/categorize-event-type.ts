import type { AuditEventType } from "./event-types";

// Catégorisation purement par préfixe / set explicite — déterministe,
// testable. Sert au rendu visuel (palette de badge) et au regroupement
// des pills par cluster côté UI filtres.
//
// Ordre d'évaluation : préfixes les plus spécifiques d'abord. `admin_invite_*`
// passe AVANT le fallback `auth` parce que les events admin_invite_* sont
// stockés via logAdminInviteEvent qui pointe sur AUTH_EVENT_TYPES — donc
// sans un préfixe distinct, ils tomberaient en "auth" et perdraient leur
// regroupement visuel propre. Idem `email_*` / `notification_*` /
// `producer_response_*` / `admin_legal_*`.
export type EventCategory =
  | "auth"
  | "admin_invite"
  | "order"
  | "stripe"
  | "review"
  | "notification"
  | "legal"
  | "email"
  | "catalog";

export function categorizeEventType(eventType: AuditEventType): EventCategory {
  if (eventType.startsWith("admin_invite_")) return "admin_invite";
  if (
    eventType.startsWith("admin_legal_") ||
    eventType.startsWith("admin_audit_logs_")
  )
    return "legal";
  // T-130 : mutations admin sur les 3 référentiels de catégorisation produit.
  // Doit passer AVANT le fallback "auth" (préfixes commencent par "admin_"
  // mais ne sont pas des events auth).
  if (
    eventType.startsWith("admin_category_") ||
    eventType.startsWith("admin_animal_") ||
    eventType.startsWith("admin_cut_")
  )
    return "catalog";
  if (eventType.startsWith("stripe_")) return "stripe";
  if (eventType.startsWith("order_")) return "order";
  if (eventType.startsWith("producer_response_")) return "review";
  if (eventType.startsWith("notification_")) return "notification";
  // Email delivery webhooks (Resend) — préfixes spécifiques pour ne PAS
  // capturer 'email_change' qui est un event auth (changement d'adresse
  // email côté user, pas un delivery event externe).
  if (
    eventType.startsWith("email_complaint_") ||
    eventType.startsWith("email_hard_bounce_") ||
    eventType.startsWith("email_soft_bounce_")
  )
    return "email";
  return "auth";
}

// Palette dérivée des classes Tailwind déjà utilisées dans le projet
// (cf. terroir-green, suivi-commandes meta). Une couleur distincte par
// catégorie pour bonne lisibilité au survol d'un volume important.
export const CATEGORY_PALETTE: Record<
  EventCategory,
  { label: string; bg: string; text: string; dot: string }
> = {
  auth: {
    label: "Auth",
    bg: "bg-blue-50",
    text: "text-blue-700",
    dot: "bg-blue-500",
  },
  admin_invite: {
    label: "Invitations",
    bg: "bg-indigo-50",
    text: "text-indigo-700",
    dot: "bg-indigo-500",
  },
  order: {
    label: "Commande",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    dot: "bg-emerald-500",
  },
  stripe: {
    label: "Stripe",
    bg: "bg-amber-50",
    text: "text-amber-700",
    dot: "bg-amber-500",
  },
  review: {
    label: "Avis",
    bg: "bg-pink-50",
    text: "text-pink-700",
    dot: "bg-pink-500",
  },
  notification: {
    label: "Notifications",
    bg: "bg-cyan-50",
    text: "text-cyan-700",
    dot: "bg-cyan-500",
  },
  legal: {
    label: "Légal",
    bg: "bg-purple-50",
    text: "text-purple-700",
    dot: "bg-purple-500",
  },
  email: {
    label: "Email",
    bg: "bg-rose-50",
    text: "text-rose-700",
    dot: "bg-rose-500",
  },
  catalog: {
    label: "Catalogue",
    bg: "bg-teal-50",
    text: "text-teal-700",
    dot: "bg-teal-500",
  },
};
