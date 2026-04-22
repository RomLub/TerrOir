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

### Chantier Créneaux personnalisables — Phases 1+3 livrées

- **Phase 1** (commit `abd0ec1` + migration `20260422300000_slot_rules_and_materialized_slots.sql`) : nouveau schema DB (`slot_rules` + refonte `slots` en instances matérialisées), RLS policies (public read gaté `statut='public'`, owner via `owns_producer`, admin via `is_admin()`). Le RPC `delete_user_account` protège aussi `slot_rules` via CASCADE (chaîne FK `slot_rules.producer_id → producers.id → users.id`).
- **Phase 3** (commits `2616cf3` + `21f8c68`) : générateur `lib/slots/generate.ts` tz-aware (Europe/Paris via `@date-fns/tz`), mémo 15 min, UPSERT idempotent (`onConflict=(producer_id, starts_at) ignoreDuplicates`). Branché dans la page produit consumer avec refactor du select cassé (nouvelles colonnes `starts_at`/`ends_at`/`capacity_per_slot`).
- **Smoke test validé en prod** : 42 slots matérialisés pour Vergers de l'Huisne (rule mer+sam 9h-12h, durée 30 min, capacité 5).
- **Reste à faire** : Phase 2 (wipe+reseed data, skipped), Phase 4 (UI producer), Phase 5 (UI consumer avec accordéon), Phase 6 (RPC `create_order_with_items` check capacité), Phase 7 (seed + tests).

### Chantier Stripe Customer MVP — Phases 1-4 livrées

- **Phase 1** (commit `546fc5e`) : migration `20260422300000_add_stripe_customer_id_to_users.sql` — colonne `users.stripe_customer_id` nullable + index partiel.
- **Phase 2** (commit `7992727`) : helpers `getOrCreateStripeCustomer()` / `deleteStripeCustomer()` dans `lib/stripe/customer.ts`, lazy creation au 1er besoin.
- **Phase 3** (commit `a4b6509`) : purge RGPD côté Stripe Customer — `delete-account-action.ts` nettoie le customer Stripe avant suppression du user, flag `stripe_cleanup_pending` si échec.
- **Phase 4** : page `/compte/paiements`
  - Liste cartes, ajout via SetupIntent + Payment Element, suppression avec confirmation, switch carte par défaut (commit `2e35f14`)
  - UX bouton « Définir par défaut » + flash messages enrichis (commit `d338e48`)
  - Fix scroll modale d'ajout de CB (commit `fe683ba`)
- **Tests prod validés** : état vide · ajout CB · switch default · suppression avec bascule auto du default sur carte restante
- **Reste à faire** : Phase 5 (lien sidebar `/compte/paiements`), Phase 6 (branchement checkout avec PaymentMethod existant), Phase 7 (sélecteur CB au paiement)

### Désactivation Stripe Link (commit `f367338`)

- Ajout `payment_method_types: ['card']` sur la `PaymentIntent` (la `SetupIntent` l'avait déjà)
- `wallets: { applePay: 'never', googlePay: 'never' }` sur les 2 PaymentElement (`AddCardModal` + checkout)
- Link peut persister en UI via override Dashboard Stripe → désactivation account-wide à faire manuellement

### Fix lien mort `/inscription` dans NavbarPublic (commit `67f2799`)

- `href="/inscription"` → `/auth/inscription` (la vraie route d'inscription consumer, le fallback sur `/inscription` restait dans PUBLIC_PATHS du middleware uniquement)

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
- **Chantier Créneaux personnalisables — Phases restantes (4, 5, 6, 7)** :
  - **Phase 4** : UI producer `/creneaux` (formulaire règles + liste rules actives + preview « X créneaux sur 4 semaines ») — page actuellement cassée (insère les anciennes colonnes `jour_semaine`/`heure_debut`/`heure_fin` droppées en Phase 1).
  - **Phase 5** : UI consumer refonte — afficher N slots par jour en accordéon (1 groupe par date, dropdown sur clic, accordéon exclusif, slots pleins grisés via `SlotOption.left`).
  - **Phase 6** : RPC `create_order_with_items` à étendre pour check `capacity_per_slot` + `FOR UPDATE` sur slot (anti race condition overbooking) — `/api/orders/create` actuellement cassé (select `heure_debut` inexistant). Bundler le rename `slots.actif → slots.active` (différé depuis Phase 1).
  - **Phase 7** : Seed + tests (grouper avec refacto `scripts/seed.ts` notée plus bas).
- Onboarder Julien (GAEC du Rheu) — après validation test end-to-end
- Basculer Stripe en mode Live (aujourd'hui en Test)
- Mettre à jour le webhook Stripe vers `www.terroir-local.fr` (actuellement pointe sur `terr-oir-21cl.vercel.app` — à confirmer, potentiellement déjà fait le 22/04 matin)

## 🟡 À faire (non bloquants)

- Mapbox : en attente retour CB
- Twilio SMS : numéro FR à régler
- Vectormagic logo SVG (8,99€)
- Remplacer images Unsplash provisoires par vraies photos producteurs
- Flux invitation : cas "email déjà en base" à détecter proprement côté UX (au-delà de la correction fonctionnelle du Chantier 2)
- Quand la section Paiements & adresses de `/compte` sera implémentée (couplée au chantier Stripe Customer), garder l'adresse consumer strictement optionnelle : pas de `required` à l'inscription, pas de blocage au checkout. Décision produit du 22/04/2026 : modèle circuit court sans livraison domicile.
- Magic link admin via `www.*` : si un flow magic link est ajouté pour les admins plus tard (recovery, invite), il faudra router explicitement via `admin.terroir-local.fr/auth/callback` + ajouter cette URL aux redirect URLs Supabase. Non bloquant aujourd'hui (admin password-only).
- **Refonte `scripts/seed.ts`** (dette technique post-session 22/04) :
  - `ensureSlots()` cassé par la refonte créneaux (utilise les colonnes `jour_semaine`/`heure_debut`/`heure_fin` droppées par migration `20260422300000_slot_rules_and_materialized_slots.sql`)
  - Remplacer par une logique `slot_rules` + matérialisation `slots`
  - Profiter de la refonte pour hardcoder `statut='public'` (éviter invisibilité publique) et remplir `forme_juridique` / `type_production`
  - À faire en même temps que la Phase 7 du chantier Créneaux personnalisables (Seed + tests) pour éviter de toucher 2 fois au même fichier
- **Horizon génération slots : 4 semaines → 3 mois** (12-13 semaines). Change à faire dans `generateSlotsForProducer` (`lib/slots/generate.ts`) + dans le select de la page produit consumer (`app/(public)/producteurs/[slug]/produits/[id]/page.tsx`). Pas prioritaire mais à prévoir avant lancement public.
- Nettoyer l'entrée orpheline `"/inscription"` dans `middleware.ts` `PUBLIC_PATHS` (ligne 14) — la vraie route d'inscription consumer est `/auth/inscription`, `"/inscription"` ne résout à rien (lien mort fixé côté NavbarPublic par le commit `67f2799`).
- Désactiver Stripe Link dans le Dashboard Stripe (Settings > Payment methods > Link toggle off) — action externe, pas code. Nécessaire si Link persiste à apparaître malgré `payment_method_types: ['card']` côté intents.
- **Icône panier avec badge dans la navbar** : actuellement aucun accès direct au panier depuis la navigation. L'user doit cliquer « Passer commande » depuis une fiche produit pour atteindre `/compte/panier`. À ajouter :
  - Icône 🛒 dans `components/ui/navbar-public.tsx` (à droite, entre le prénom user et la déconnexion)
  - Badge rouge avec le nombre d'articles (depuis le store client `lib/store/cart.ts`)
  - Clic → `/compte/panier`
  - Update en temps réel via hook `useCart()` ou équivalent
  - Visible uniquement pour les users consumer (loggés)
- **Stripe Customer au checkout** : actuellement, un consumer ayant enregistré des CB via `/compte/paiements` ne les voit pas proposées automatiquement au checkout. Le `PaymentIntent` est encore créé sans customer attaché. Sera corrigé par :
  - **Phase 6 Stripe Customer** : attacher le customer au `PaymentIntent` + checkbox « Mémoriser cette carte » conditionnelle
  - **Phase 7 Stripe Customer** : sélecteur « CB enregistrée vs nouvelle » quand l'user a des PaymentMethods existants
  Déjà planifié dans le chantier Stripe Customer (section 🔴 À faire).

## 🗺️ Roadmap produit (vision Avril 2026)

> Feuille de route définie le 22/04/2026. 3 niveaux de priorité. Chaque item = une fonctionnalité produit à scoper techniquement le moment venu.

### Priorité HAUTE (prochaines semaines)

1. **Prix GMS sur chaque fiche produit**
   Prix moyen constaté en grande surface (source RNM FranceAgriMer) affiché à côté du prix éleveur. Mis à jour manuellement chaque mois via interface admin.
   *Impact : justifie le prix, montre que circuit direct = moins cher pour qualité supérieure.*
   (Base de données · Interface admin · Fiche produit)

2. **Le conseil de l'éleveur**
   Sur chaque produit, case activable + champ libre 280 caractères (cuisson, conservation, accord). Si non activé, rien n'apparaît.
   *Impact : humanise le produit, lien direct producteur-acheteur, différenciateur vs GMS.*
   (Espace producteur · Fiche produit consommateur)

3. **Score carbone & bien-être animal**
   Sur la page producteur : km parcourus vs moyenne GMS (~1500 km), mode d'élevage (plein air/bâtiment), alimentation, densité. Remplis par le producteur à l'onboarding.
   *Impact : transparence concrète, argument écologique mesurable sans jargon de label.*
   (Onboarding producteur · Page producteur publique)

### Priorité MOYENNE (prochain trimestre)

4. **Carte interactive des morceaux**
   Schéma SVG interactif (vache, puis porc, agneau). Clic sur un morceau → nom + conseils cuisson + redirection produits disponibles chez les éleveurs TerrOir.
   *Impact : éducatif, unique sur le marché. Aide à découvrir des morceaux moins connus, augmente le panier moyen.*
   (Page publique · Catalogue · UX éducatif)

5. **Schéma interactif circuit court vs GMS**
   Infographie animée sur `/comment-ca-marche` montrant parcours d'un morceau GMS (éleveur → abattoir → transporteur → centrale → GMS → consommateur) vs TerrOir (éleveur → TerrOir → consommateur). Impact sur prix et rémunération éleveur.
   *Impact : argument de conversion puissant, rend concret l'avantage du circuit court.*
   (Page `comment-ca-marche` · Marketing)

6. **D'où vient ma viande**
   Page confirmation + historique commandes : mini-carte du trajet exploitation → point de retrait avec km. Comparaison avec moyenne GMS (1500 km).
   *Impact : moment émotionnel fort après achat, renforce satisfaction et fidélisation, potentiel partage social.*
   (Page confirmation · Historique commandes · Carte)

7. **Alerte disponibilité produit**
   Produit indisponible → consumer laisse email → prévenu au retour en stock. Producteur voit dans dashboard combien de personnes attendent chaque produit.
   *Impact : réduit perte de clients, donne visibilité sur la demande réelle au producteur.*
   (Fiche produit · Dashboard producteur · Email)

8. **Calculateur d'impact à la confirmation**
   Sur page confirmation : « Merci. Grâce à vous, Julien a gagné X€ de plus qu'en circuit classique. » Calculé depuis montant commande et taux moyen rémunération éleveur en circuit long (~30%).
   *Impact : crée sentiment de participation et de sens, fidélise au-delà du simple achat.*
   (Page confirmation · Impact social)

### Priorité BASSE (second semestre 2026)

9. **Compteur impact global plateforme**
   Home + `/a-propos` : « Depuis le lancement, les éleveurs TerrOir ont gagné X€ de plus qu'en circuit classique. » Calcul automatique depuis commandes en base.
   *Impact : argument de marque fort, dimension collective et militante à chaque achat.*
   (Home · Page à-propos · Marketing)

10. **Abonnement panier mensuel**
    Commande récurrente chez un éleveur. Paiement auto, notification avant débit, pause/annulation. Producteur voit ses abonnés.
    *Impact : revenus récurrents, fidélisation max. Nécessite travail juridique CGV.*
    (Stripe recurring · Dashboard producteur · CGV)

11. **Carte cadeau & fidélité**
    Carte cadeau TerrOir (crédit en euros, utilisable chez n'importe quel éleveur). Dans un 2e temps : système points de fidélité (X points/€ dépensé, convertibles en réduction).
    *Impact : levier d'acquisition et de rétention.*
    (Stripe · Système de points · Acquisition)

12. **Glossaire du terroir**
    Pages expliquant labels (Label Rouge, AB, AOC…), races (Charolais, Maine-Anjou…), modes d'élevage. Contenu evergreen SEO.
    *Impact : SEO long terme, éducation consumer, autorité éditoriale terroir sarthois.*
    (SEO · Contenu · Pages statiques)

## 🔵 Idées / améliorations

- Pages d'accueil dédiées pour `pro.terroir-local.fr/` et `admin.terroir-local.fr/` (actuellement fallback vers layout public côté pro ; côté admin, redirect middleware en place depuis le 22/04 mais pas de vraie landing)
- MiniMap Mapbox sur fiche produit (non câblée)
- Régionaliser le fallback géoloc (actuellement Le Mans en dur)
- Notation/reviews producteurs (cadre existant via reviews mais flow à valider)
- Export comptable consommateurs + producteurs
- Gestion des litiges (retrait non effectué, marchandise abîmée)
- Stats publiques sur la home (nb commandes, nb producteurs actifs)
- **Helper `fetchPublicProducerBySlug(slug)`** pour centraliser le filtre `statut='public'` sur les pages publiques qui utilisent `createSupabaseAdminClient`. Prévient les fuites futures quand de nouvelles pages publiques seront ajoutées.
- **Edge case panier** : si un producer passe en `'suspended'` entre l'ajout au panier et la consultation, le lien vers `/producteurs/{slug}` mène à un `notFound()` (404). Pas une fuite de données, juste un UX problème mineur. À fixer en re-fetchant les producers lors du chargement du panier et en masquant le lien si non-public.
- **Refacto UX créneaux page produit consumer** : regroupement par date + dropdown accordéon (1 seul ouvert à la fois), créneaux grisés si pleins (capacity restante via `SlotOption.left` câblée Phase 6). À traiter en Phase 5 (UI consumer) du chantier Créneaux personnalisables.

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
- **Stripe PaymentElement inclut Link par défaut** quand la `PaymentIntent` / `SetupIntent` utilise `automatic_payment_methods` (le default silencieux quand on omet `payment_method_types`). Pour une UX card-only : spécifier `payment_method_types: ['card']` côté intent **et** `wallets: { applePay: 'never', googlePay: 'never' }` côté Payment Element. Link peut quand même persister en UI si un override account-level est actif dans le Dashboard Stripe — à désactiver manuellement (Settings > Payment methods > Link toggle off).
- **Next.js pre-fetch RSC des `<Link>` visibles dans le viewport** : un `href` mort déclenche un `404` silencieux en Network DevTools dès l'apparition du lien à l'écran, avant même tout clic. Ça peut faire paniquer lors d'un audit (« il y a du 404 dans le Network »), alors que c'est juste le pre-fetch qui échoue sur une route supprimée/renommée. À surveiller lors des refactors de routes : chercher les `<Link href="/chemin-supprimé">` restants plutôt que d'ignorer les 404 silencieux.
- **Templates email Supabase : `{{ .EmailActionType }}` peut renvoyer une string vide** et casser silencieusement le callback. Préférer **hardcoder** le type dans la querystring du template (ex: `&type=recovery&` en dur) plutôt que d'utiliser cette variable. Sinon `/auth/callback` reçoit `type=` vide → parsé comme `null` → rejette avec « Missing code or token_hash ». Incident du 22/04 : le lien de reset password tombait toujours en erreur à l'arrivée sur le callback, malgré un token valide.
- **Mailinator introduit un délai d'affichage de 1-2 minutes** entre la réception d'un email côté serveur (200 OK depuis `/auth/v1/recover`) et son apparition dans l'inbox. Ne pas conclure « l'email n'a pas été envoyé » trop vite — rafraîchir l'inbox avant de suspecter le code applicatif.
- **Les paths publics ont des noms piégeux à TerrOir.** `/inscription` **n'existe pas** : la vraie route d'inscription consumer est `/auth/inscription`. Le segment `/devenir-producteur` est la landing producer (formulaire d'intérêt). Le groupe de route `(consumer)` / `(public)` / `(producer)` / `(admin)` est transparent au path, donc attention aux confusions de lien — vérifier que la cible existe avec un test navigateur ou un Glob sur `app/**/slug/page.tsx` avant de coller un `<Link href=...>`.
- **Next.js App Router refuse 2 `page.tsx` dans des route groups différents qui résolvent au même path.** Impossible de créer `app/(admin)/page.tsx` en parallèle de `app/(public)/page.tsx` pour gérer la home `admin.terroir-local.fr/` — les deux résolvent à `/` et Next.js lève une erreur de build. **Solution retenue** : logique de redirect dans le middleware pour différencier par hostname. Incident du 22/04 : tentative de créer `(admin)/page.tsx` a échoué au build → rollback, fix via middleware (commit `581475e`).
- **Audit du 22/04/2026 — 4 couches de protection indépendantes sécurisent les producers non-publiés** :
  1. **RLS DB** : policy `"producers public read when public"` filtre `statut='public'` pour tout client respectant la RLS.
  2. **RPC `search_producers()`** : `WHERE p.statut = 'public'` en dur (utilisée par `/producteurs` et `/carte`).
  3. **Filtres applicatifs** : les pages publiques qui utilisent `createSupabaseAdminClient()` (service_role, bypasse RLS) DOIVENT explicitement filtrer `.eq('statut', 'public')` + `notFound()` si absent. **Convention à respecter pour toute nouvelle page publique.**
  4. **Gating UI** : les boutons "Voir page publique" vérifient `statut === 'public'` avant de rendre le lien.
  
  Audit complet : 13 liens vers `/producteurs/[slug]` ou queries `producers` en contexte public, tous filtrés. Aucune fuite.
