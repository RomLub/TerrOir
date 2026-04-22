# TODO TerrOir

## ✅ Fait (session 22/04/2026)

### Nuit du 22 → 23/04/2026

- **Fix bug latent `'draft'` statut gestion-producteurs** (commit `e6dc1e3`) : défense en profondeur similaire au fix `'deleted'` (entrée `STATUS_META` dédiée, palette slate neutre). Convention du 22/04 appliquée : toute valeur DB possible doit avoir une entrée, même si filtrée au fetch.

- **Page admin "Leads producteurs"** (commit `a8ef04a`) :
  - `/producer-interests` : tabs Tous / Nouveaux / Contactés / Onboardés avec counts, table avec actions (marquer comme contacté / inviter / supprimer).
  - Migration RLS DELETE admin apply prod.
  - Lien « Inviter » pré-remplit `InviteModal` de `/gestion-producteurs` via query param `?invite=<email>`.
  - **Bonus embarqué** (par merge parallèle entre 2 terminaux CC) : toggle `showAll` pour afficher brouillons + supprimés dans `/gestion-producteurs`. Logique TC livrée sous message TA — état code correct, historique git confus (cf leçon parallélisation plus bas).

- **Helper centralisé `fetchPublicProducerBySlug`** (commit `7f9540a`) :
  - `lib/producers/fetch-public.ts` : lookup par slug + filter `statut='public'` + `deleted_at IS NULL`, 21 champs typés via interface `ProducerPublic`.
  - 2 pages publiques migrées (`/producteurs/[slug]` fiche + `/producteurs/[slug]/produits/[id]` fiche produit). Logique inversée sur la fiche produit : slug-first via helper + cross-check `producerRow.id === productRow.producer_id` (au lieu de `id → slug cross-check`).
  - 11 lignes de duplication supprimées. Item 🔵 "helper centralisé" réalisé.

- **Rename `slots.actif → slots.active`** (commit `726bbe5` + migration `20260422700000_rename_slots_actif_to_active.sql` apply) :
  - DB : rename column via migration dédiée.
  - RPC `create_order_with_items` mise à jour avec `active` dans le check disponibilité slot.
  - 5 fichiers backend touchés (server actions `/creneaux`, pages fetch dashboard/creneaux, page produit consumer).
  - Frontend no-op : grep préalable confirmait zéro référence `actif` côté client — refacto purement backend.

- **Refactor consolidation formatters slots** (commit `de40458`) :
  - `formatLegacyTimeRange` supprimé de `lib/slots/format-slot-time.ts` (fonction structurellement dead : les 2 call sites passaient toujours `null` en 2e argument, dégénérant en `formatLegacyTimeHHMM`).
  - 2 pages consumer migrées (`/compte/confirmation/[id]`, `/compte/commandes/[id]`) vers `formatLegacyTimeHHMM(order.heure_retrait)` direct.
  - 6 helpers → 5 helpers. −10 lignes nettes.

- **Consolidation admin — Phase A formatters** (commit `31670a2`) :
  - `lib/format/date.ts` (`formatDateFr(iso, { year?: boolean })`) + `lib/format/currency.ts` (`formatEuro(value)` avec fallback).
  - 3 pages admin migrées (`/gestion-producteurs`, `/producer-interests`, `/suivi-commandes`) — duplications inline de `toLocaleDateString('fr-FR', …)` + formatting euro remplacées.
  - −43 lignes de duplication, 0 changement visuel.

### Matin 23/04/2026

- **Rename `products.actif → products.active`** (commits `47df4e8` + `9176cc8` + migration `20260423000000_rename_products_actif_to_active.sql` apply) :
  - DB : rename colonne + index `products_actif_idx → products_active_idx` + recreate RLS policy `"products public read when producer public"` + recreate 2 RPCs (`search_producers` sous-select product_count, `create_order_with_items` bloc 5 validation produits).
  - Backend + scripts seed : 2 fichiers (`scripts/seed.ts`, `scripts/seed-producers.ts`).
  - Frontend : 12 remplacements sur 6 fichiers (pages public/producteur/catalogue + dashboard low-stock).
  - Strings UI FR préservées (labels toggles, compteurs « produits actifs », « Actif/Inactif »).
  - **Chantier rename actif → active COMPLET** (slots la veille + products aujourd'hui). Schéma principal 100% en anglais pour les booléens techniques.

- **Phase 7 Créneaux COMPLÈTE** (commits `ffa0967` + `fca4871`) :
  - Seed enrichi : `slot_rules` ajoutées aux 5 producers prod (idempotent via `(producer_id, days_of_week, start_time)`).
  - Tests auto vitest : 27 tests (`generate`, `format-slot-time`, `validators`), 2.56s total, mock Supabase manuel, couverture DST Europe/Paris (passage hiver/été).
  - Scripts `test` / `test:watch` / `test:ui` ajoutés dans `package.json`.
  - **Chantier Créneaux personnalisables 100% CLOS** — Phases 1→7 + Phase 2bis ponctuels/exceptions en prod.

- **Fix CB dupliquée via fingerprint Stripe** (commit `af7d1bb`) :
  - Nouvelle server action `validateAndKeepPaymentMethodAction` dans `app/(consumer)/compte/paiements/actions.ts`.
  - `AddCardModal` appelle post-`confirmSetup` : détache silencieusement le nouveau PM côté Stripe si son `fingerprint` matche un PM existant, affiche message explicite « Cette carte est déjà enregistrée (Visa •••• 4242). » et ne ferme pas la modal.
  - Endpoint `/api/stripe/ensure-default-payment-method` étendu : dedupe fingerprint AVANT le set default (couvre le flow checkout `save_card=true`, fail-open silencieux côté client).
  - Skip si fingerprint null (défense en profondeur pour marques exotiques / non-card).
  - Bug listé depuis `d9a699a` → clos.

- **Formulaire standalone opt-out V2** (commit `0851924`) :
  - `/desabonnement` sans token affiche désormais un formulaire email pour renvoyer le lien de désabonnement par email.
  - Server action `request-new-link-action.tsx` : enumeration-resistant (réponse générique identique quelque soit l'existence du lead).
  - Email Resend avec token HMAC (même logique que le lien d'origine) pour retrouver le lien opt-out.
  - **Chantier RGPD opt-out COMPLET** (lien token + standalone recovery).

- **Consolidation admin — Phases B2 + B3 + B4** (commits `eaed1a2` + `5b63283` + `2960b18`) :
  - **Phase B2 `AdminModal`** (`eaed1a2`) : 3 modals unifiés (`ConfirmValidateModal`, `InviteModal`, `DeleteLeadModal`), close X + Escape hérités partout, focus trap partagé.
  - **Phase B3 `FilterTabs`** (`5b63283`) : 2 pages migrées (`gestion-producteurs`, `producer-interests`), `suivi-commandes` conserve son style pills divergent intentionnellement.
  - **Phase B4 `AdminPageHeader`** (`2960b18`) : 4 pages migrées avec prop `error?` en bonus (flash erreur unifié dans le header).
  - Reste **Phase B5** (`TableStatus` loading/empty rows).

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

### Chantier Créneaux personnalisables — Phases 1-6 livrées + Phase 2bis ponctuels/exceptions

- **Phase 1** (commit `abd0ec1` + migration `20260422300000_slot_rules_and_materialized_slots.sql`) : nouveau schema DB (`slot_rules` + refonte `slots` en instances matérialisées), RLS policies (public read gaté `statut='public'`, owner via `owns_producer`, admin via `is_admin()`).
- **Phase 3** (commits `2616cf3` + `21f8c68`) : générateur `lib/slots/generate.ts` tz-aware (Europe/Paris via `@date-fns/tz`), mémo 15 min, UPSERT idempotent (`onConflict=(producer_id, starts_at) ignoreDuplicates`).
- **Phase 4** (commit `ba8e6be`) : UI producer `/creneaux` — CRUD slot_rules, modal création/édition, multi-select jours (pills), périodicité 1-4 sem, live preview « ~X créneaux sur 4 semaines », toggle active/inactive, delete avec guard orders.
- **Phase 5** (commit `e09755f`) : UI consumer accordéon par date (grouping Europe/Paris TZ, dropdown exclusif, pattern prêt pour `left=0` → grisé).
- **Phase 6** (commit `4675e20` + migration `20260422500000`) : RPC `create_order_with_items` étendue — check `capacity_per_slot` + `FOR UPDATE` sur le row slot (anti race condition overbooking). Câblage `SlotOption.left` depuis count orders actives côté consumer.
- **Phase 2bis — Créneaux ponctuels + exceptions** (backend `f63cc19` + UI `dae474a`) :
  - Migration `20260422400000_slots_adhoc_and_exceptions.sql` : `slots.rule_id` nullable + `slots.excluded_at timestamptz` + RPC check `excluded_at IS NULL`.
  - 5 server actions : `createAdHocSlotAction`, `deleteAdHocSlotAction`, `excludeSlotAction`, `unexcludeSlotAction`, `bulkExcludeRangeAction`.
  - UI /creneaux en 3 sections verticales (Règles récurrentes / Créneaux ponctuels / Exceptions et absences). Modales create/exclude/bulk. Hard-delete ponctuel bloqué si orders historiques.
  - **Fix UX** (commit `040a209`) : messages `bulkExcludeRangeAction` à 4 branches explicites + refonte `ExcludeSlotModal` avec date picker mandatory (min=today, max=today+90j) + filtrage Europe/Paris + bouton `Bloqué` pour slots avec orders actives.
- **Horizon génération : 4 semaines → 3 mois** (commit `493684e`) — `generateSlotsForProducer(horizonDays = 90)` par défaut, cohérent avec la fenêtre d'affichage consumer.
- **Tests prod validés** : 42 slots matérialisés Vergers de l'Huisne (Phase 1 smoke), Phase 5 accordéon par date OK, Phase 2bis UI 4 tests (création ponctuel, hard-delete bloqué, exclude slot avec blocked flag, bulk range avec skipped count).
- **Reste** : Phase 7 (seed + tests auto). Dette potentielle : rename `slots.actif → slots.active` (mentionnée Phase 6, non bundlée).

### Chantier Stripe Customer MVP ✅ COMPLET (Phases 1-7 en prod)

- **Phase 1** (commit `546fc5e`) : migration `20260422300000_add_stripe_customer_id_to_users.sql` — colonne `users.stripe_customer_id` nullable + index partiel.
- **Phase 2** (commit `7992727`) : helpers `getOrCreateStripeCustomer()` / `deleteStripeCustomer()` dans `lib/stripe/customer.ts`, lazy creation au 1er besoin.
- **Phase 3** (commit `a4b6509`) : purge RGPD côté Stripe Customer — `delete-account-action.ts` nettoie le customer Stripe avant suppression du user, flag `stripe_cleanup_pending` si échec.
- **Phase 4** : page `/compte/paiements`
  - Liste cartes, ajout via SetupIntent + Payment Element, suppression avec confirmation, switch carte par défaut (commit `2e35f14`)
  - UX bouton « Définir par défaut » + flash messages enrichis (commit `d338e48`)
  - Fix scroll modale d'ajout de CB (commit `fe683ba`)
- **Phase 5** (commit `922de5c`) : lien `Moyens de paiement` dans sidebar consumer + card dashboard `/compte` activée (remplace la card `Bientôt disponible`, icône `CardIcon` SVG).
- **Phase 6** (commit `a7eed72`) : attach customer au PaymentIntent + checkbox `Mémoriser cette carte` conditionnelle (consentement explicite RGPD, non cochée par défaut) + `setup_future_usage: 'off_session'` si coché.
  - **Fix auto-default première carte** (commit `8dce6c1`) : nouveau endpoint `/api/stripe/ensure-default-payment-method` appelé post-`confirmPayment` si saveCard et qu'aucune default n'existe — fail-open.
- **Phase 7** (commit `f2fee74`) : sélecteur `CB enregistrée vs nouvelle` au checkout quand l'user a ≥1 PaymentMethod. Mode saved = 1-click via `stripe.confirmCardPayment(pm.id)`. Mode nouvelle = flow PaymentElement standard.
- **Tests prod validés** : état vide · ajout CB · switch default · suppression avec bascule auto · sans CB · avec 1 CB · avec plusieurs CB · mode saved 1-click · toggle nouvelle carte + mémoriser OK.
- **Notes résiduelles** :
  - Bug CB dupliquée via fingerprint Stripe (commit `d9a699a` côté TODO) — à fixer en prévérifiant les PaymentMethods du customer avant attach. Priorité moyenne.
  - Scénario 3DS non testé (flows SCA). À valider avant bascule Stripe Live.

### Désactivation Stripe Link (commit `f367338`)

- Ajout `payment_method_types: ['card']` sur la `PaymentIntent` (la `SetupIntent` l'avait déjà)
- `wallets: { applePay: 'never', googlePay: 'never' }` sur les 2 PaymentElement (`AddCardModal` + checkout)
- Link peut persister en UI via override Dashboard Stripe → désactivation account-wide à faire manuellement

### Fix lien mort `/inscription` dans NavbarPublic (commit `67f2799`)

- `href="/inscription"` → `/auth/inscription` (la vraie route d'inscription consumer, le fallback sur `/inscription` restait dans PUBLIC_PATHS du middleware uniquement)

### Fix force-dynamic pages consumer (commit `983ed8e`)

- `/producteurs/[slug]` et `/producteurs/[slug]/produits/[id]` passent en ƒ Dynamic via `export const dynamic = 'force-dynamic'` + `revalidate = 0`.
- Évite le cache SSR silencieux entre deploys — les nouveaux slots matérialisés, stocks à jour et produits récents apparaissent immédiatement sans redeploy.

### Icône panier navbar + badge (commit `734d20d`)

- `ShoppingBagIcon` inline SVG dans `components/ui/navbar-public.tsx` (à droite, entre prénom et déconnexion)
- Badge rouge avec count d'articles depuis `lib/store/cart.ts`, clic → `/compte/panier`
- Invisible si admin (pas de panier côté back-office)
- Pattern `mounted` anti-hydration flash (SSR count = 0 pendant l'hydratation, puis vrai count côté client)

### Cleanup middleware `/inscription` orpheline (commit `8d4eb27`)

- Retrait de `"/inscription"` de `PUBLIC_PATHS` (la vraie route est `/auth/inscription`, plus de lien mort après fix NavbarPublic `67f2799`).

### Refonte `scripts/seed.ts` (commit `379bdbe`)

- Nouveau modèle `slot_rules` + colonnes producteur récentes (`forme_juridique`, `type_production`)
- `statut='public'` en dur pour les seeds (évite l'invisibilité publique par défaut)
- Aligné sur le chantier Créneaux Phase 7

### Phase 1 backend créneaux ponctuels + exceptions (commit `f63cc19`)

- Migration `20260422400000_slots_adhoc_and_exceptions.sql` : `slots.rule_id` nullable + `slots.excluded_at` + RPC `create_order_with_items` check `excluded_at IS NULL` (couvre ponctuels + exceptions manuelles).
- 5 server actions ajoutées à `app/(producer)/creneaux/actions.ts` (`createAdHoc`, `deleteAdHoc`, `exclude`, `unexclude`, `bulkExcludeRange`).
- Filter consumer page produit : `.is('excluded_at', null)` sur la query slots.
- Apply prod OK.

### Maj TODO + notes dette technique (commits `4feae35`, `d9a699a`, `afdc0eb`)

- Icône panier, Stripe checkout non câblé (résolu par Phase 6/7 Stripe), bug CB dupliquée via fingerprint, désactivation Link account-wide Dashboard Stripe.

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

- **Apply migrations DB restantes en prod** : vérifier que toutes les migrations récentes ont été appliquées (`20260422200000` RGPD, `20260422300000_slot_rules`, `20260422300000_stripe_customer`, `20260422400000_slots_adhoc`, `20260422500000` capacity, `20260422700000` rename slots.actif→active, `20260423000000` rename products.actif→active).
- Onboarder Julien (GAEC du Rheu) — après validation test end-to-end
- Basculer Stripe en mode Live (aujourd'hui en Test) + tester scénario 3DS
- Mettre à jour le webhook Stripe vers `www.terroir-local.fr` (actuellement pointe sur `terr-oir-21cl.vercel.app` — à confirmer, potentiellement déjà fait le 22/04 matin)

## 🔐 Avant lancement public

**Audit tech externe pré-lancement** (~2-4 k€, 1-2 semaines) :

- Pentest complet de l'application
- Review des policies RLS Supabase (toutes les tables)
- Review des server actions sensibles : checkout Stripe, paiements, RGPD, invitation admin
- Review du webhook Stripe et flows de paiement
- Audit des flows Stripe Customer + Connect (commission, payouts)
- Review de la conformité RGPD (registre, consentements, droits)
- Tests de charge sur endpoints critiques (`create-payment-intent`, `create-order-with-items` RPC, `search_producers`)
- Vérification absence d'injections SQL latentes

À déclencher avant le go-live public (avant premiers clients payants). Prévoir avant la bascule Stripe Test → Live.

## 🟡 À faire (non bloquants)

- Mapbox : en attente retour CB
- Twilio SMS : numéro FR à régler
- Vectormagic logo SVG (8,99€)
- Remplacer images Unsplash provisoires par vraies photos producteurs
- Flux invitation : cas "email déjà en base" à détecter proprement côté UX (au-delà de la correction fonctionnelle du Chantier 2)
- Magic link admin via `www.*` : si un flow magic link est ajouté pour les admins plus tard (recovery, invite), il faudra router explicitement via `admin.terroir-local.fr/auth/callback` + ajouter cette URL aux redirect URLs Supabase. Non bloquant aujourd'hui (admin password-only).
- Désactiver Stripe Link dans le Dashboard Stripe (Settings > Payment methods > Link toggle off) — action externe, pas code. Nécessaire si Link persiste à apparaître malgré `payment_method_types: ['card']` côté intents.
- **Marquer automatiquement un lead en `'contacted'` après envoi d'invitation** — la page admin leads `/producer-interests` est livrée (commit `a8ef04a`). Il reste à câbler la transition automatique : quand l'admin envoie une invitation depuis `InviteModal` (pré-rempli via `?invite=<email>`), bump le statut du lead `producer_interests` matching sur email vers `'contacted'` dans la même transaction.
- **Consolidation admin — Phase B5 restante** (Phases B2/B3/B4 livrées dans les commits `eaed1a2` + `5b63283` + `2960b18`) :
  - **B5** : `<TableStatus kind colSpan>` pour les rows loading/empty dans les tables admin. En cours côté TC.
  - Priorité basse (cosmétique, pas de régression fonctionnelle).
- **Doublon timestamp migrations `20260422300000`** — utilisé pour `slot_rules_and_materialized_slots.sql` ET `add_stripe_customer_id_to_users.sql`. Pas bloquant (Supabase ordonne alphabétiquement par filename à timestamp égal) mais convention à corriger un jour pour lisibilité historique. À ranger en dette si on touche les migrations.

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
- **Next.js cache silencieusement les pages SSR par défaut.** Pour les pages avec data live (stock produit, slots matérialisés, listings), il faut expliciter `export const dynamic = 'force-dynamic'; export const revalidate = 0;`. Sinon symptôme : les nouvelles données DB sont invisibles avant redeploy Vercel. Incident du 22/04 : nouveaux slots matérialisés + produits récents n'apparaissaient qu'après redeploy sur `/producteurs/[slug]` et `/produits/[id]` (fix commit `983ed8e`).
- **Pattern défense en profondeur sur les mappings enum** (ex: `STATUS_META`, `ORDER_STATUS_LABEL`) : toujours ajouter une entrée pour TOUS les statuts DB possibles, même si le fetch les filtre normalement. Un refactor futur qui élargit le fetch fera planter le client avec `Cannot read 'bg' of undefined`. Exemple concret : `STATUS_META` dans `/admin/gestion-producteurs` couvre `('pending', 'active', 'public', 'suspended', 'deleted')` même si le fetch filtre `.neq('statut','draft').neq('statut','deleted')`.
- **`FOR UPDATE` sur le row slot dans la RPC `create_order_with_items`** sérialise les réservations concurrentes et empêche l'overbooking quand 2 consumers cliquent simultanément. Impact perf négligeable (ligne petite, opération rare, verrou local), gain anti-overbook critique pour les slots à capacité limitée. Pattern à répliquer pour tout check de capacité concurrente.
- **Parallélisation à risque : éviter que 2 terminaux Claude Code touchent le même fichier en même temps.** Si overlap possible, séquencer les tâches OU fractionner les prompts pour que chaque terminal ait son périmètre de fichiers strict. Incident nuit 22→23/04 : TA (page admin leads) et TC (toggle `showAll`) ont tous les deux modifié `/gestion-producteurs/page.tsx`. Le commit TA a embarqué les modifs TC en cours → commit label « impur » (logique TC livrée sous message TA). État du code correct mais historique git confus et difficile à tracer. Mitigation : planifier les périmètres en amont et fractionner si collision possible.
