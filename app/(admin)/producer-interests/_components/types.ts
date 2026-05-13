// Re-export du type canonique partagé. Source de vérité :
// lib/admin/producer-interests/types.ts (utilisé aussi côté API routes et
// Server Component fetch). Les Client Components colocalisés gardent leurs
// imports relatifs ("./types") inchangés.
export type {
  LeadStatus,
  LeadSource,
  AdminProducerInterestRow as Lead,
} from "@/lib/admin/producer-interests/types";
