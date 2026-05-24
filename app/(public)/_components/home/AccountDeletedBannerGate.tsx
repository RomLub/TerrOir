'use client';

import { useSearchParams } from 'next/navigation';
import { AccountDeletedBanner } from './AccountDeletedBanner';

// Gate client de la bannière "Compte supprimé".
//
// Pourquoi client : la home (route /) doit pouvoir être prerendue + prefetchée
// pour une navigation instantanée. Lire searchParams côté Server Component au
// top de la page forçait un rendu dynamique à chaque hit (même les 99% de hits
// home sans le param). En déportant la lecture du flag dans un Client Component
// via useSearchParams, la page redevient statique et le shell s'affiche
// instantanément ; seul ce petit composant lit le querystring après hydratation.
//
// Le param ?compte-supprime=1 est posé par delete-account-action.ts après la
// suppression RGPD (redirect serveur vers /?compte-supprime=1). La bannière
// confirme visuellement la suppression pendant que l'user est encore sur la home.
export function AccountDeletedBannerGate() {
  const searchParams = useSearchParams();
  if (searchParams.get('compte-supprime') !== '1') return null;
  return <AccountDeletedBanner />;
}
