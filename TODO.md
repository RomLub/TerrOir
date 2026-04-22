# TODO TerrOir

## ✅ Fait (session 22/04/2026)

### Chantier 2 — Flux invitation producteur ✅ CLÔTURÉ (les 6 phases en prod)

- Phase 4 ✅ reprise d'onboarding (commit `285785d`) — test cas étape 2 validé en prod
- Phase 5 ✅ bouton Valider admin + `STATUS_META` final (commit `9ed234e`) — modal de validation, mapping couleurs `pending`/`active`/`public`
- Phase 6 ✅ auto-transition `active` → `public` au 1er produit + filtrage RPC/RLS publiques sur `statut='public'` (commits `e885439` + `e13c744` pour storage policies + migrations `20260422000000` + `20260422100000`)
- Clôture du tracking Chantier 2 dans TODO (commit `cb61da8`)

### Chantier 4 — Isolation cookies admin vs www/pro (commit `1d83f5d`)

- Helper `lib/supabase/cookie-domain.ts` avec `cookieConfigForHost()`
- Admin : cookie `sb-admin-auth-token`, pas de domain → isolé
- www/pro : cookie `sb-*-auth-token` par défaut, domain `.terroir-local.fr` → partagé
- Wipe sessions + refresh_tokens post-deploy
- 3 tests validés en prod : admin → www/pro isolés, www → admin isolés, www ↔ pro partagés

### Chantier 5 — Middleware simplifié (commit `a050c80`)

- Retrait du redirect `/compte` → `pro.*` pour les producers
- Un user `consumer+producer` accède désormais librement à `/compte` sur www, et au dashboard producteur sur pro
- Check admin inchangé (via `admin_users`, Chantier 1 déjà en prod)
- 3 tests validés en prod

### Chantier 6 — Switcher consumer/producer (commit `442840b`)

- Nouveau composant `components/ui/role-switcher.tsx` avec variants `light` / `dark`
- Affiché uniquement si `roles` inclut `'consumer'` ET `'producer'`
- Injecté dans Sidebar consumer (pied avec séparateur) + `ProducerLayout` (dessus section identitaire)
- Navigation cross-subdomain via `NEXT_PUBLIC_APP_URL` et `NEXT_PUBLIC_PRODUCER_URL`
- 3 tests validés en prod

### RGPD — Suppression de compte

- Migration `20260422200000_rgpd_account_deletion.sql` : ajout statut `'deleted'`, colonnes audit (`deleted_at`, `deleted_reason`), RPC `delete_user_account()`
- Server action `app/(consumer)/compte/profil/delete-account-action.ts` (commit `d9ce0e8`) — orchestration anonymisation/suppression selon présence de `orders`
- UI `DeleteAccountSection` dans `/compte/profil` (commit `fb64675`) — double confirmation, explication claire (soft vs hard delete)
- Migration appliquée prod (commit `29fa064`)
- **Tests prod** : cas A (consumer pur sans orders → hard delete) + cas C (consumer+producer complet → hard delete en cascade) validés. Cas B et D (users avec orders → anonymisation soft) reportés, logique en place

### Fix home admin (commit `581475e`)

- `admin.terroir-local.fr/` sans session → redirect `/connexion`
- `admin.terroir-local.fr/` avec session admin → redirect `/tableau-de-bord`
- Logique placée dans le middleware (cf leçon : impossible d'avoir `(admin)/page.tsx` et `(public)/page.tsx` résolvant au même path)
- 4 tests validés en prod

### Chantier F — Mot de passe oublié (commit `c92b548`)

- Nouvelle page `/mot-de-passe-oublie` (étape 1 du flow reset) — formulaire email, message ambigu enumeration-resistant
- Lien "Mot de passe oublié ?" ajouté sur `/connexion`
- Template Supabase Reset Password corrigé — `&type=recovery&` en dur au lieu de `{{ .EmailActionType }}` qui renvoyait vide
- `redirectTo` dynamique basé sur `window.location.origin` pour que le magic link revienne sur le bon sous-domaine
- Bonus : fix lien mort `/producteur/inscription` → `/devenir-producteur` sur la home
- **Flow complet testé** : demande mdp → email reçu → clic → `/reset-password` → nouveau mdp → reconnexion OK

### Sidebar producteur — nom réel (commit `a029116`)

- Remplacement du placeholder hardcodé "Ferme des Chênes" par `producer.nom_exploitation` depuis `useUserContext`
- Lien "Voir ma page publique" rendu conditionnel sur `statut='public'` (évite 404 pour producteurs `active` non encore vitrine)
- Fallback loading + défensif pas-de-producer

### Storage — RLS policies uploads photos (commit `e13c744`)

- Policies INSERT/UPDATE/DELETE sur `storage.objects` pour buckets `product-photos` + `producer-photos`
- Vérif `owns_producer(producer_id)` extrait du path via `storage.foldername(name)[1]::uuid`
- Fix prod : uploads photos produits qui plantaient avec « new row violates row-level security policy »

### Qualité de code

- Consolidation type `UserRole` (commit `87371a4`) — suppression du re-export mort dans `lib/auth/session.ts`, `scripts/seed.ts` importe désormais depuis `@/lib/auth/roles`
- Helper promote-to-public : `console.error` → `console.warn` + préfixe `[PROMOTE_PRODUCER_WARN]` (commit `653c756`) — meilleur signal/bruit pour debug futur sans bloquer le fail-open

### Cleanup legacy

- Suppression `/api/stripe/payouts` orphelin (commit `8dcfd19`) — logique partagée `lib/stripe/payouts.ts` conservée pour `/api/cron/weekly-payout`
- Commentaire `create-payment-intent` aligné sur `/api/cron/weekly-payout` (commit `e93f143`)

## ✅ Fait (session 21/04/2026)

- Domaine `terroir-local.fr` branché (Vercel + OVH)
- Sous-domaines : `www`, `pro`, `admin` — tous en Valid Configuration
- Zone DNS OVH nettoyée (page parking OVH supprimée, emails MX/SPF OVH préservés)
- Rename `terroir.fr` → `terroir-local.fr` dans le code (commit 444b2cb)
- Env vars Vercel à jour (`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_PRODUCER_URL`, `RESEND_FROM_EMAIL`)
- Resend vérifié pour `terroir-local.fr` (DKIM + SPF + MX + DMARC posés)
- Nettoyage `STRIPE_CONNECT_CLIENT_ID` (code mort, flux Express + Account Links n'en a pas besoin)
- Lien "Explorer les produits" corrigé sur la home (pointe vers `/carte`)
- Nettoyage Redirect URLs Supabase Auth (suppression `terroir.fr` obsolètes, ajout `terroir-local.fr`)
- Boîte email `admin@terroir-local.fr` créée (Zimbra/OVH)
- Template Supabase Magic Link fixé (`type=magiclink` en dur, `{{ .TokenHash }}` validé)
- Route `/auth/callback` créée + page `/reset-password` (commit 49265bc)
- Middleware : `/reset-password` et `/auth/callback` ajoutés aux public paths
- Site URL Supabase corrigée (`www.terroir-local.fr`)
- Nettoyage Redirect URLs Supabase (3 URLs `terroir-local.fr`)
- **Chantier 1 (refactor rôles) déployé en prod** : migration `20260421100000_cumulative_roles_admin_users.sql` — table `public.admin_users`, `users.roles text[]` cumulables, triggers d'exclusion mutuelle `users ↔ admin_users`, fonction `is_admin()` refactorée sur `admin_users`
- **Fix GRANT `supabase_auth_admin`** : migration `20260421200000_grant_auth_admin_on_public.sql` (USAGE schema + ALL PRIVILEGES sur `public.*`) — nécessaire après chaque migration qui modifie des FK vers `auth.users`, sinon GoTrue renvoie « Database error querying schema »
- **Fix tokens auth NULL → ''** : les users créés par INSERT SQL direct dans `auth.users` doivent avoir les colonnes `confirmation_token`, `email_change`, `email_change_token_new`, `email_change_token_current`, `recovery_token`, `phone_change`, `phone_change_token`, `reauthentication_token` en string vide (pas NULL), sinon GoTrue plante avec « error finding user: sql: Scan error on column … converting NULL to string »
- **Compte admin créé** : `admin@terroir-local.fr` dans `auth.users` + `admin_users` (id `478d643a-9d2a-485d-aedf-438ca2eda246`, Romain LUBIN), password `TerrOirAdmin2026!` — **à changer dès première connexion réussie**
- **Soirée auth/UX (commits a9792f9 → 0aa2555)** :
  - Redirect post-login simplifié : admin → `/tableau-de-bord`, tous les autres → `/compte` (le switcher consumer/producer viendra via nav, Chantier 6)
  - Header connecté : icône SVG user + prénom (ou email tronqué) + badge Admin, via `useUserContext`, placeholder anti-flash, `autoComplete="username"` sur reset-password
  - Page `/compte/password` : changement de mot de passe avec re-auth de l'ancien (pattern reset-password)
  - Bouton Déconnexion dans la navbar (server action `logoutAction`)
  - Layout partagé `/compte` avec sidebar + landing page d'accueil
  - Layout admin dédié : `AdminHeader` + `AdminSidebar` + `layout.tsx` (light/corporate, sobre)
  - Suppression `AdminLayout` orphelin (a cassé les 3 pages admin qui l'importaient encore — forward fix en cours)
- **Résilience client Supabase** :
  - `createSupabaseBrowserClient` passé en singleton (module-level cache) — fini les instances multiples qui généraient des refresh parallèles et du 429
  - `.catch` sur `getSession()` dans `user-provider.tsx` — sinon `loading` reste `true` indéfiniment si Supabase rejette
  - Double `signOut` (client + server) pour rafraîchir l'UI immédiatement via `onAuthStateChange` en plus des cookies HTTP
- **Wipe résidus tests** : `DELETE FROM auth.refresh_tokens` + `auth.sessions` (19h47)
- **Décisions validées ce soir** :
  - Un seul écran de connexion pour `www` + `pro` (session partagée), écran admin distinct sobre/corporate
  - Un user `consumer+producer` atterrit sur `/compte` par défaut, switcher vers `/dashboard` via nav (Chantier 6)
- **Reskin admin light theme** (commit `a6f2c92`) : 3 pages admin (`gestion-producteurs`, `suivi-commandes`, `avis`) unwrappées d'`AdminLayout` + re-skin light/corporate cohérent avec le nouveau layout admin
- **Padding admin content area** (commit `ae5c8f0`) : espacement uniforme dans la zone de contenu admin
- **Seed 5 producteurs Sarthe fictifs** : photos Unsplash curées (commits `f4be9ca` + `91559cb`). Scripts `scripts/seed-producers.ts` + `scripts/cleanup-seed.ts` (cleanup via email `@seed.terroir-local.fr`)

## Chantier 2 — Flux invitation producteur ✅ CLÔTURÉ (22/04/2026)

- ✅ **Phase 1** : statuts `draft` + `public` ajoutés en DB (migration `20260421300000`, apply prod OK)
- ✅ **Phase 2** : blocages admin invitation (admin + producteur déjà inscrit) — commits `2f7b8e4` + `8a33027`, tests prod validés
- ✅ **Phase 3** : formulaire onboarding 3 étapes + upgrade consumer → producer
  - commits : `b776421` (formulaire) + `23a2b31` (fix draft) + `52d8e4e` (fix RLS admin) + `4268b20` (cleanup legacy)
  - migration `20260421400000` (`forme_juridique` + `type_production`, apply prod OK)
- ✅ **Phase 4** : reprise d'onboarding (redirect middleware vers le bon step si `statut='draft'`) — commit `285785d`, test validé en prod (cas étape 2)
- ✅ **Phase 5** : bouton « Valider » admin (`pending` → `active`) + modal de validation + `STATUS_META` front refait avec mapping final (amber pour `active`, vert pour `public`) — commit `9ed234e`
- ✅ **Phase 6** : auto-transition `active` → `public` au 1er produit publié + filtrage RPC/RLS publiques sur `statut='public'` — commits `e885439` + `e13c744` + migrations `20260422000000` + `20260422100000`, test validé en prod

**Tests validés en prod** : cas A nouveau user (Phase 3), reprise abandon mid-wizard (Phase 4), création 1er produit + auto-promotion public (Phase 6).

## 🟠 En cours

_(rien en cours)_

## 🔴 À faire (bloquants lancement)

> **Décisions produit tranchées le 22/04/2026 matin** : pas de livraison domicile, adresses consumer optionnelles, Stripe Customer pour MVP, créneaux producteur entièrement personnalisables.

- **Stripe Customer pour MVP** : créer un Stripe Customer au premier paiement du consumer, enregistrer la CB via SetupIntent/PaymentMethod, exposer la gestion des moyens de paiement dans `/compte` (liste + ajout + suppression), réutiliser le PaymentMethod par défaut aux commandes suivantes. Impact : lien `stripe_customer_id` à stocker sur `users` (ou table dédiée), webhook `payment_method.*` si on veut synchro.
- **Chantier Créneaux personnalisables** : remplacer le modèle actuel « créneaux fixes weekend toutes les 2 semaines » par un modèle configurable par producteur :
  - Jours sélectionnés (multi-select jours de la semaine) OU périodicité type « toutes les 2 semaines »
  - Amplitude horaire de la journée (ex: 9h-18h)
  - Durée par créneau configurable (min 5 min)
  - Capacité clients par créneau
  - Impact DB : probable refonte du schema `slots` (vérifier migration `20260419..._initial_schema` pour le modèle actuel avant de planifier la migration)
- Onboarder Julien (GAEC du Rheu) — après validation test end-to-end
- Basculer Stripe en mode Live (aujourd'hui en Test)
- Mettre à jour le webhook Stripe vers `www.terroir-local.fr` (actuellement pointe sur `terr-oir-21cl.vercel.app` — à confirmer, potentiellement déjà fait le 22/04 matin)

## 🟡 À faire (non bloquants)

- Mapbox : en attente retour CB
- Twilio SMS : numéro FR à régler
- Vectormagic logo SVG (8,99€)
- Remplacer images Unsplash provisoires par vraies photos producteurs
- Flux invitation : cas "email déjà en base" à détecter proprement côté UX (au-delà de la correction fonctionnelle du Chantier 2)
- Bouton « Voir page publique » (fiche producteur admin) était visible pour tous les statuts → désormais filtré sur `statut='public'` uniquement (Phase 5). Vérifier qu'aucun autre bouton/lien public ne fuit les producteurs non-publiés.
- Quand la section Paiements & adresses de `/compte` sera implémentée (couplée au chantier Stripe Customer), garder l'adresse consumer strictement optionnelle : pas de `required` à l'inscription, pas de blocage au checkout. Décision produit du 22/04/2026 : modèle circuit court sans livraison domicile.
- Magic link admin via `www.*` : si un flow magic link est ajouté pour les admins plus tard (recovery, invite), il faudra router explicitement via `admin.terroir-local.fr/auth/callback` + ajouter cette URL aux redirect URLs Supabase. Non bloquant aujourd'hui (admin password-only).

## 🔵 Idées / améliorations

- Pages d'accueil dédiées pour `pro.terroir-local.fr/` et `admin.terroir-local.fr/` (actuellement fallback vers layout public côté pro ; côté admin, redirect middleware en place depuis le 22/04 mais pas de vraie landing)
- MiniMap Mapbox sur fiche produit (non câblée)
- Régionaliser le fallback géoloc (actuellement Le Mans en dur)
- Notation/reviews producteurs (cadre existant via reviews mais flow à valider)
- Export comptable consommateurs + producteurs
- Gestion des litiges (retrait non effectué, marchandise abîmée)
- Stats publiques sur la home (nb commandes, nb producteurs actifs)

## ⚠️ Leçons apprises / Known pitfalls

- **Toute migration future qui référence `auth.users` via FK dans `public.*` DOIT inclure les GRANT sur `supabase_auth_admin`** (USAGE sur le schema + privilèges sur les tables concernées). Sans ça, GoTrue renvoie « Database error querying schema » sur `/token` et `/recover`. Ne pas recommencer le debug d'1h.
- **Création de users via SQL direct sur `auth.users`** : toujours initialiser à `''` (pas NULL) les 8 colonnes token : `confirmation_token`, `email_change`, `email_change_token_new`, `email_change_token_current`, `recovery_token`, `phone_change`, `phone_change_token`, `reauthentication_token`. Sinon GoTrue plante au scan (`converting NULL to string`).
- **Ne jamais supprimer un fichier de `_components/`** sans `grep` préalable sur tous ses imports. Le commit `0aa2555` a supprimé `AdminLayout.tsx` et cassé les 3 pages admin qui l'importaient encore.
- **`createSupabaseBrowserClient` doit être singleton** (module-level cache). Sinon chaque composant instancie son propre client, donc ses propres timers de refresh tournent en parallèle, et Supabase répond `429 Too Many Requests` au bout de quelques minutes.
- **Logout UX = double `signOut`** : un `signOut` côté client pour déclencher `onAuthStateChange` et rafraîchir le `UserProvider` immédiatement, plus un `signOut` côté server (server action) pour effacer les cookies HTTP. Sans le client, l'UI continue d'afficher l'user connecté jusqu'au prochain reload.
- **`UserProvider` doit `.catch` `getSession()`** sinon en cas de rejet Supabase (réseau down, 429, etc.) le `loading` reste `true` indéfiniment et toute l'app reste bloquée sur le placeholder.
- **Supprimer un composant partagé : toujours `grep -rn "ComponentName" app/ components/` AVANT `git rm`**. Ne jamais se fier à un « je crois que c'est orphelin » sans vérification. Incident du 21/04 : suppression d'`AdminLayout` qui était encore importé par `gestion-producteurs` et `suivi-commandes` → build Vercel cassé en prod.
- **`npm run build` (pas `npx tsc --noEmit`) est obligatoire avant push quand un refactor supprime, déplace ou renomme un fichier.** `tsc` ne reproduit pas la résolution de modules webpack et laisse passer les imports vers des fichiers inexistants.
- **Les RLS policies peuvent filtrer silencieusement des données avant même que le code applicatif les lise.** Quand un bug de type « la donnée existe en DB mais n'apparaît nulle part dans l'UI », toujours vérifier les policies RLS sur la table concernée : `SELECT polname, pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polrelid = 'table'::regclass;`. Incident du 21/04 : les producteurs `pending` étaient invisibles côté admin à cause d'une policy qui filtrait sur `statut='active'` (fix commit `52d8e4e`).
- **Next.js re-render SSR après mutation de cookies** (ex: `signInWithPassword`) peut déclencher une défense en profondeur avant que le client ne puisse avancer. Dans les flows multi-étapes, penser à vérifier que les conditions de blocage distinguent bien les états légitimes (`draft`) des états problématiques (`pending`/`active`/`public`). Incident du 21/04 : le middleware bloquait les users `draft` en pleine onboarding parce qu'il ne les distinguait pas des `pending` (fix commit `23a2b31`).
- **Supabase Storage : bucket `public` ≠ écriture publique.** Un bucket marqué `public` autorise la LECTURE via `getPublicUrl`, mais TOUT upload authentifié nécessite des policies RLS explicites sur `storage.objects` (INSERT minimum, UPDATE/DELETE selon besoin). Pattern TerrOir : policy `WITH CHECK` qui vérifie `bucket_id` + `owns_producer(producer_id)` où `producer_id` est extrait du path via `storage.foldername(name)[1]::uuid`. Incident du 22/04 : uploads photos produits/producteurs plantaient en prod avec « new row violates row-level security policy » alors qu'aucune policy applicative ne semblait coupable.
- **Debug RLS : toujours inspecter l'onglet Network DevTools.** Quand une erreur « new row violates row-level security policy » remonte et qu'aucune policy DB sur la table applicative ne semble coupable, vérifier les requêtes Network pour voir si c'est une AUTRE ressource qui plante (typiquement `storage.objects` pour un upload). Le message d'erreur générique ne distingue pas les tables — seule la requête HTTP échouée permet d'identifier la vraie cible.
- **Cookies multi-subdomain : fixer uniquement le `domain` ne suffit pas pour isoler 2 sous-domaines.** Si le cookie `name` est identique entre tous les subdomains et que le `domain` parent est partagé (`.apex.fr`), le navigateur enverra le cookie à tous. Pour une vraie isolation, il faut combiner : (1) pas de `domain` explicite sur le subdomain isolé ET (2) un nom de cookie distinct. Le `@supabase/ssr` permet les deux via `CookieOptionsWithName`. Leçon du 22/04 : sans le nom distinct, admin voyait encore la session consumer posée par www.
- **Les routes API Next.js peuvent avoir l'extension `.tsx` de manière légitime** quand elles utilisent du JSX inline — typiquement les crons qui envoient des emails via Resend avec un template React (`element: <OrderTimeoutCancelled {...props} />`). Ne pas présumer qu'une route API `.tsx` est un résidu à renommer sans vérifier son contenu. Incident du 22/04 : 4 routes cron renommées à tort `.tsx` → `.ts`, `tsc` a immédiatement levé 12 erreurs de parsing JSX, rollback nécessaire. `vercel.json` référence aussi les extensions explicitement dans le bloc `functions` — à synchroniser si rename légitime un jour.
- **Templates email Supabase : `{{ .EmailActionType }}` peut renvoyer une string vide** et casser silencieusement le callback. Préférer **hardcoder** le type dans la querystring du template (ex: `&type=recovery&` en dur) plutôt que d'utiliser cette variable. Sinon `/auth/callback` reçoit `type=` vide → parsé comme `null` → rejette avec « Missing code or token_hash ». Incident du 22/04 : le lien de reset password tombait toujours en erreur à l'arrivée sur le callback, malgré un token valide.
- **Mailinator introduit un délai d'affichage de 1-2 minutes** entre la réception d'un email côté serveur (200 OK depuis `/auth/v1/recover`) et son apparition dans l'inbox. Ne pas conclure « l'email n'a pas été envoyé » trop vite — rafraîchir l'inbox avant de suspecter le code applicatif.
- **Les paths publics ont des noms piégeux à TerrOir.** `/inscription` **n'existe pas** : la vraie route d'inscription consumer est `/auth/inscription`. Le segment `/devenir-producteur` est la landing producer (formulaire d'intérêt). Le groupe de route `(consumer)` / `(public)` / `(producer)` / `(admin)` est transparent au path, donc attention aux confusions de lien — vérifier que la cible existe avec un test navigateur ou un Glob sur `app/**/slug/page.tsx` avant de coller un `<Link href=...>`.
- **Next.js App Router refuse 2 `page.tsx` dans des route groups différents qui résolvent au même path.** Impossible de créer `app/(admin)/page.tsx` en parallèle de `app/(public)/page.tsx` pour gérer la home `admin.terroir-local.fr/` — les deux résolvent à `/` et Next.js lève une erreur de build. **Solution retenue** : logique de redirect dans le middleware pour différencier par hostname. Incident du 22/04 : tentative de créer `(admin)/page.tsx` a échoué au build → rollback, fix via middleware (commit `581475e`).
