# CHANGELOG — TerrOir

Historique des chantiers et commits structurants. Ordre antichronologique (plus récent en haut).

Pour les leçons apprises transversales, voir [`LESSONS.md`](./LESSONS.md).
Pour les priorités forward-looking, voir [`TODO.md`](./TODO.md).

---

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
