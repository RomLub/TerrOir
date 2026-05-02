// Types neutres client-safe pour l'auth (pas de server-only, pas de runtime).
// Importable côté server (lib/auth/session.ts) ET côté client
// (components/providers/user-provider.tsx) sans collision avec server-only.
//
// Convention alignée sur lib/auth/roles.ts (lui aussi client-safe).

import type { User } from "@supabase/supabase-js";
import type { UserRole } from "./roles";

// Vue allégée d'une ligne `producers` pour le chrome ProducerLayout (sidebar,
// lien page publique). Champs minimaux consommés par useUserContext().producer.
// Source de vérité pour le SSR pré-fetch ET le profil rechargé côté client.
export interface ProducerLite {
  id: string;
  slug: string;
  nom_exploitation: string;
  statut: string;
}

// Payload SSR consommé par UserProvider pour démarrer avec le bon état
// admin/producer dès le premier render et éviter les flashs au hard refresh
// (badge Admin, placeholder ProducerLayout, RoleToggle multi-rôle). Étend le
// pattern initialUser SSR (commits 6a9ebd3 → 404bb0d → 20304e9 → T-012).
//
// Invariant : isProducer === (producerLite !== null). Les deux flags sont
// dérivés du même lookup `producers` (fusion 1 round-trip).
//
// `roles` reflète strictement la colonne `users.roles` (text[], NOT NULL,
// default ['consumer']) — distinct de isAdmin qui vient de admin_users
// (table mutuellement exclusive avec users.roles).
export interface InitialUserPayload {
  user: User | null;
  isAdmin: boolean;
  isProducer: boolean;
  producerLite: ProducerLite | null;
  roles: UserRole[];
}
