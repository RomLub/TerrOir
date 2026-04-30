import type { AuditEventType } from "./event-types";

// Catégorisation purement par préfixe — déterministe, testable. Sert au
// rendu visuel (palette de badge) et au regroupement éventuel futur.
export type EventCategory = "auth" | "order" | "stripe";

export function categorizeEventType(eventType: AuditEventType): EventCategory {
  if (eventType.startsWith("stripe_")) return "stripe";
  if (eventType.startsWith("order_")) return "order";
  return "auth";
}

// Palette dérivée des classes Tailwind déjà utilisées dans le projet
// (cf. terroir-green, suivi-commandes meta). Trois couleurs distinctes
// pour bonne lisibilité au survol d'un volume important.
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
};
