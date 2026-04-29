import { NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_PRODUCER_URL } from "@/lib/env/urls";

// Source unique pour le gating + URLs cross-subdomain des switchers de rôle
// (RoleToggle navbar horizontale + RoleSwitcher sidebar verticale).
// Pure function — pas de "use client" nécessaire — testable sans React.
//
// `show` = true uniquement quand l'user a les deux rôles consumer ET
// producer. URLs absolues car la bascule traverse les sous-domaines (cookies
// session partagés sur .terroir-local.fr — cf. lib/supabase/cookie-domain.ts).

export type RoleSwitcherUrls = {
  show: boolean;
  consumerUrl: string;
  producerUrl: string;
};

export function getRoleSwitcherUrls(
  roles: readonly string[],
): RoleSwitcherUrls {
  const show = roles.includes("consumer") && roles.includes("producer");
  return {
    show,
    consumerUrl: `${NEXT_PUBLIC_APP_URL}/compte`,
    producerUrl: `${NEXT_PUBLIC_PRODUCER_URL}/dashboard`,
  };
}
