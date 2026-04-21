# TODO TerrOir

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

## 🟠 En cours

- Post-login admin : redirection vers `/invitation` au lieu d'un espace admin dédié — diagnostic en cours

## 🔴 À faire (bloquants lancement)

- REVERT du commit `38b46ff` (cookies partagés `.terroir-local.fr`) — à faire après Chantier 1, avant Chantier 4
- Chantier 2 : flux d'invitation producteur (gérer upgrade consumer → consumer+producer au lieu de plantage si email existe déjà)
- Chantier 4 : cookies refait proprement — cookies `.terroir-local.fr` UNIQUEMENT pour `www` et `pro`, cookies isolés sur `admin.terroir-local.fr`
- Chantier 5 : middleware adapté au nouveau modèle rôles (laisser producteur accéder à `/compte`, utiliser `admin_users` pour auth admin)
- Chantier 6 : interface de switch consumer/producer dans le profil producteur
- Onboarder Julien (GAEC du Rheu) — après validation test end-to-end
- Basculer Stripe en mode Live (aujourd'hui en Test)
- Mettre à jour le webhook Stripe vers `www.terroir-local.fr` (actuellement pointe sur `terr-oir-21cl.vercel.app`)

## 🟡 À faire (non bloquants)

- Mapbox : en attente retour CB
- Twilio SMS : numéro FR à régler
- Vectormagic logo SVG (8,99€)
- Ajouter un lien "Mot de passe oublié" sur la page de connexion
- Supprimer `/api/stripe/payouts` legacy (remplacé par `/api/cron/weekly-payout`)
- Nettoyer les `.tsx` résiduels dans `/api/cron/` (route.tsx → route.ts)
- Remplacer images Unsplash provisoires par vraies photos producteurs
- Nettoyer duplication `UserRole` type (`lib/auth/session.ts` + `user-provider.tsx`)
- Flux invitation : cas "email déjà en base" à détecter proprement côté UX (au-delà de la correction fonctionnelle du Chantier 2)

## 🔵 Idées / améliorations

- Pages d'accueil dédiées pour `pro.terroir-local.fr/` et `admin.terroir-local.fr/` (actuellement fallback vers layout public)
- MiniMap Mapbox sur fiche produit (non câblée)
- Régionaliser le fallback géoloc (actuellement Le Mans en dur)
- Notation/reviews producteurs (cadre existant via reviews mais flow à valider)
- Export comptable consommateurs + producteurs
- Gestion des litiges (retrait non effectué, marchandise abîmée)
- Stats publiques sur la home (nb commandes, nb producteurs actifs)

## ⚠️ Leçons apprises / Known pitfalls

- **Toute migration future qui référence `auth.users` via FK dans `public.*` DOIT inclure les GRANT sur `supabase_auth_admin`** (USAGE sur le schema + privilèges sur les tables concernées). Sans ça, GoTrue renvoie « Database error querying schema » sur `/token` et `/recover`. Ne pas recommencer le debug d'1h.
- **Création de users via SQL direct sur `auth.users`** : toujours initialiser à `''` (pas NULL) les 8 colonnes token : `confirmation_token`, `email_change`, `email_change_token_new`, `email_change_token_current`, `recovery_token`, `phone_change`, `phone_change_token`, `reauthentication_token`. Sinon GoTrue plante au scan (`converting NULL to string`).
