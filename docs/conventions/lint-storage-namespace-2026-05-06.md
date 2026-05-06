# Règle ESLint préfixe `terroir_` sur clés sessionStorage / localStorage — 2026-05-06 (T-266)

**Contexte** : éviter les collisions avec extensions navigateur,
bibliothèques tierces (Sentry, GTM, etc.), ou autres applications hébergées
sur le même domaine (sous-domaines partagent le `localStorage` host-keyed
selon contexte). Imposer un préfixe `terroir_<scope>_<key>` à toute clé
`sessionStorage` / `localStorage` posée par le code TerrOir.

T-266 met en place une règle ESLint qui bloque les call sites
`(session|local)Storage.{set,get,remove}Item('xxx', ...)` où la clé `xxx`
ne commence pas par `terroir_` ou `terroir-`.

---

## Implémentation

Règle built-in ESLint `no-restricted-syntax` avec **2 sélecteurs**
AST/esquery (un par variante d'accès — direct ou via `window.`).

```json
{
  "selector": "CallExpression[callee.object.name=/^(local|session)Storage$/][callee.property.name=/^(set|get|remove)Item$/][arguments.0.type='Literal'][arguments.0.value!=/^terroir[_-]/]",
  "message": "T-266: ..."
},
{
  "selector": "CallExpression[callee.object.property.name=/^(local|session)Storage$/][callee.object.object.name='window'][callee.property.name=/^(set|get|remove)Item$/][arguments.0.type='Literal'][arguments.0.value!=/^terroir[_-]/]",
  "message": "T-266: ..."
}
```

**Conditions matchées** :
- callee object = `localStorage` ou `sessionStorage` (variante directe)
- ou callee object = `window.localStorage` ou `window.sessionStorage`
- callee property = `setItem` / `getItem` / `removeItem`
- argument 0 = `Literal` string
- argument 0 value ne commence PAS par `terroir_` ou `terroir-`

**Exceptions implicites** (faux négatifs documentés) :
- Argument 0 dynamique (variable, template literal, expression) : la règle
  ne peut pas vérifier statiquement → laissé passer. Charge au développeur
  de respecter la convention.
- Stores zustand `persist({ name: '...' })` (`lib/store/cart.ts`) : ne
  passe pas par `localStorage.setItem` directement, donc invisible pour la
  règle. Convention nommage à respecter manuellement.
- Cookies, IndexedDB, autres mécanismes de stockage : hors-scope.

---

## Préfixe accepté

**Cible** : `terroir_<scope>_<key>` (snake_case, underscore).

**Legacy toléré transitoirement** : `terroir-<key>` (tiret). Trois clés
historiques existent en prod déployées chez les utilisateurs et nécessitent
une stratégie de migration douce avant renommage strict :

| Clé legacy | Fichier | Type | Migration backlog |
|------------|---------|------|-------------------|
| `terroir-saved-email` | `lib/storage/local-preferences.ts` | localStorage | T-266-bis |
| `terroir-cart-banner-dismissed` | `app/(consumer)/compte/panier/_components/StaleItemsBanner.tsx` | sessionStorage | T-266-bis |
| `terroir-cart` | `lib/store/cart.ts` (zustand persist) | localStorage | T-266-bis |

⚠️ Renommer ces clés sans migration cassera les sessions/préférences des
utilisateurs déjà connectés (panier vidé, email login non pré-rempli,
banner stale items qui re-déclenche). Cf. `LOT 5.2` du brief T-266 :
"STOP avant renommage et reporter à Romain".

---

## Stratégie migration legacy (T-266-bis backlog)

Pattern lecture ancien + nouveau pendant N jours, puis purge ancien :

```ts
// Phase 1 (jour J → J+30) : lecture des deux, écriture nouvelle
const value =
  localStorage.getItem('terroir_<scope>_<key>') ??
  localStorage.getItem('terroir-<old-key>');
localStorage.setItem('terroir_<scope>_<key>', newValue);
// Pas de removeItem('terroir-<old-key>') pour permettre rollback.

// Phase 2 (jour J+30) : purge ancien
localStorage.removeItem('terroir-<old-key>');
// Et règle ESLint passe en strict (regex /^terroir_/ au lieu de /^terroir[_-]/).
```

Les 3 clés legacy peuvent être migrées indépendamment.

---

## Validation

1. **Test négatif** (effectué pendant le développement) :
   - `localStorage.setItem('not_prefixed', 'foo')` → erreur T-266 ✅
   - `sessionStorage.getItem('also_bad')` → erreur T-266 ✅
   - `window.localStorage.setItem('window_bad', 'bar')` → erreur T-266 ✅
   - `localStorage.setItem('terroir_ok_key', 'good')` → OK ✅
   - `localStorage.setItem('terroir-legacy', 'good')` → OK ✅

2. **Test positif** : `npx next lint --max-warnings=0` actuellement OK
   (1 warning préexistant non-lié `react-hooks/exhaustive-deps` dans
   `components/providers/user-provider.tsx`).

3. **Inventaire repo** : 4 call sites prod + 9 e2e/vitest, tous conformes
   `terroir_` ou `terroir-` :
   - `lib/storage/local-preferences.ts` (terroir-saved-email)
   - `app/(consumer)/compte/panier/_components/StaleItemsBanner.tsx`
     (terroir-cart-banner-dismissed)
   - `app/(public)/producteurs/[slug]/_components/DistanceWidget.tsx`
     (terroir_geo_session — déjà conforme T-239+T-240)
   - `tests/e2e/stripe-decline.spec.ts`, `tests/e2e/legal/checkout-cgv.spec.ts`
     (terroir-cart via window.localStorage.setItem)
   - `tests/app/producteurs/distance-widget.test.tsx` (terroir_geo_session)

---

## Doctrine pattern futurs

> Toute nouvelle clé `(session|local)Storage` doit utiliser le préfixe
> `terroir_<scope>_<key>` (snake_case, underscore).
>
> Exemples valides :
> - `terroir_geo_session` (DistanceWidget — déjà en place)
> - `terroir_cart_draft` (T-266-bis cible pour zustand persist)
> - `terroir_auth_saved_email` (T-266-bis cible)
> - `terroir_ui_banner_dismissed` (T-266-bis cible)
>
> **Interdit** : préfixes ad hoc (`saved-email`, `app_cart`, etc.). La
> règle ESLint bloque au CI.
>
> **Toléré transitoirement** : préfixe `terroir-` (tiret) sur les 3 clés
> legacy listées ci-dessus, jusqu'à migration T-266-bis.
>
> **Cas pas couvert** : zustand `persist({ name })` ne passe pas par la
> règle (l'écriture est interne à zustand). Respect manuel obligatoire.

---

## Backlog

- **T-266-bis** : migration des 3 clés legacy (`terroir-saved-email`,
  `terroir-cart-banner-dismissed`, `terroir-cart`) vers le format
  `terroir_<scope>_<key>` strict, avec stratégie lecture ancien+nouveau
  pendant 30 jours puis purge.
- **T-266-ter** (optionnel) : helper `terroirStorage` qui wrap
  sessionStorage/localStorage avec le préfixe forcé. Ergonomie
  développeur + sécurité supplémentaire (impossible d'oublier le préfixe
  si on passe par le helper).
- **À considérer** : étendre la doctrine aux IndexedDB / Cache API si
  TerrOir en utilise un jour.
