/**
 * E2E consumer/suivi-commandes — tracking anonyme par code retrait.
 *
 * STATUT : SKIP — la page publique /suivi-commandes n'existe pas côté
 * consumer dans la codebase actuelle. Le concept "code retrait TRR-XXXXX"
 * est exclusivement utilisé :
 *   - Côté producer pour valider un pickup (cf. /commandes prod side)
 *   - Côté consumer dans la page détail /compte/commandes/[id] (visible
 *     une fois la commande passée en statut=confirmed)
 *
 * Le seul `/suivi-commandes` existant est dans (admin)/_components/AdminSidebar.tsx
 * = page admin de monitoring orders, pas un flow public anon.
 *
 * Décision : skip avec raison explicite. À reconsidérer si un flow
 * "tracker ma commande sans login via le code retrait" est ajouté au
 * backlog produit.
 */

import { test } from '../helpers/test-context';

test.describe('Consumer — /suivi-commandes (tracking anonyme par code retrait)', () => {
  test.skip('lookup code retrait → trouve l\'order : route consumer absente', () => {
    // Aucune page publique /suivi-commandes côté consumer dans la codebase.
    // Backlog produit : à proposer si UX flow "tracker ma commande sans login".
  });

  test.skip('code retrait invalide : route consumer absente', () => {
    // Same as above.
  });

  test.skip('code retrait completed → "Retrait validé" : route consumer absente', () => {
    // Same as above.
  });
});
