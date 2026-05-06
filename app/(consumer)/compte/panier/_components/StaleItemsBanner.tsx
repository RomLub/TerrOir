'use client';

// Bandeau persistant affiché au-dessus du panier quand la validation DB
// détecte des items retirés ou ajustés. Pas de toast : l'info est
// importante, le user doit la voir. Dismiss manuel persisté en
// sessionStorage par hash des changements — le même jeu de changements ne
// re-flashe pas après dismiss, mais un nouveau jeu déclenche un re-flash.

import { useEffect, useState } from 'react';
import { createMigratedStorage } from '@/lib/storage/migrated-storage';

export type StaleChange = {
  nom: string;
  reason: string;
};

// T-266-bis : migration progressive 'terroir-cart-banner-dismissed' (legacy)
// → 'terroir_cart_banner_dismissed' (cible). Le helper lit ancien+nouveau,
// ecrit nouveau uniquement, migre au passage. Suppression fallback legacy
// programmee apres 2026-06-05 (T-266-tris).
const bannerDismissedStorage = createMigratedStorage(
  'terroir-cart-banner-dismissed',
  'terroir_cart_banner_dismissed',
  'session',
);

function hashChanges(changes: StaleChange[]): string {
  return changes
    .map((c) => `${c.nom}::${c.reason}`)
    .sort()
    .join('|');
}

export function StaleItemsBanner({
  changes,
  forceShow,
}: {
  changes: StaleChange[];
  forceShow: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  const hash = hashChanges(changes);

  useEffect(() => {
    if (changes.length === 0) return;
    if (forceShow) {
      bannerDismissedStorage.remove();
      setDismissed(false);
      return;
    }
    const stored = bannerDismissedStorage.read();
    setDismissed(stored === hash);
  }, [hash, forceShow, changes.length]);

  if (changes.length === 0 || dismissed) return null;

  const onDismiss = () => {
    bannerDismissedStorage.write(hash);
    setDismissed(true);
  };

  return (
    <div className="mb-6 rounded-2xl border border-terra-300/50 bg-terra-100/60 p-5 shadow-soft">
      <div className="flex items-start gap-4">
        <span className="text-xl" aria-hidden>
          ⚠️
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="font-serif text-[18px] text-terra-900 leading-tight">
            Votre panier a été mis à jour
          </h2>
          <p className="text-[13px] text-dark/70 mt-1">
            Certains produits ne sont plus disponibles ou ont été ajustés depuis leur ajout.
          </p>
          <ul className="mt-3 space-y-1.5 text-[13px] text-dark/85">
            {changes.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-terra-700" aria-hidden>
                  •
                </span>
                <span>
                  <span className="font-semibold">{c.nom}</span> — {c.reason}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[12px] text-dark/60 hover:text-dark/90 underline shrink-0"
          aria-label="Fermer le message"
        >
          Fermer
        </button>
      </div>
    </div>
  );
}
