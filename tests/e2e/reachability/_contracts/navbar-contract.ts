/**
 * Navbar contract versionné — single source of truth des labels attendus
 * dans NavbarPublic selon le rôle et le viewport.
 *
 * Doctrine reachability (cycle e2e exhaustif Phase 5) :
 *   - Tout changement de label visible dans la navbar = update ici =
 *     les tests reachability force l'alignement automatiquement.
 *   - Toute évolution navbar (ajout/retrait d'item, changement wording)
 *     impose de reviewer la liste des call sites consommateurs.
 *
 * Apostrophes : `'` (U+2019) volontaire pour matcher le rendu HTML
 * (`&rsquo;` dans NavbarPublic). Les tests doivent comparer en
 * insensitive-aware (regex avec `['']`) pour rester robustes.
 *
 * Source de vérité (cycle 2026-05-07, post-fix navbar 5fa57eb) :
 *   components/ui/navbar-public.tsx — bloc desktop bar (l.226-293) +
 *   bloc drawer mobile (l.305-397).
 *   components/ui/footer.tsx — Footer reste à part (pas dans ce contract).
 */

export const NAVBAR_CONTRACT = {
  desktop: {
    /** !user — links visibles dans la barre desktop. */
    anonymous: [
      'Connexion',
      'S’inscrire', // Apostrophe courbe (U+2019) — rendu via &rsquo;
      'Panier',
    ],
    /** user logged consumer-only — pas de Panier visible si isAdmin (sinon visible). */
    consumer: ['Mon compte', 'Déconnexion', 'Panier'],
    /** producer (= consumer + producer roles) — Panier reste visible côté navbar (pas isAdmin). */
    producer: ['Mon compte', 'Déconnexion', 'Panier'],
    /** admin — pas de Panier (isAdmin=true cache le bouton). Badge Admin présent. */
    admin: ['Tableau de bord', 'Admin', 'Déconnexion'],
  },
  mobile_drawer: {
    /** !user — drawer mobile, S'inscrire en tête full-width. */
    anonymous: ['Connexion', 'S’inscrire'],
    /** user logged consumer-only — drawer rend Mon compte + Déconnexion. */
    consumer: ['Mon compte', 'Déconnexion'],
    /** producer — même rendu drawer que consumer (link vers /compte ; bascule via RoleToggle). */
    producer: ['Mon compte', 'Déconnexion'],
    /** admin — drawer affiche le link vers /tableau-de-bord + Déconnexion. */
    admin: ['Tableau de bord', 'Déconnexion'],
  },
  /** Liens de navigation principaux toujours présents (les 4 liens defaultLinks). */
  navlinks: [
    'Rencontrer les producteurs',
    'Carte',
    'Notre démarche',
    'Comment ça marche',
  ],
} as const;

export type NavbarRole = keyof typeof NAVBAR_CONTRACT.desktop;
export type NavbarSurface = 'desktop' | 'mobile_drawer';
