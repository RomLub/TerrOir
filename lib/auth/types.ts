// Types neutres client-safe pour l'auth (pas de server-only, pas de runtime).
// Importable côté server (lib/auth/session.ts) ET côté client
// (components/providers/user-provider.tsx) sans collision avec server-only.
//
// Convention alignée sur lib/auth/roles.ts (lui aussi client-safe).

import type { User } from "@supabase/supabase-js";

// Payload SSR consommé par UserProvider pour démarrer avec le bon état
// admin/producer dès le premier render et éviter les flashs au hard refresh
// (badge Admin, placeholder ProducerLayout). Étend le pattern initialUser SSR
// (commits 6a9ebd3 → 404bb0d → en cours).
export interface InitialUserPayload {
  user: User | null;
  isAdmin: boolean;
  isProducer: boolean;
}
