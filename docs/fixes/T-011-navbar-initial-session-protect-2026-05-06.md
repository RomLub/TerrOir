# T-011 — Navbar « Connexion » affiché loggé : INITIAL_SESSION protect

Date : 2026-05-06
Status : Confirmé déjà actif (clôture admin, pas de code à pousser)

## Contexte

Le bug T-011 est l'affichage intermittent de « Connexion » dans la
navbar alors que l'utilisateur est authentifié. Symptôme reproductible
en prod sur certains parcours post-login, et observé après hard
refresh dans des conditions précises (race entre la lecture cookies
côté browser et le mount du `UserProvider`).

Deux mitigations distinctes ont été mises en place sur ce repo :

1. **PR #14 (commit `a14f951`)** — `useEffect` de sync de l'`initial`
   prop dans `UserProvider` (`components/providers/user-provider.tsx`
   lignes 101-119). Couvre le cas login server action →
   `revalidatePath` → RSC re-render `RootLayout` avec un nouveau
   `initial.user` que `useState` ne re-évalue pas par défaut.
2. **Audit Vercel H-4 (commit `58c7436`, 2026-05-05)** —
   INITIAL_SESSION protect dans `onAuthStateChange`
   (`components/providers/user-provider.tsx` lignes 207-220). Skip le
   re-fetch `loadProfile` au mount car le payload SSR
   (`getInitialUserPayload`) a déjà fourni `roles`/`isAdmin`/
   `producerLite`/`isProducer`. À la réception d'INITIAL_SESSION, on
   ne flagge que `loading=false`. Si la session côté browser est
   absente au mount (cookies pas encore lus), l'état SSR n'est PAS
   écrasé.

## État au 2026-05-06

Les deux protections sont en place et verrouillées par la suite test
`tests/components/providers/user-provider.test.tsx` :

- 6 tests passent (mount avec `initial.user`, mount anonyme,
  transitions SIGNED_IN/SIGNED_OUT, sync useEffect login/logout via
  re-render parent).
- Run vérifié : `npx vitest run
  tests/components/providers/user-provider.test.tsx` → 6/6 OK.

## Aucune action de code requise

Le brief T-011 mentionnait un snippet préparé à activer. Vérification
faite, le snippet est déjà actif depuis l'audit Vercel H-4 (cycle
2026-05-05). Aucun TODO/FIXME ouvert dans `user-provider.tsx`. La
tâche est traitée — clôture admin uniquement.

## Filet de sécurité résiduel

Si le bug se re-manifestait en prod malgré les deux protections :

- Vérifier que la server action déclenchante appelle bien
  `revalidatePath("/", "layout")` AVANT le redirect (cf. commentaire
  ligne 85-91 du `UserProvider`). Cas connus couverts : login PR #13,
  signup, complete-onboarding producer.
- Vérifier que `getInitialUserPayload()` côté SSR n'a pas dégradé
  silencieusement (le commentaire ligne 192-195 mentionne le trade-off
  fail-safe per-branch : si SSR partiellement échoué, l'état restera
  dégradé jusqu'au prochain event auth post-INITIAL_SESSION).
- Cross-tab : `createAuthBroadcaster` (T-316) propage les transitions
  identité entre onglets via BroadcastChannel API (storage adapter
  Supabase = cookies, donc `onAuthStateChange` ne fire pas
  cross-tab). Vérifier que le tab émetteur appelle bien
  `broadcaster.broadcast()` après le `signIn`/`signOut`.
