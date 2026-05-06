# Fix T-011 — UserProvider INITIAL_SESSION protect + tests

> Session 2026-05-06 (T-011). Articulation : PR #14 (sync useEffect, antérieur), Audit Vercel H-4 du 2026-05-05 (qui a câblé l'INITIAL_SESSION protect par opportunité performance), cette session (vérification + couverture tests).

---

## Bug d'origine

> **T-011** — Bug intermittent navbar « Connexion » affichée alors que l'utilisateur est authentifié. Signalé en prod, reproductible avec un timing serré entre login et premier render de la navbar.

Trace du symptôme : un user se connecte via `/connexion`, l'action server redirect vers `/compte`, le RootLayout est re-rendu côté SSR avec `initial.user` désormais défini, mais le state client `user` reste à `null` car `useState(initial.user)` capture la valeur **du premier mount sur `/connexion`** (où `initial.user` était `null`). La navbar lit `useUserContext().user` → `null` → affiche « Connexion ».

---

## Mitigations en place (avant cette session)

### PR #14 — sync useEffect

Posé en `components/providers/user-provider.tsx` lignes 101-119. Un `useEffect` qui sync `state` quand un nouveau `initial.user` (ou `roles`, `isAdmin`, `isProducer`, `producerLite`) arrive via SSR re-render. Pré-requis : la server action en amont DOIT appeler `revalidatePath("/", "layout")` avant le redirect, sinon le RootLayout est servi depuis le cache RSC client et la prop `initial` reste figée sur la valeur du premier mount.

Couvre les flows : login (PR #13), signup (`app/(consumer)/auth/inscription/actions.ts`), complete-onboarding producer (`app/(producer)/invitation/_actions/complete-onboarding.ts`).

### Audit Vercel H-4 (2026-05-05) — INITIAL_SESSION protect

Posé en `components/providers/user-provider.tsx` lignes 207-220. Le listener `onAuthStateChange` SKIP `applySession()` à la réception d'INITIAL_SESSION (émis par Supabase au mount du subscribe). Justification documentée : « SSR a déjà fourni l'état complet via initial. On flagge juste loading=false pour relâcher l'UI. »

Cette protection a été câblée pour des raisons de **performance** (économiser 3 queries Supabase × N pages × M utilisateurs / jour, cf. commentaire H-4) mais elle adresse aussi par **effet de bord** la classe de bugs T-011 : si la session côté browser n'est pas encore lue (cookies pas encore traités, race timing), `applySession(null)` aurait écrasé le `user` SSR-fourni avec `null`. Le skip empêche cet écrasement.

---

## Travail T-011 cette session

### LOT 7.1 — Audit existant

Confirmation : les **deux mitigations sont déjà en place** dans le code. PR #14 (sync useEffect) + INITIAL_SESSION protect (audit Vercel H-4). Aucune activation supplémentaire nécessaire.

### LOT 7.2 — Activation snippet

Sans objet — déjà câblé (cf. LOT 7.1).

### LOT 7.3 — Tests vitest (apport de cette session)

Création de `tests/components/providers/user-provider.test.tsx` (6 tests) couvrant :

| # | Scénario | Verrou |
|---|---|---|
| 1 | Mount avec `initial.user` fourni → state utilise initial sans re-fetch | PR #14 + INITIAL_SESSION protect (skip applySession à `INITIAL_SESSION`, même avec session null) |
| 2 | Mount anonyme `initial=null` → loading=false immédiat | Pas d'attente d'INITIAL_SESSION pour relâcher l'UI quand initial.user est null |
| 3 | SIGNED_IN après mount anonyme → user mis à jour + loadProfile | Path normal `applySession` pour les events identité |
| 4 | SIGNED_OUT après mount loggé → reset complet | Path normal `applySession`, distinct de l'INITIAL_SESSION protect |
| 5 | Sync useEffect : changement de `initial.user` via re-render parent → state suit | PR #14 (cas login → revalidatePath → re-render RSC) |
| 6 | Sync useEffect : logout via re-render initial → state suit | PR #14 (cas symétrique : logout côté serveur) |

Mock pattern : `vi.mock` sur `@/lib/supabase/client` pour capturer le callback `onAuthStateChange` et le firer manuellement dans les tests + `vi.mock` sur `@/lib/auth/cross-tab-auth-sync` pour neutraliser le broadcaster.

### LOT 7.4 — Doc

Cette doc clôture T-011. Mention dans `docs/TODO.md` à passer au statut résolu (Romain le fera manuellement).

---

## Régression à surveiller

Si quelqu'un retire le `if (event === "INITIAL_SESSION")` early-return dans `onAuthStateChange`, le bug T-011 réapparaît. Le test #1 (« mount avec initial.user fourni → state utilise initial sans re-fetch ») le détecte automatiquement : il fire `INITIAL_SESSION` avec `session=null` et asserte que `user` reste `user-romain`.

Si quelqu'un retire le `useEffect` ligne 101-119 (sync state ↔ initial), le bug T-011 réapparaît sur le flow login → redirect (sans hard refresh). Les tests #5 + #6 le détectent.

---

## Articulation autres chantiers

- **PR #14** (commit historique, antérieur à cette session) — fix `revalidatePath("/", "layout")` côté server action + sync useEffect côté UserProvider.
- **PR #13** — fix initial revalidatePath sur login flow.
- **Audit Vercel H-4 du 2026-05-05** — perf optimization qui a câblé l'INITIAL_SESSION protect par opportunité.
- **T-012** (livré antérieurement) — `roles` SSR-fournis par layout root via `getInitialUserPayload()` (élimination du « pop » du RoleToggle multi-rôle au hard refresh).
- **T-316** (cross-tab auth sync) — broadcaster qui re-applique le state quand un autre tab modifie la session (cookies pas notifié par Supabase onAuthStateChange dans ce setup). Indépendant de T-011.

---

## Liens

- `components/providers/user-provider.tsx` — composant fixé, lignes 101-119 (sync useEffect PR #14) et 207-220 (INITIAL_SESSION protect H-4).
- `tests/components/providers/user-provider.test.tsx` — couverture vitest 6 tests (T-011).
- `docs/audits/audit-vercel-react-perf-2026-05-05.md` — audit qui a câblé l'INITIAL_SESSION protect (H-4).
