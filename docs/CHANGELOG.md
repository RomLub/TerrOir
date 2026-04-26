# CHANGELOG — TerrOir

Historique des chantiers et commits structurants. Ordre antichronologique (plus récent en haut).

Pour les leçons apprises transversales, voir [`LESSONS.md`](./LESSONS.md).
Pour les priorités forward-looking, voir [`TODO.md`](./TODO.md).

---

## 2026-04-26

> Session marathon 25/04 → 26/04 (soir + nuit + suite). **27 commits** au total, 5 chantiers en parallèle puis suite : auth `redirectTo`, logo SVG vectoriel + emails, vision funnel producteur Phase 1+2, audit auto-promotion + purge panier logout, et **suite post-marathon** (reset password page dédiée, rattrapage 4 dettes techniques, PKCE workaround Option B, fix navbar SSR-aware, audit logs auth events). Migrations `20260426000000` + `20260427000000` + `20260427100000` (audit_logs) apply. 5 templates Supabase Auth Email customisés via Dashboard.
>
> 🟢 **Chantiers majeurs clos cette session** : auth flow complètement clos (reset password page dédiée + magic link OTP token_hash + audit logs forensiques), navbar consumer SSR-aware (initialUser passé du root layout), Phase 3 vision funnel sous-chantier reads (lectures `prenom_affichage` migrées vers `users.prenom`).
>
> ⚠️ **Incident traçabilité** : commit `894fa5e` a un message trompeur (sujet `feat(admin): show lead source column in /producer-interests` mais diff réel = `lib/producers/get-display-name.ts` + son test). Cause : race condition multi-terminal sur `git index` pendant la session marathon. Le commit suivant `e5c4234` rejoue le bon sujet sur les vrais fichiers UI. Code en master correct, traçabilité git dégradée (`git blame` sur le helper retombera sur un message incohérent). Voir `LESSONS.md` section « Working tree partagé — race condition message/diff incohérent (26/04) ».

### Chantier auth `redirectTo` (TA)

- **`?redirectTo` honoré par le password login** (commit `53f8f6a`, 25/04 fin de journée) : `loginAction` lit désormais le param posé par le middleware sur les routes protégées plutôt que de toujours router vers `canonicalPostLoginUrl(role)`. Validation defense-in-depth via nouveau helper `isValidRedirectPath` (path local uniquement, rejette `//` et `/\` pour bloquer protocol-relative). `app/connexion/page.tsx` reste server component, le switcher form/magic est extrait dans `connexion-form.tsx` (client) avec input hidden `redirectTo`. Helpers ajoutés à `lib/auth/post-login-redirect.ts` (`isValidRedirectPath`, `resolvePostLoginPath`).
- **`?redirectTo` honoré par le magic link** (commit `d4088d5`) : le param est désormais propagé jusqu'au callback magic link. `ConnexionForm` transmet `redirectTo` au `MagicLinkForm` via input hidden. `requestMagicLinkAction` valide le path puis l'embarque en query string sur `emailRedirectTo` (Supabase le renvoie tel quel dans l'email). `/auth/callback` lit `?redirectTo`, délègue à un nouveau helper `canonicalPostLoginUrlWithRedirect` (rôle dicte le host, path validé sinon fallback canonique). Le callback supporte les 2 formats (`?code=` PKCE et `?token_hash=&type=` OTP). Validation defense-in-depth côté action ET côté callback (un email forgé `?redirectTo=//evil.com` retombe sur le path canonique). Clôt la dette flaggée par TA dans le rapport du commit `8cb6114`.

### Chantier logo SVG vectoriel + emails (TB)

- **Refactor logo SVG vectoriel** (commit `51d409b`) : `components/ui/logo.tsx` étendu avec 3 variants (`full` / `icon` / `mono`) + 4 sizes (`sm` / `md` / `lg` / `xl` ajouté plus tard via `e523357`). Ancien `Logo_TerrOir_transparent.png` retiré, remplacé par `Logo_TerrOir.svg`. `next.config.js` ajusté pour servir le SVG.
- **Itérations layout SVG (3 fixes successifs)** :
  - `0fd3f54` `fix(logo): tighten viewBox` — réduction du whitespace causant un render oversized.
  - `cb3ebab` `fix(logo): use size=md for navbar contexts` — corrige la hauteur en `h-16`.
  - `71905d2` `refactor(logo): use cropped SVG from Inkscape` — fix définitif après que les 3 itérations précédentes n'ont pas convergé. Pattern : modifier l'asset source (Inkscape resize-to-drawing) plutôt que de continuer à patcher le composant. Voir `LESSONS.md` section « Assets vectoriels ».
- **Navbar consumer agrandie** (commit `e523357`) : `Logo` size `xl` (64px) ajouté + `navbar-public.tsx` passe de `h-16` à `h-20` pour brand presence renforcée. Autres navbars (pro mini-header, sidebar producer, footer, admin) inchangées.
- **Logo dans header emails Resend** (commit `67e40fc`) : `lib/resend/templates/layout.tsx` étend le layout avec un header logo TerrOir sur fond crème (mockup visuel comparatif vert vs crème → choix crème pour cohérence brand). Asset PNG `public/email-assets/logo-email.png` généré via nouveau script `scripts/generate-email-logo.mjs` (les clients mail ne supportent pas SVG, d'où l'export PNG).

### Chantier vision funnel producteur Phase 1 + Phase 2 (TA + TC)

> Phase 1 = traçabilité origine lead. Phase 2 = friction publique réduite + wizard 2 étapes avec pré-remplissage. Phase 3 (DROP `prenom_affichage`, ~19 fichiers transversaux) reportée à une session dédiée.

#### Phase 1 — Traçabilité source des leads

- **Colonne `source` sur `producer_interests`** (commit `87bfff9` + migration `20260426000000`) : `source` ∈ (`formulaire_public`, `invitation_directe`). DEFAULT `formulaire_public` (backfill implicite — tous les leads existants viennent du formulaire public, seul point d'entrée jusqu'ici).
- **Création auto de lead sur invitation directe admin** (commit `9e78ea4`) : quand un admin invite un prospect dont l'email n'est pas en base, on insère désormais un lead `source='invitation_directe'` `statut='contacted'` après envoi email réussi. Pattern fail-open : un échec d'INSERT loggé `[LEAD_CREATE_WARN]` ne bloque pas l'invitation déjà partie. Garde anti-doublon via `maybeSingle` sur `ilike(email)` avant insert. L'onglet Leads devient le journal d'acquisition complet.

#### Phase 2 — Public form simplifié + wizard 2 étapes

- **Colonne `prenom` sur `producer_interests`** (commit `783e071` + migration `20260427000000`) : nullable (legacy leads gardent `prenom NULL`, admin UI gère gracefully). Permet de pré-remplir le wizard sans heuristique de split nom/prénom.
- **Formulaire public `/devenir-producteur` simplifié** (commit `a895ed2`) : split « Nom et prénom » en 2 inputs `prenom` + `nom`. Drop required « Espèces élevées » (signal non qualifiant à ce stade — `type_production` capturé dans le wizard). `LeadsTable` admin rend le full name graceful (`${prenom ?? ''} ${nom}`.trim()). Route invite admin accepte `prenom` optionnel et le propage au lead `invitation_directe`.
- **Wizard onboarding redesigné en 2 étapes** (commit `49b45d8`) : `StepPersonnel` fusionné dans `StepEntreprise` (renommage déféré, cf `TODO.md`). Wizard passe de 3 à 2 étapes (Compte / Profil). Nouveau helper `lib/producers/pick-initial-infos.ts` qui merge 3 sources par priorité (producer draft > user > lead). `'À compléter'` traité comme empty pour ne pas leak dans les inputs pré-remplis. `/invitation` et `/onboarding` fetch désormais le lead matching (statut `contacted` ou `onboarded`, ilike email, plus récent) et passent les infos mergées au wizard. `complete-onboarding` valide les 3 perso fields, écrit `users` AVANT `producers` (partial failure laisse le draft retryable plutôt que half-committed). 7 tests vitest sur `pick-initial-infos`.

### Chantier audit auto-promotion (TC)

- **`promoteProducerToPublicIfActive` vérifie les 3 conditions cumulatives** (commit `4911401`) : avant le fix, seule la garde `statut='active'` côté UPDATE était checkée — un producer pouvait apparaître sur `/producteurs` et la carte sans Stripe Connect prêt ou sans aucun créneau, laissant le consumer cliquer sur une fiche impossible à commander. Désormais 3 pré-checks cumulatifs avant la transition `active → public` :
  1. `producer.statut === 'active'` ET `stripe_charges_enabled === true`
  2. ≥ 1 produit avec `active = true`
  3. ≥ 1 slot avec `active = true` ET `excluded_at IS NULL` (symétrique au filter consumer dans `create_order_with_items`)
  Si une condition manque, no-op silencieux (fail-open préservé). Garde finale `.eq('statut','active')` conservée pour idempotence (race condition). Aucune dépublication automatique : `public → active` reste hors-scope (cf `suspendProducer` / `reactivateProducer`). Tests vitest étendus à 21 cas (vs 10 avant) couvrant le cas nominal, 5 chemins no-op et fail-open sur chaque étape DB.

### Chantier purge panier logout (TA)

- **Cart state cleared on logout** (commit `a08a56e`) : `lib/auth/use-logout-flow.ts` purge désormais le state panier au logout pour éviter la fuite entre sessions sur même device (un user A se déconnecte → user B se connecte → panier de A persiste en local storage). Bug observé en pré-prod par Romain.

### Configurations externes (Supabase Dashboard)

> Modifications côté Dashboard non reflétées dans le code mais critiques pour le go-live. À reproduire en cas de migration provider / nouvel environnement.

- **5 templates Auth Email customisés** : Magic Link, Confirm Signup, Reset Password, Change Email, Invite User. Header logo TerrOir, fond crème cohérent avec emails Resend. Détail des href par template à confirmer via Dashboard (cf `HANDOFF.md` section Configurations externes critiques).
- **Migrations `20260426000000` + `20260427000000`** apply prod via Supabase Studio SQL Editor.

### Bug magic link PKCE — RÉSOLU (Option B retenue)

- **🟢 Magic link bascule au flow OTP `token_hash` + cookie deep-link** (commit `09c219d`) : le bug PKCE `code+challenge+does+not+match` est désormais résolu. Diagnostic : le cookie `code_verifier` posé par `signInWithOtp` sur l'host de la Server Action n'était pas accessible au callback dans le cas critique admin loggé via `www.*` puis redirigé sur `admin.*` (cookie name distinct, isolation Chantier 4). **Décision** : abandon du flow PKCE pour le magic link au profit du flow OTP `token_hash` (`verifyOtp` côté callback, sans cookie verifier nécessaire). Le `redirectTo` deep-link, qui transitait jusqu'ici en query string sur `emailRedirectTo` (et causait le bug `Missing+code+or+token_hash` documenté), est maintenant **persisté dans un cookie HttpOnly `terroir_post_login_redirect` sur `.terroir-local.fr`** (cross-subdomain) au moment du form submit, lu et expiré par `/auth/callback` après `verifyOtp`. Helper isolé `lib/auth/redirect-cookie.ts` + 173 lignes de tests vitest. Plan d'investigation initial (`TODO.md` 🔴) devenu obsolète. ⚠️ **Action Romain** : modifier le template Supabase Magic Link en `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=magiclink` (le `RedirectTo` inclut déjà `/auth/callback`, ne pas le rajouter). Workarounds UX (commits `92bbff7` + `6c2b5ef`) conservés comme filet de sécurité pour les autres causes possibles (lien expiré, lien invalide).

### Suite de session marathon — post-MAJ doc `4a724af`

> 16 commits supplémentaires après la MAJ doc intermédiaire `4a724af`. Couverture : reset password page dédiée, Phase 3 sous-chantier reads, rattrapage 4 dettes techniques, rename `StepEntreprise → StepInfos`, doc race condition, remember email, **PKCE Option B** (résolution bug magic link), fix navbar SSR-aware, **audit logs auth events** + migration `audit_logs`, gitignore tsbuildinfo.

#### Reset password — page dédiée (TA)

- **`/reinitialiser-mot-de-passe` avec form « nouveau mot de passe »** (commit `5ff9394`) : flow étape 2 du reset password désormais explicite. Server action groupée `verifyOtp` + `updateUser` pour conserver les cookies de session (impossible depuis un Server Component). `/mot-de-passe-oublie` pointe désormais `redirectTo` vers la nouvelle page. Composant `ResetPasswordForm` côté client. ⚠️ Action Romain : mettre à jour le template Supabase « Reset Password » pour utiliser `${SITE_URL}/reinitialiser-mot-de-passe?token_hash={{ .TokenHash }}&type=recovery` au lieu de `{{ .ConfirmationURL }}`. Le retrait de la page legacy `/reset-password` est listé en dette ~1 semaine post-deploy (cf `TODO.md`).

#### Phase 3 vision funnel — sous-chantier reads (TB)

- **Helper `getProducerDisplayName` + lectures migrées vers `users.prenom`** (commits `894fa5e` helper + `1110816` lectures) : toutes les lectures publiques + pré-fill wizard passent désormais par `getProducerDisplayName(producer)` qui résout `users.prenom` (priorité haute) puis fallback `producer.prenom_affichage`. `fetch-public` joint `users(prenom)` via la FK `user_id`. 11 fichiers updated (`fetch-public.ts`, `pick-initial-infos.ts`, page produit consumer, wizard, onboarding, complete-onboarding, create-account, login-and-upgrade, invitation page, seed-producers). Tests refresh sur `fetch-public` et `pick-initial-infos`. Les **écritures** restent conservées avec TODO Phase 3 finale (DROP COLUMN prévu chantier suivant). Code mort résiduel à purger ~1-2 semaines plus tard.

#### Rattrapage dettes techniques (TA + TC)

- **Tests redirect helpers** (commit `3b29c34`) : 18 tests vitest sur `isValidRedirectPath` (10 cas : paths locaux valides, undefined, null, vide, open-redirect `//evil`, `/\evil`, URL absolue, `javascript:` XSS, sans `/` initial) + `resolvePostLoginPath` (8 cas : respect `redirectTo` valide, fallback canonique par rôle consumer/admin/producer public/draft, ignorance d'un `redirectTo` open-redirect). Vitest passe de 130 à 148 tests verts. Clôt la dette flaggée 26/04 sur la sécurité anti-open-redirect.
- **UI source col `/producer-interests`** (commit `e5c4234`) : badge vert « Public » / orange « Invité » à côté du nom de chaque lead pour distinguer `formulaire_public` vs `invitation_directe`. Composant `LeadSourceBadge` réutilise `StatusDotBadge` (Phase B1 consolidation admin). Type `Lead` enrichi avec `LeadSource`. Voir aussi note d'incident traçabilité commit `894fa5e` ci-dessus.
- **Messages erreur callback user-friendly** (commit `92bbff7`) : quand `/auth/callback` échoue (PKCE mismatch, lien expiré, lien invalide), l'user atterrissait jusqu'ici sur `/connexion?error=auth_callback&reason=…` avec une `reason` technique brute. Mapping désormais par substring lowercase (robuste aux variations exactes : URL-encoding, slice à 120 chars, libellés Supabase upstream qui bougent) → messages français digestibles dans une alerte rouge en haut du form password : `challenge / pkce → 'Ce lien a expiré ou n'est plus valide.'`, `expired → 'Ce lien a expiré.'`, `missing code / token_hash → 'Ce lien n'est pas valide.'`, fallback générique pour les reasons non-matchées.
- **Bouton « Demander un nouveau lien magique »** (commit `6c2b5ef`) : suite à l'erreur callback affichée dans une alerte (commit `92bbff7`), bouton inline qui bascule le form en mode magic link (réutilise `onSwitchToMagic` déjà câblé). L'user retape son email manuellement (pas de pré-remplissage : l'email ne transite pas dans la query string d'erreur, pas de PII exposée). Le bouton existant « Se connecter par email » en bas du form reste disponible.

#### Cosmétique + UX

- **Rename `StepEntreprise.tsx → StepInfos.tsx`** (commit `acc080b`) : depuis la fusion `StepPersonnel` + `StepEntreprise` (commit `49b45d8`), le composant gère désormais perso ET entreprise. Le nom n'était plus aligné. Renommage cosmétique trivial déféré pour ne pas mélanger refactor et delivery dans le commit `49b45d8`.
- **Remember email opt-in checkbox** (commit `71172e1`) : checkbox « Se souvenir de mon email » sur `/connexion`. Stockage local via nouveau helper `lib/storage/local-preferences.ts`. Cocher → pré-remplit l'email au prochain visit. Décocher → purge la valeur stockée. Pattern opt-in explicite (pas par défaut), aligné RGPD.

#### Doc + git hygiene

- **Doc race condition incident commit `894fa5e`** (commit `fa7cbbd`) : `LESSONS.md` étendu avec nouvelle sous-section « Working tree partagé — race condition message/diff incohérent (26/04) » qui complète la règle `11b914e`. Pattern préventif : `git diff --cached --name-only` avant chaque commit pour valider mécaniquement la liste des fichiers stagés vs le scope attendu. `CHANGELOG.md` annoté de la note d'incident traçabilité.
- **`.gitignore` `tsconfig.tsbuildinfo`** (commit `229c0ec`) : fichier `tsconfig.tsbuildinfo` (incremental build cache TypeScript) ignoré + retiré du tracking. Évite le diff parasite à chaque `tsc`.

#### PKCE Option B — résolution bug magic link

- **Bascule au flow OTP `token_hash` + cookie deep-link cross-subdomain** (commit `09c219d`) : voir section « Bug magic link PKCE — RÉSOLU » ci-dessus pour le détail.

#### Navbar SSR-aware (TA)

- **Fix flash CTA disparition au hard refresh** (commit `209ce83`) : sur hard refresh d'un visiteur anonyme, les boutons « Connexion » + « S'inscrire » disparaissaient de `NavbarPublic` pendant la fenêtre `loading=true` du `UserProvider` (le temps que `supabase.auth.getSession()` résolve). Un placeholder vide `<div h-8 w-24 />` était rendu à la place de la zone CTA → capture utilisateur tombait pendant ce flash. **Fix immédiat** : retirer le branch `loading ?` du rendu et tomber directement sur `user ? userView : ctaView`. État initial du provider = `user=null` → CTAs visibles dès le SSR. Trade-off : court flash CTA → user pour un user déjà loggé au hard refresh, acceptable vs. invisible CTA pour un visiteur anonyme (cas majoritaire bloquant pour l'acquisition).
- **Robust fix : `initialUser` passé du root layout au `UserProvider`** (commit `6a9ebd3`) : élimine totalement le flash. `app/layout.tsx` devient async, lit la session via `createSupabaseServerClient().auth.getUser()` et passe `initialUser` au `UserProvider`. Le provider initialise `user=initialUser` dès le SSR et supprime l'appel `getSession()` redondant — `onAuthStateChange` émet `INITIAL_SESSION` sur abonnement, ce qui couvre la résolution initiale + tous les changements ultérieurs. Comportement anonyme inchangé (`initialUser=null`, `loading=false` dès le mount). `loading` reflète désormais le chargement du profile (roles/admin/producer) côté client : `true` si SSR a fourni un user (`ProducerLayout` garde son placeholder « — »), `false` sinon. Dette résiduelle non bloquante : enrichir `initialUser` avec `isAdmin` SSR pour éviter le bref flash sans badge Admin (cf `TODO.md`).

#### Audit logs forensiques — Phase 1 auth (TA)

- **Helper `log-auth-event` + migration `audit_logs`** (commit `a36fcaa` + migration `20260427100000`) : trace forensique des events sensibles (RGPD art. 32, PCI DSS 10.x). Phase 1 : auth uniquement. Migration `audit_logs` append-only avec RLS admin-only en lecture, écriture exclusive `service_role`. Helper `lib/audit-logs/log-auth-event.ts` fail-safe (try/catch silencieux, jamais re-throw — un échec d'audit ne casse jamais le flow métier) avec auto-extraction IP/UA via `next/headers()`. 11 tests vitest couvrent : insert nominal, `userId` null, fallback IP/UA, error Supabase swallow, throw admin client swallow.
- **5 call sites instrumentés** (commit `acd8c03`) :
  1. `account_login_password` — `loginAction`, post-`signInWithPassword` success.
  2. `account_login_magic_link` — `requestMagicLinkAction`, après tentative envoi (loggué systématiquement pour préserver enumeration-resistance, metadata.email + isAdmin en clair côté DB).
  3. `password_reset_request` — nouvelle `requestPasswordResetAction` server (refactor depuis client : audit fiable + `redirectTo` serveur depuis `headers()`). Page `/mot-de-passe-oublie` bascule vers la nouvelle server action.
  4. `password_changed` — `updatePasswordAction`, post-`updateUser` success.
  5. `account_logout` — `logoutAction`, `userId` capturé AVANT `signOut` sinon perdu.
  - **Décision technique** : `await` (vs fire-and-forget) en server action pour ne pas perdre d'events si le process Next.js termine avant la Promise. Coût : ~10-50ms latence ajoutée, accepté comme prix de la fiabilité forensique.
  - **Pas encore couverts** : signup, email_change, account_deletion, admin_login, role_change, Stripe events. Cf `TODO.md`.
  - ⚠️ **Action Romain** : appliquer la migration `20260427100000_create_audit_logs.sql` en prod via Supabase Studio SQL Editor avant que les call sites loguent (sinon erreurs DB silencieuses).

### Leçons consolidées

- **Itérations CSS qui ne convergent pas → modifier l'asset source.** 3 fixes layout SVG (`0fd3f54`, `cb3ebab`) ont jonglé entre `viewBox`, `size` et hauteurs avant que le 4ᵉ (`71905d2`) ne reparte de l'asset Inkscape (resize-to-drawing). Pattern retenu : **après 2 itérations infructueuses sur un layout SVG, suspecter le whitespace de l'asset plutôt que continuer à patcher le composant.** Voir `LESSONS.md` section « Assets vectoriels ».
- **Découpage gros chantier en phases bornées.** Vision funnel producteur scopé à 3 phases (24/04). Phase 1 + 2 livrées en cohésion forte. Phase 3 finale (DROP `prenom_affichage`) reportée mais sous-chantier `reads` livré post-marathon (commits `894fa5e` + `1110816`) en transition douce → toutes les lectures publiques migrées vers `users.prenom`, écritures laissées en place pour éviter une fenêtre rétro-incompat. Pattern méthodologique : décomposer une migration transversale en (1) ajout du nouveau read path, (2) bascule des lectures, (3) suppression des écritures + DROP COLUMN. Phases 1 et 2 du sous-chantier livrables séparément, phase 3 attend la fenêtre de rétro-compat.
- **Mockup visuel comparatif avant décision design.** Header email vert vs crème — comparaison côte à côte avant choix → décision rapide et défendable. Pattern à répliquer pour tout choix design hors-trivial.
- **Templates Supabase `{{ .RedirectTo }}?{{ .TokenHash }}` est brittle quand `emailRedirectTo` a déjà une query string.** Cf `LESSONS.md` section « Auth & sessions ». Pattern observé en debug du bug magic link consumer (URL `?Missing+code+or+token_hash`) : la double `?` casse `URLSearchParams`. Cf décision Option B retenue (commit `09c219d`).
- **Quand le flow PKCE casse en cross-context, basculer au flow OTP `token_hash` + persister le deep-link via cookie HttpOnly cross-subdomain.** Commit `09c219d`. Le cookie `code_verifier` PKCE n'est pas portable entre hosts qui utilisent des cookie names distincts (isolation Chantier 4) — `verifyOtp` n'a pas ce besoin de matching côté server. Voir `LESSONS.md` section « Auth & sessions ».
- **`initialUser` SSR passé au `UserProvider` élimine le flash hydration.** Commit `6a9ebd3`. Pattern : root layout async lit `getUser()` côté server, passe au provider qui s'initialise dès le SSR. `onAuthStateChange` émet `INITIAL_SESSION` sur abonnement, couvre la résolution initiale ET les changements ultérieurs sans appel `getSession()` redondant. Voir `LESSONS.md` section « Auth & sessions ».
- **Audit logging server-side : `await` (pas fire-and-forget).** Commits `a36fcaa` + `acd8c03`. Coût ~10-50ms accepté comme prix de la fiabilité forensique (RGPD art. 32, PCI DSS 10.x). Helper fail-safe (try/catch silencieux, jamais re-throw) pour ne JAMAIS casser le flow métier — un échec d'audit ne doit pas casser un login. Voir `LESSONS.md` section « Audit & forensique ».
- **Templates Supabase : copier-coller HTML complet par Claude.** Pattern méthodologique : ne jamais demander à un humain de « remplacer cette ligne dans le template Supabase » — fournir le HTML complet à coller. Sinon double `href` produit un bug 500 silencieux côté Supabase au moment de l'envoi (incident debug 26/04). Voir `LESSONS.md` section « Templates Supabase ».
- **`git diff --cached --name-only` avant chaque commit en multi-terminal.** Auto-validé en live sur le commit `fa7cbbd` (post-incident `894fa5e` race condition). Voir `LESSONS.md` section « Working tree partagé — race condition message/diff incohérent ».

## 2026-04-25

### Matinée

- **Hover trigger sur popover « Conseil éleveur » desktop** (commit `5dca301`) : `matchMedia('(hover: hover) and (pointer: fine)')` détecte les devices à pointeur fin et active l'open au hover sur l'icône. Tap mobile préservé via le même Popover Headless UI (Disclosure pattern). Cross-device propre, pas de duplication de markup.
- **Centralize fallback géoloc Le Mans** (commit `22bf88e`) : nouveau module `lib/geo/fallback.ts` exposant constante `GEOLOC_FALLBACK` (`{ lat: 48.0061, lng: 0.1996, label: 'Le Mans' }`) + helper `withGeolocFallback()`. 8 hardcodes Le Mans migrés sur 6 fichiers (carte, recherche producteurs, MiniMap, etc.). Permet de régionaliser le fallback en 1 endroit le moment venu.
- **Carte Mapbox — 4 fixes layout/canvas successifs** :
  - `c3d62ee` : conteneur flex avait `height: 0` (chaîne flex cassée) → forçage `min-height: 400px` sur le wrapper page `/carte`.
  - `83b5326` : `ResizeObserver` ajouté sur le conteneur ref → `map.resize()` au moindre changement de taille (canvas Mapbox restait à 0×0 quand le parent recevait sa hauteur après le mount initial).
  - `e03734e` : retrait de `bg-green-100/40` sur le wrapper direct du canvas — l'arrière-plan masquait le canvas (qui est en `position: absolute` selon mapbox-gl.css).
  - `3ea3555` : passage définitif à `h-full w-full` (au lieu de `absolute inset-0`) sur la div ref. Le CSS `mapbox-gl.css` applique `position: relative; height: 100%` sur `.mapboxgl-map` qui override l'`absolute inset-0` Tailwind par cascade order. Pattern stable retenu.
- **Découplage notifications webhook Stripe via `@vercel/functions waitUntil`** (commits `0761bbe` deps + `db63440` fix) : Resend (email confirmation) + Twilio (SMS) basculés en background via `waitUntil()`. Ack 200 immédiat à Stripe, l'intégrité DB reste synchrone (write order avant ack). Résout les 13% de timeout webhook observés sur le Dashboard Stripe (cf TODO 24/04). Next.js 14 ne dispose pas de `next/server after()` (Next 15+) — `@vercel/functions` est l'équivalent disponible aujourd'hui.
- **MiniMap Mapbox sur fiche produit** (commit `f3fb891`) : nouveau composant partagé `components/ui/mini-map.tsx`, props `{ lat, lng, label?, height? }`, fallback gracieux si coords absentes (encart `Coordonnées non disponibles` + lien vers la commune). Intégré sur la fiche produit (`/producteurs/[slug]/produits/[id]`) avec affichage du point de retrait à la ferme. Pattern Mapbox propre réutilisable (cascade hauteurs + ResizeObserver embarqués).

### Après-midi

- **Pages landing publiques `pro` + `admin` avec rewrites middleware** (commits `dcbc747` producer + `4b9f08d` admin + `ef6bfe4` middleware) : nouvelles pages `app/(public)/pro-accueil/page.tsx` et `app/(public)/admin-accueil/page.tsx` (chrome public, hero + value prop + CTA `/connexion`). Middleware rewrite `pro.terroir-local.fr/` → `/pro-accueil` et `admin.terroir-local.fr/` → `/admin-accueil` pour les visiteurs anonymes uniquement (sessions actives = redirect dashboard comme avant). Bonus 301 cross-subdomain pour les paths `/pro-accueil` ou `/admin-accueil` accédés depuis `www` → renvoie vers le bon sous-domaine.
- **Section « Stats publiques » sur la home consumer** (commits `2e63dc5` + `0caf4c2` itération seuils + `b07e8d8` revalidation cache) : nouveau composant `components/ui/public-stats.tsx` (Server Component) + helper `lib/stats/public-stats.ts` (counts producers `public` / orders `confirmed|ready|completed` / products `active` joined via inner join, cache `unstable_cache` 5 min, fail-open par count). Skip individuel par stat sous son seuil minimum (`PRODUCERS_THRESHOLD=5`, `PRODUCTS_THRESHOLD=10`, `ORDERS_THRESHOLD=15`) pour éviter l'effet « projet vide ». Skip global si toutes sous seuil. Eyebrow `EN CHIFFRES` (sans la marque pour ne pas casser l'identité du logo). Cache invalidé via `revalidateTag('public-stats')` dans le webhook Stripe sur événements `confirmed`.
- **Phase C.4 `SuccessConfirmation` clôturée définitivement (YAGNI confirmée)** (commit `ddb3a02`) : inspection post-skip a montré que `ConfirmationClient` (`app/(consumer)/compte/confirmation/[id]/ConfirmationClient.tsx`, 97 lignes) est déjà extrait dans son fichier dédié, à 1 seul call site, sans duplication ailleurs (grep checkmark + « Merci » : 0 hit similaire). Fragmenter en sous-composants (`SuccessHero`, `OrderRecap`, `PickupInfo`) créerait du churn pour 0 réutilisation. La consolidation admin Phases A+B+C1-C3 a couvert les composants à 2-11 call sites — C.4 était la fausse piste structurelle, pas la dernière dette à éponger. Pattern à valoriser : un terminal qui sait dire « ça vaut pas le coup, voici pourquoi » est plus utile qu'un exécutant aveugle. Item retiré de `TODO.md`.
- **Refactor markers carte WebGL** (commit `6db046c`) : retrait des markers SVG DOM (1 marker par producer = N nodes) → couche WebGL `circle` Mapbox unique alimentée par un GeoJSON `FeatureCollection`. Marker user repositionné en pulsing dot custom layer (animation requestAnimationFrame). Gain perf significatif sur la carte avec N producers ; fini la duplication SVG marker.
- **Carte producteurs — 3D pin images couleur terra** (commit `23d4fa0`) : remplacement de la couche `circle` flat par une couche `symbol` avec image pin 3D générée canvas 2D côté browser (`addImage` au load Mapbox). Gradient terra-300→500 + halo, hover terra-500→700, inner dot blanc, ombre portée. Légende `/carte` mise à jour (icône pin + libellé « Producteur »). Brand cohérent avec la palette TerrOir.
- **Hotfix carte — split hover state en 2 layers** (commit `11b914e`) : Mapbox refuse `feature-state` dans la propriété `icon-image` (layout). Fix : 2 layers `symbol` superposés — couche base affiche le pin terra par défaut, couche hover (filtre `['boolean', ['feature-state', 'hover'], false]`) affiche le pin hover par-dessus. **Incident parallélisation** : ce commit a embarqué par accident 3 renames du chantier connexion TA en cours via working tree partagé (`app/(public)/connexion/*` → `app/connexion/*`). Bisect-unfriendly (build Vercel ko sur ce commit isolément à cause des imports `@/app/(public)/connexion/...` périmés ailleurs), **mais HEAD master final fonctionne** (TA a fini son chantier au commit `2652e4d` et fixé les imports). Pattern documenté dans `LESSONS.md` section Parallélisation.
- **Helper pin image partagé** (commit `78e0306`) : extraction `lib/maps/pin-image.ts` avec generator canvas 2D paramétrique (couleur, taille, hover state). `/carte` et `components/ui/mini-map.tsx` consomment désormais le même pin 3D terra → cohérence brand cross-pages, fini la duplication du code canvas.
- **Couverture invalidation `public-stats` — 1ère vague** (commit `e16459d`) : invalidation `revalidateTag('public-stats')` ajoutée sur les transitions DB qui changent les counts visibles : order cancel + product toggle active/inactive + product edit (si toggle actif) + product create. Complète l'invalidation déjà posée sur webhook order `confirmed` (`b07e8d8`).
- **Centralisation invalidation `public-stats`** (commit `af44d64`) : helper `lib/stats/revalidate.ts` (présent depuis `b07e8d8`) consommé désormais dans `promoteProducerToPublicIfActive` avec `.select('id')` pour ne déclencher l'invalidation que sur transition effective `active → public`. 3 tests vitest ajoutés couvrant les 3 chemins (no-op si pas active, no-op si déjà public, invalide sur transition).
- **Invalidation `public-stats` sur suspend/reactivate producer** (commit `90bf3e3`) : actions admin `suspendProducer` + `reactivateProducer` déclenchent l'invalidation. La carte/home consumer reflète le changement de statut sans attendre l'expiration du cache 5 min.
- **Invalidation `public-stats` sur anonymisation RGPD producer** (commit `c0357f5`) : RPC `delete_user_account` côté producer → `revalidateTag('public-stats')` dans la server action. Couvre le dernier chemin de transition de count producers.
- **Layout `/connexion` adaptatif au sous-domaine** (commit `2652e4d`) : `app/connexion/layout.tsx` détecte le hostname via `headers().get('host')` et injecte le chrome correspondant (navbar/footer www, pro ou admin). Sortie de `/connexion` du route group `(public)` (renames `app/(public)/connexion/*` → `app/connexion/*`). **Bonus dette 1** : redirect post-login devient host-aware (helper extrait dans le commit suivant). **Bonus dette 2** : double `<main>` retiré (le layout consumer en injectait un, la page aussi).
- **Helper `lib/auth/post-login-redirect.ts`** (commit `797c89f`) : 3 niveaux d'API exposés — `loadRoleSnapshot()` lit le rôle de l'user juste après auth, `canonicalPostLoginUrl()` calcule l'URL cross-domain canonique selon rôle (admin → admin., producer → pro., consumer → www.), `localPostLoginPath()` calcule le path same-host quand on n'a pas besoin de cross-domain. `loginAction` refactorisée pour consommer le helper.
- **Magic link callback rôle-aware cross-domain** (commit `2e1a3e5`) : `app/auth/callback/route.ts` utilise un pattern cookie buffer (`cookiesToWrite[]` accumulé puis attaché à la response finale) pour pouvoir choisir la cible cross-domain APRÈS la résolution du rôle. Sans ce pattern, la response était créée upfront avec une URL cible figée, impossible de rediriger sur le bon sous-domaine pour les magic links admin.
- **Redirect immédiat des users déjà loggés sur `/connexion`** (commit `8cb6114`) : check session côté server component `/connexion` → si user déjà authentifié, redirect immédiat vers `canonicalPostLoginUrl(role)`. Évite l'écran de login inutile + boucle visuelle quand un user clique « Connexion » par habitude alors qu'il est déjà connecté. Dette flaggée : la querystring `?redirectTo` n'est pas encore lue par `loginAction` (à traiter dans une session ultérieure).

## 2026-04-24

- **Lien « Voir ma fiche publique » dans catalogue + édition producer** (commit `cfbabbe`) : lien header `target=_blank` à droite du « ← Retour au catalogue » sur la page d'édition produit. Icône ↗ discrète à droite de « Modifier → » sur chaque card du catalogue. Affichage conditionnel au `statut='public'` du producer (sinon la route consumer est en 404).
- **UI consumer : empêcher auto-achat sur son propre produit** (commit `67ed377`) : producer logué sur sa propre fiche produit → bouton « Ajouter au panier » désactivé avec label « Votre produit ». Détection via `useUserContext()` côté front. La RPC `create_order_with_items` reste le filet ultime.
- **Guard DB anti self-ordering dans RPC `create_order_with_items`** (commit `0e1c640`) : un producer connecté ne peut pas commander son propre produit. Bloc 2bis (P0001) : check `user_id` de `producers` vs `p_consumer_id`, raise avant verrou slot/products. Couche DB du triptyque défense en profondeur (UI + RPC). Reste du corps miroir exact de `20260423000000`.
- **Hotfix `prenom_affichage` INSERT initial** (commit `95d0572`, daté 23/04 21:22) : ajout `prenom_affichage: 'À compléter'` sur les 3 INSERT runtime de `producers` (`create-account.ts`, `login-and-upgrade.ts`, `invitation/page.tsx` SSR) + seed aligné sur `p.prenom`. Pattern cohérent avec `nom_exploitation`. La reprise d'onboarding traite `"À compléter"` comme vide pour ne pas pré-remplir le champ prénom. Débloque l'Étape 1 du wizard après apply de la migration C NOT NULL en prod.

## 2026-04-23 (session soir)

- **Post-it conseil éleveur côté consumer** (commit `07a65d4`) : affichage du conseil manuscrit signé du prénom du producteur sur la fiche produit (tooltip desktop + post-it mobile). Défense `prenom_affichage=null` (producer `deleted`).
- **`prenom_affichage` required + conseil editor producer** (commit `ffea6b2`) : champ `prenom_affichage` (1-50 char) ajouté à l'Étape 3 Entreprise du wizard + à la page édition `/onboarding`. Éditeur `conseil` (280 char) intégré sur chaque product côté producer. Migrations `20260423100000` (add column + conseil) → `20260423110000` (backfill depuis `users.prenom`) → `20260423120000` (set NOT NULL) appliquées prod OK.
- **Rotation clé API Resend** (ops) : clé Resend Full Access rotée, 2 endroits mis à jour en parallèle (Vercel `RESEND_API_KEY` + Supabase Dashboard > Auth > SMTP custom). Vérif post-rotation via test email invitation (Mailinator) + Reset Password (Zimbra). Pattern : toute rotation de cette clé = 2 endroits, sinon Supabase continue silencieusement avec la clé révoquée.
- **Audit migrations prod — 7 migrations vertes** (ops) : vérifiées appliquées via queries SQL déterministes.
  - `20260422200000_rgpd_account_deletion.sql`
  - `20260422300000_slot_rules_and_materialized_slots.sql`
  - `20260422300000_add_stripe_customer_id_to_users.sql`
  - `20260422400000_slots_adhoc_and_exceptions.sql`
  - `20260422500000` (capacity slots)
  - `20260422700000_rename_slots_actif_to_active.sql`
  - `20260423000000_rename_products_actif_to_active.sql`
- **Clôture docs session soir 23/04** (commit `5e1a48a`) : incident git embarqué — 3 migrations SQL TC (chantier conseil éleveur) incluses par accident via working tree partagé dans ce commit docs lors d'un merge parallel TB↔TC. Code final correct, historique git confus. Flag retenu pour `LESSONS.md` → règle `git add <fichier précis>` renforcée.
- **Robustesse flow Resend + invitation producer** (commit `ef7f10b`) : 5 fixes.
  1. `console.error("[EMAIL_SEND_FAIL] ...")` sur les 3 chemins d'échec de `sendTemplate` (render_failed, error||!data, catch). Préfixe grep-able dans les logs Vercel — toute erreur était auparavant silencieuse côté logs.
  2. `renderEmail` wrappé try/catch dédié avant l'envoi Resend.
  3. Appel `sendTemplate` côté `invite/route.tsx` wrappé try/catch ceinture+bretelles.
  4. Tokens (`randomBytes` + `generateOptOutToken`) déplacés AVANT l'INSERT `producer_invitations` (pattern tokens-avant-INSERT).
  5. Fallback silencieux `RESEND_FROM_EMAIL` retiré. Throw module-load dans `lib/resend/client.ts` + export `resendFromEmail` typé `string`.
  - Impact collatéral positif : 10 callers de `sendTemplate` bénéficient du logging grep-able sans modification.
- **Pages landing Stripe Connect onboarding** (commit `e93043e`) : `app/(producer)/connect/done/page.tsx` (banner succès + auto-redirect `/parametres` 3s) + `app/(producer)/connect/refresh/page.tsx` (bouton « Reprendre l'onboarding »). Débloque le flow onboarding producer Stripe en prod — sans ces landings, `return_url`/`refresh_url` tombaient sur des 404. Dette notée : webhook `account.updated` manquant (cf dettes HANDOFF + LESSONS Stripe).
- **Auto-bump lead `'contacted'` à l'envoi d'invitation admin** (commit `dbe6360`) : `INSERT` inconditionnel remplacé par `UPDATE` conditionnel gaté sur `emailResult.ok` dans `app/api/admin/producers/invite/route.tsx`. Match par email (case-insensitive) dans `producer_interests` en statut `'new'` → bump `'contacted'`. Silent no-op si pas de match (admin invite un prospect direct). Fix embarqué d'un bug latent pré-existant : l'INSERT créait un doublon `producer_interests` fantôme (nom=email) à chaque invitation admin si le lead existait déjà via formulaire public.

## 2026-04-23 (après-midi)

- **Edge case panier producer suspended/deleted/product/slot/stock** (commits `c6f0567` + `8d8878b`) :
  - Phase 1 endpoint `POST /api/cart/validate` : mapping per-item (`producer`/`product`/`slot`/`slot_full` fatal, `stock_insufficient` non-fatal avec `maxQuantite`, `ok`).
  - Phase 2 hook au load du panier : `removeItem` pour fatals, `updateQuantity` pour stock, banner `StaleItemsBanner` dismissable avec sessionStorage + hash re-flash.
  - Phase 3 re-validation au checkout avant `POST orders/create`, redirect vers `/compte/panier?stale=1` si stale détecté.
  - Défense en profondeur 3 couches : cart load + checkout + RPC `create_order_with_items`.
- **Fix bug logout admin** (commit `f681300`) : `AdminHeader` déclenchait uniquement la server action `logoutAction` → client Supabase browser gardait session en mémoire → `AdminHeader` affichait l'email après déconnexion jusqu'au hard reload. Fix : pattern double `signOut` (client + server) aligné sur `navbar-public.tsx`.
- **Tests vitest étendus** (commits `7904ae9` + `9c3cf0c` + `44c108b`) : +50 tests unitaires sur helpers critiques, zéro modification du code source. `opt-out-token` HMAC (14), `cookie-domain` (17), `date` + `currency` formatters (19). Total : **77 tests green** (vs 27 avant).
- **Custom SMTP Resend configuré** (ops) : `smtp.resend.com:465`, username=`resend`, password=Resend API Key Full Access, sender=`no-reply@terroir-local.fr`. Remplace le built-in Supabase SMTP (rate limit ~3-4/h, non prod).
- **Fix template Magic Link + Recovery** (ops Supabase Dashboard) : remplacer `{{ .SiteURL }}` par `{{ .RedirectTo }}` dans les 2 templates + `&type=` hardcodé. Corrige le routing admin → www reporté le matin.
- **Fix SPF pour emails Resend vers `@terroir-local.fr`** (ops OVH Zone DNS) : ajouter `include:amazonses.com` dans le SPF du domaine. Emails Resend `From:@terroir-local.fr` vers `admin@terroir-local.fr` étaient rejetés par le MX OVH (anti-usurpation interne). SPF final : `v=spf1 include:mx.ovh.com include:amazonses.com ~all`.

## 2026-04-23 (matin)

- **Rename `products.actif → products.active`** (commits `47df4e8` + `9176cc8` + migration `20260423000000_rename_products_actif_to_active.sql` apply) : rename colonne + index `products_actif_idx → products_active_idx` + recreate RLS policy + recreate 2 RPCs (`search_producers`, `create_order_with_items`). Backend + scripts seed : 2 fichiers. Frontend : 12 remplacements sur 6 fichiers. Strings UI FR préservées. **Chantier rename actif → active COMPLET** (slots la veille + products aujourd'hui) — schéma principal 100% en anglais pour les booléens techniques.
- **Phase 7 Créneaux COMPLÈTE** (commits `ffa0967` + `fca4871`) : seed enrichi `slot_rules` sur 5 producers (idempotent). Tests auto vitest : 27 tests (`generate`, `format-slot-time`, `validators`), couverture DST Europe/Paris. **Chantier Créneaux personnalisables 100% CLOS** — Phases 1→7 + Phase 2bis ponctuels/exceptions en prod.
- **Fix CB dupliquée via fingerprint Stripe** (commit `af7d1bb`) : nouvelle server action `validateAndKeepPaymentMethodAction`, dedupe fingerprint côté `AddCardModal` + `/api/stripe/ensure-default-payment-method` (couvre flow checkout). Skip si fingerprint null (défense marques exotiques).
- **Formulaire standalone opt-out V2** (commit `0851924`) : `/desabonnement` sans token affiche un formulaire email pour renvoyer le lien de désabonnement. Server action enumeration-resistant. Email Resend avec token HMAC (même logique). **Chantier RGPD opt-out COMPLET**.
- **Consolidation admin — Phases B2 + B3 + B4** (commits `eaed1a2` + `5b63283` + `2960b18`) :
  - **B2 `AdminModal`** : 3 modals unifiés (`ConfirmValidateModal`, `InviteModal`, `DeleteLeadModal`), close X + Escape hérités.
  - **B3 `FilterTabs`** : 2 pages migrées (`gestion-producteurs`, `producer-interests`).
  - **B4 `AdminPageHeader`** : 4 pages migrées avec prop `error?` en bonus.
- **Phase C.3 `TableActionButton` consolidation admin** (commit `df3840a`) : 4 variants, 2 sizes, support `href`. 11 boutons migrés sur 3 pages. Phase C.4 skippée (1 seul call site).
- **Consolidation admin 100% COMPLÈTE** (Phases A + B1-B5 + C1-C3) : 10 composants partagés (`formatDateFr`, `formatEuro`, `StatusDotBadge`, `ProducerStatusBadge`, `AdminModal`, `FilterTabs`, `AdminPageHeader`, `TableStatus`, `StatusPanel`, `MetricCard`, `TableActionButton`).
- **`METHODOLOGY.md` + `HANDOFF.md` créés** (commit `dd12386`) : doc méthodologie + snapshot reproductible pour Claude frais.

## Nuit 22 → 23/04/2026

- **Fix bug latent `'draft'` statut gestion-producteurs** (commit `e6dc1e3`) : défense en profondeur `STATUS_META`, palette slate neutre. Convention : toute valeur DB possible doit avoir une entrée, même si filtrée au fetch.
- **Page admin "Leads producteurs"** (commit `a8ef04a`) : `/producer-interests` tabs + table actions. Migration RLS DELETE admin apply prod. Lien « Inviter » pré-remplit `InviteModal`. Bonus embarqué (merge parallèle TA/TC) : toggle `showAll` `/gestion-producteurs` — logique TC livrée sous message TA, état code correct mais historique git confus (cf LESSONS parallélisation).
- **Helper centralisé `fetchPublicProducerBySlug`** (commit `7f9540a`) : `lib/producers/fetch-public.ts` — lookup par slug + filter `statut='public'` + `deleted_at IS NULL`, 21 champs typés. 2 pages publiques migrées. 11 lignes de duplication supprimées.
- **Rename `slots.actif → slots.active`** (commit `726bbe5` + migration `20260422700000`) : rename column + RPC updated. 5 fichiers backend. Frontend no-op.
- **Refactor consolidation formatters slots** (commit `de40458`) : `formatLegacyTimeRange` supprimé (structurellement dead). 6 helpers → 5, −10 lignes nettes.
- **Consolidation admin — Phase A formatters** (commit `31670a2`) : `lib/format/date.ts` (`formatDateFr`) + `lib/format/currency.ts` (`formatEuro`). 3 pages admin migrées. −43 lignes de duplication.

## 2026-04-22

### Chantier 2 — Flux invitation producteur ✅ CLÔTURÉ (6 phases en prod)

- **Phase 1** : statuts `draft` + `public` ajoutés en DB (migration `20260421300000`).
- **Phase 2** : blocages admin invitation (admin + producteur déjà inscrit) — commits `2f7b8e4` + `8a33027`.
- **Phase 3** : formulaire onboarding 3 étapes + upgrade consumer → producer — commits `b776421` + `23a2b31` + `52d8e4e` + `4268b20` + migration `20260421400000`.
- **Phase 4** : reprise d'onboarding (redirect middleware vers le bon step si `statut='draft'`) — commit `285785d`.
- **Phase 5** : bouton « Valider » admin (`pending` → `active`) + modal + `STATUS_META` final — commit `9ed234e`.
- **Phase 6** : auto-transition `active` → `public` au 1er produit publié + filtrage RPC/RLS publiques — commits `e885439` + `e13c744` + migrations `20260422000000` + `20260422100000`.

### Chantier 4 — Isolation cookies admin vs www/pro (commit `1d83f5d`)

- Helper `lib/supabase/cookie-domain.ts` avec `cookieConfigForHost()`. Admin : cookie `sb-admin-auth-token`, pas de domain → isolé. www/pro : cookie `sb-*-auth-token`, domain `.terroir-local.fr` → partagé. 3 tests prod validés.

### Chantier 5 — Middleware simplifié (commit `a050c80`)

- Retrait du redirect `/compte` → `pro.*` pour les producers. Un user `consumer+producer` accède librement à `/compte` sur www et au dashboard producteur sur pro.

### Chantier 6 — Switcher consumer/producer (commit `442840b`)

- Composant `components/ui/role-switcher.tsx` variants `light`/`dark`. Affiché si `roles` inclut `'consumer'` ET `'producer'`. Injecté dans Sidebar consumer + `ProducerLayout`.

### RGPD — Suppression de compte

- Migration `20260422200000_rgpd_account_deletion.sql` : statut `'deleted'`, colonnes audit, RPC `delete_user_account()`. Server action + UI `/compte/profil` (commits `d9ce0e8` + `fb64675` + `29fa064`). Tests prod : cas A (hard delete sans orders) + cas C (cascade consumer+producer) validés.

### Fix home admin (commit `581475e`)

- `admin.terroir-local.fr/` → redirect middleware selon session. Logique placée dans middleware (impossibilité Next.js d'avoir `(admin)/page.tsx` et `(public)/page.tsx` au même path).

### Chantier F — Mot de passe oublié (commit `c92b548`)

- Page `/mot-de-passe-oublie` enumeration-resistant + lien sur `/connexion`. Template Supabase Reset Password corrigé (`&type=recovery&` hardcodé). `redirectTo` dynamique via `window.location.origin`. Bonus : fix lien mort `/producteur/inscription`.

### Sidebar producteur — nom réel (commit `a029116`)

- Remplacement placeholder "Ferme des Chênes" par `producer.nom_exploitation` via `useUserContext`. Lien "Voir ma page publique" conditionnel sur `statut='public'`.

### Storage — RLS policies uploads photos (commit `e13c744`)

- Policies INSERT/UPDATE/DELETE sur `storage.objects` pour `product-photos` + `producer-photos`. Vérif `owns_producer(producer_id)` extrait du path.

### Chantier Créneaux personnalisables — Phases 1-6 + 2bis

- **Phase 1** (commit `abd0ec1` + migration `20260422300000_slot_rules_and_materialized_slots.sql`) : schema `slot_rules` + refonte `slots` en instances matérialisées, RLS.
- **Phase 3** (commits `2616cf3` + `21f8c68`) : générateur `lib/slots/generate.ts` tz-aware Europe/Paris (`@date-fns/tz`), UPSERT idempotent.
- **Phase 4** (commit `ba8e6be`) : UI producer `/creneaux` — CRUD slot_rules, multi-select jours, périodicité 1-4 sem, live preview.
- **Phase 5** (commit `e09755f`) : UI consumer accordéon par date.
- **Phase 6** (commit `4675e20` + migration `20260422500000`) : RPC `create_order_with_items` étendue — `capacity_per_slot` + `FOR UPDATE` sur le row slot (anti race condition overbooking).
- **Phase 2bis — Créneaux ponctuels + exceptions** (backend `f63cc19` + UI `dae474a` + migration `20260422400000`) : `slots.rule_id` nullable + `slots.excluded_at`. 5 server actions. UI /creneaux en 3 sections. Fix UX `040a209`.
- **Horizon génération : 4 semaines → 3 mois** (commit `493684e`).

### Chantier Stripe Customer MVP ✅ COMPLET (Phases 1-7)

- **Phase 1** (commit `546fc5e` + migration `20260422300000_add_stripe_customer_id_to_users.sql`) : colonne `users.stripe_customer_id`.
- **Phase 2** (commit `7992727`) : helpers `getOrCreateStripeCustomer()` / `deleteStripeCustomer()`, lazy creation.
- **Phase 3** (commit `a4b6509`) : purge RGPD Stripe Customer dans `delete-account-action.ts`.
- **Phase 4** : page `/compte/paiements` — liste cartes, ajout via SetupIntent + Payment Element, suppression, switch default (commits `2e35f14` + `d338e48` + `fe683ba`).
- **Phase 5** (commit `922de5c`) : lien Sidebar + card dashboard activée.
- **Phase 6** (commit `a7eed72` + `8dce6c1`) : attach customer + checkbox `Mémoriser cette carte` (RGPD) + `setup_future_usage` + endpoint `/api/stripe/ensure-default-payment-method` fail-open.
- **Phase 7** (commit `f2fee74`) : sélecteur CB enregistrée vs nouvelle au checkout, mode saved 1-click.

### Désactivation Stripe Link (commit `f367338`)

- `payment_method_types: ['card']` + `wallets: { applePay: 'never', googlePay: 'never' }`. Link peut persister via override Dashboard.

### Divers fix 22/04

- Fix lien mort `/inscription` → `/auth/inscription` dans NavbarPublic (commit `67f2799`).
- Fix force-dynamic pages consumer (commit `983ed8e`) : `/producteurs/[slug]` et `/produits/[id]` en `force-dynamic`.
- Icône panier navbar + badge (commit `734d20d`) : `ShoppingBagIcon`, badge rouge count, pattern `mounted` anti-hydration.
- Cleanup middleware `/inscription` orpheline (commit `8d4eb27`).
- Refonte `scripts/seed.ts` (commit `379bdbe`) : nouveau modèle `slot_rules` + colonnes récentes, `statut='public'` en dur.

### Qualité & cleanup

- Consolidation type `UserRole` (commit `87371a4`) : suppression re-export mort.
- Helper promote-to-public : `console.error` → `console.warn` + préfixe `[PROMOTE_PRODUCER_WARN]` (commit `653c756`).
- Suppression `/api/stripe/payouts` orphelin (commit `8dcfd19`).

## 2026-04-21

- **Domaine `terroir-local.fr` branché** (Vercel + OVH). Sous-domaines `www` / `pro` / `admin` en Valid Configuration. Zone DNS OVH nettoyée. Rename `terroir.fr` → `terroir-local.fr` (commit `444b2cb`).
- **Env vars Vercel à jour** : `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_PRODUCER_URL`, `RESEND_FROM_EMAIL`.
- **Resend vérifié pour `terroir-local.fr`** : DKIM + SPF + MX + DMARC.
- **Nettoyage `STRIPE_CONNECT_CLIENT_ID`** (code mort).
- **Nettoyage Redirect URLs Supabase Auth** (suppression `terroir.fr`).
- **Boîte email `admin@terroir-local.fr`** créée (Zimbra/OVH).
- **Template Supabase Magic Link fixé** (`type=magiclink` en dur, `{{ .TokenHash }}` validé).
- **Route `/auth/callback`** + page `/reset-password` (commit `49265bc`).
- **Site URL Supabase corrigée** (`www.terroir-local.fr`).
- **Chantier 1 (refactor rôles) déployé en prod** : migration `20260421100000_cumulative_roles_admin_users.sql` — table `public.admin_users`, `users.roles text[]`, triggers d'exclusion mutuelle, fonction `is_admin()`.
- **Fix GRANT `supabase_auth_admin`** : migration `20260421200000_grant_auth_admin_on_public.sql` (USAGE schema + ALL PRIVILEGES `public.*`).
- **Fix tokens auth NULL → ''** : users créés par INSERT SQL direct dans `auth.users` doivent avoir les 8 colonnes token en string vide.
- **Compte admin créé** : `admin@terroir-local.fr` (id `478d643a-9d2a-485d-aedf-438ca2eda246`).
- **Soirée auth/UX** (commits `a9792f9` → `0aa2555`) : redirect post-login simplifié, header connecté avec icône + prénom + badge Admin, page `/compte/password`, bouton Déconnexion, layout `/compte` + layout admin dédié (light/corporate).
- **Résilience client Supabase** : `createSupabaseBrowserClient` singleton, `.catch` sur `getSession()`, double `signOut` logout.
- **Reskin admin light theme** (commit `a6f2c92`) : 3 pages admin unwrappées d'`AdminLayout`.
- **Padding admin content area** (commit `ae5c8f0`).
- **Seed 5 producteurs Sarthe fictifs** (commits `f4be9ca` + `91559cb`) : photos Unsplash. Scripts `scripts/seed-producers.ts` + `scripts/cleanup-seed.ts`.
