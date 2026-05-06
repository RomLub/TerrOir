# Migration progressive clés `terroir-` → `terroir_` — 2026-05-06 (T-266-bis)

## Contexte

T-266 (commit `2839b34`) a posé la règle ESLint qui force le préfixe
`terroir_` (underscore) sur toute clé `(session|local)Storage` posée par
le code TerrOir. 3 clés legacy étaient déjà déployées en prod avec le
préfixe `terroir-` (tiret) :

| Clé legacy | Fichier source | Type | Description |
|------------|----------------|------|-------------|
| `terroir-saved-email` | `lib/storage/local-preferences.ts` | localStorage | email pré-rempli login |
| `terroir-cart-banner-dismissed` | `app/(consumer)/compte/panier/_components/StaleItemsBanner.tsx` | sessionStorage | dismiss bandeau panier |
| `terroir-cart` | `lib/store/cart.ts` (zustand persist `name`) | localStorage | panier consumer |

Renommer immédiatement aurait cassé l'expérience users :
- panier vidé pour tous les users connectés en cours de session
- email login non pré-rempli pour les users qui avaient checké "Se souvenir"
- bandeau stale items qui re-déclenche pour des users qui l'avaient déjà
  vu et fermé

T-266-bis pose une **migration progressive ancien+nouveau 30j** : code
lit ancien OU nouveau, écrit nouveau uniquement, supprime ancien au
passage. Migration silencieuse côté users.

---

## Mapping ancien → nouveau

| Ancienne clé | Nouvelle clé | Helper utilisé |
|--------------|--------------|----------------|
| `terroir-saved-email` | `terroir_saved_email` | `createMigratedStorage` |
| `terroir-cart-banner-dismissed` | `terroir_cart_banner_dismissed` | `createMigratedStorage` |
| `terroir-cart` | `terroir_cart` | `cartStorageAdapter` inline (zustand) |

---

## Helper générique `createMigratedStorage`

`lib/storage/migrated-storage.ts` :

```ts
export function createMigratedStorage(
  oldKey: string,
  newKey: string,
  type: "local" | "session",
): MigratedStorage;
```

Retourne `{ read, write, remove }` :

- `read()` : essaie nouvelle clé d'abord ; sinon fallback ancienne. Si
  trouvée sur l'ancienne, la migre vers la nouvelle (re-write + suppression
  ancienne) et retourne la valeur.
- `write(value)` : écrit uniquement sur nouvelle clé. Supprime aussi
  l'ancienne au passage (cleanup race).
- `remove()` : supprime ancienne ET nouvelle (cas logout / RGPD).

SSR-safe (no-op si `window` undefined). Fail-silent sur exception
(quota, mode privé Safari).

### Tests

`tests/lib/storage/migrated-storage.test.ts` — 8 tests couvrant :
- read nouvelle clé seule
- read fallback ancienne + migration au passage
- read aucune clé peuplée → null
- read 2 clés peuplées (race) → priorise nouvelle
- write seul nouvelle clé
- write supprime ancienne au passage
- remove supprime les 2 clés
- isolation `local` vs `session`

---

## Cas zustand cart (storage adapter custom inline)

Zustand `persist({ name: 'terroir-cart', storage: createJSONStorage(...) })`
ne passe pas par `localStorage.setItem(key, value)` direct mais via une
interface `Storage` standard (`getItem` / `setItem` / `removeItem` /
`clear` / `length` / `key`). Le helper générique `createMigratedStorage`
n'expose pas cette interface.

Solution : storage adapter custom inline dans `lib/store/cart.ts` qui :
- `getItem(name)` : si `name === 'terroir_cart'` → essaie nouvelle, fallback
  legacy + migration. Pour les autres clés, comportement standard
  `localStorage.getItem`.
- `setItem(name, value)` : écrit standard ; si `name === 'terroir_cart'`,
  supprime aussi `terroir-cart` legacy.
- `removeItem(name)` : supprime standard ; si `name === 'terroir_cart'`,
  supprime aussi `terroir-cart`.

Modifs `lib/store/cart.ts` :
- Constantes `CART_KEY = 'terroir_cart'` et `CART_KEY_LEGACY = 'terroir-cart'`.
- `cartStorageAdapter: Storage` qui implémente l'interface.
- `persist({ name: CART_KEY, storage: createJSONStorage(() => cartStorageAdapter), version: 1 })`.

Effet runtime :
- User existant avec `terroir-cart` peuplé : au prochain hydrate zustand,
  `getItem('terroir_cart')` lit la nouvelle (null), fallback `terroir-cart`,
  migre, retourne la valeur. Panier préservé sans perte.
- User vierge : `getItem('terroir_cart')` retourne null, `terroir-cart`
  vide aussi. Zustand init un nouveau cart vide. Ecritures futures sur
  `terroir_cart` uniquement.

---

## Doctrine T-266 / T-266-bis renforcée

> Toute nouvelle clé `(session|local)Storage` utilise le préfixe
> `terroir_<scope>_<key>` (snake_case, underscore). La règle ESLint
> `no-restricted-syntax` (cf. T-266 dans `.eslintrc.json`) bloque au CI.
>
> **Préfixe `terroir-` (tiret) toléré transitoirement** pour les 3 clés
> legacy listées ci-dessus, jusqu'à suppression du fallback legacy
> programmée après **2026-06-05** (T-266-tris). Pas de nouvelle clé
> `terroir-` ne doit être ajoutée.

---

## Suppression du fallback legacy — programmée 2026-06-05

T-266-tris (à ouvrir / suivre) :

1. Supprimer le fallback `oldKey` de `createMigratedStorage` (ne plus
   lire l'ancienne, ne plus la supprimer au passage).
2. Modifier `cartStorageAdapter` dans `lib/store/cart.ts` pour ne plus
   lire `CART_KEY_LEGACY`. Garder potentiellement le `removeItem` legacy
   au passage pendant 1 mois supplémentaire pour cleanup les utilisateurs
   en hibernation profonde.
3. Modifier la règle ESLint pour passer du regex `^terroir[_-]` à
   `^terroir_` (strict). Plus aucune nouvelle clé `terroir-` ne sera
   acceptée.
4. Supprimer la doc transitoire (cette doc) ou la marquer `historique`.

À mettre en alarme calendrier ou ticket dédié pour ne pas oublier.

---

## Cas e2e tests

Les e2e Playwright `tests/e2e/stripe-decline.spec.ts:441` et
`tests/e2e/legal/checkout-cgv.spec.ts:174` injectent un panier en
`localStorage.setItem('terroir-cart', ...)`. Pendant la phase de migration,
ces tests valident **indirectement** le path legacy → migration : le
`getItem('terroir_cart')` zustand fallback sur `terroir-cart`, migre, et
zustand hydrate correctement.

À J+30 (suppression fallback) ces tests devront être mis à jour pour
utiliser directement `terroir_cart`. Pas urgent — laisser tel quel
pendant la phase de transition pour valider le path legacy.

---

## Validation

- `npx tsc --noEmit` → 0 erreur.
- `npx vitest run` → 187/187 fichiers, 2194/2194 tests verts (+8 nouveaux
  pour `migrated-storage`, +32 contribués par d'autres chantiers en
  parallèle).
- `npx next lint --max-warnings=0` → OK (1 warning préexistant non-lié).
- Manuel : à tester en prod après deploy : un user existant avec
  `terroir-cart` en localStorage doit voir son panier préservé au prochain
  reload. Vérifier dans DevTools → Application → Local Storage que la
  clé `terroir-cart` disparaît et `terroir_cart` apparaît avec la même
  valeur.

---

## Backlog

- **T-266-tris** (programmé après 2026-06-05) : suppression du fallback
  legacy + bascule règle ESLint en regex strict `^terroir_`.
- **T-266-quater** (optionnel) : helper unifié `terroirStorage` qui force
  le préfixe `terroir_` au runtime (impossible d'oublier le préfixe si
  on passe par le helper). Abstraction supplémentaire à arbitrer si
  l'érosion conventionnelle s'observe.
