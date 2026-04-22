# HANDOFF — TerrOir

> À jour le **2026-04-23** après commit `7fdc494` (Phase C.2 MetricCard).
>
> Objectif : permettre à un Claude frais de reprendre le projet exactement où on en est, juste en lisant ce document (puis `METHODOLOGY.md` et `TODO.md`).

## Projet : TerrOir

- **Description** : marketplace circuit court Sarthe — vente directe éleveurs/producteurs ↔ consumers, retrait à la ferme (pas de livraison domicile).
- **Owner** : Romain Lubin (`lubin.rom@gmail.com`).
- **Statut** : MVP fonctionnel en prod sur Stripe Test, **pas encore lancé publiquement**. Bascule Live + audit externe prévus avant go-live.
- **Repo** : https://github.com/RomLub/TerrOir
- **Prod URLs** :
  - `www.terroir-local.fr` (consumer)
  - `pro.terroir-local.fr` (producer)
  - `admin.terroir-local.fr` (admin)

## Stack technique

- **Next.js 14 App Router** + TypeScript strict
- **Supabase** (Postgres + Auth + RLS + Storage)
- **Stripe** Connect (producers) + Customer MVP (consumers CB enregistrées)
- **Resend** (emails transactionnels + RGPD opt-out)
- **Vercel** (deploy)
- **Vitest** (tests unitaires, aujourd'hui limités aux helpers slots)

## Architecture haut niveau

```
app/
  (public)/     pages publiques consumer (home, /producteurs, /produits, /auth/inscription, /connexion, RGPD)
  (consumer)/   pages protégées consumer (/compte, /panier, /checkout, /confirmation, /paiements)
  (producer)/   pages producer (/tableau-de-bord, /creneaux, /catalogue, /commandes, /onboarding)
  (admin)/     back-office admin (/gestion-producteurs, /producer-interests, /suivi-commandes, /avis)
  api/          routes API (stripe, orders, cron, admin invite, opt-out)

lib/
  supabase/     clients browser/server/admin, helpers cookies, session
  stripe/       customer, payouts, connect, webhooks
  slots/        generate, format-slot-time, validators (+ vitest)
  rgpd/         opt-out tokens HMAC
  format/       date.ts, currency.ts (helpers admin consolidation Phase A)
  producers/    fetch-public.ts (helper centralisé statut='public')
  resend/       templates email React
  auth/         roles, session helpers

components/
  ui/          composants partagés (badges, modals, tabs, page header, table status, status panel, metric card, role-switcher, navbar, sidebar)

supabase/
  migrations/  SQL versionnés timestamp-prefixed

scripts/
  seed.ts, seed-producers.ts, cleanup-seed.ts
```

## DB schema principal

### Tables critiques

- **`auth.users`** (Supabase Auth)
- **`public.users`** : `id`, `email`, `prenom`, `nom`, `telephone`, `roles text[]` (cumulables), `stripe_customer_id`, `deleted_at`, `deleted_reason`, `statut` (avec valeur `'deleted'` pour anonymisation)
- **`public.admin_users`** : lookup des users admin (id + métadonnées) — remplace le rôle `admin` dans `users.roles` (exclusivité mutuelle via trigger)
- **`public.producers`** : `slug`, `nom_exploitation`, `statut` ∈ (`draft`, `pending`, `active`, `public`, `suspended`, `deleted`), `forme_juridique`, `type_production`, photos, bio, coordonnées
- **`public.products`** : `producer_id`, `nom`, `prix`, `stock`, `active`, `photos`
- **`public.slot_rules`** : `producer_id`, `days_of_week int[]`, `periodicity_weeks` (1-4), `start_time`, `end_time`, `slot_duration_minutes`, `capacity_per_slot`, `active`
- **`public.slots`** : `producer_id`, `rule_id` (nullable pour ponctuels), `starts_at`, `ends_at`, `capacity_per_slot`, `active`, `excluded_at` (pour exceptions/absences)
- **`public.orders`** : `consumer_id`, `producer_id`, `slot_id`, `statut`, `montant_total`, `montant_producer`, `montant_platform`
- **`public.order_items`** : `order_id`, `product_id`, `quantite`, `prix_unitaire`
- **`public.notifications`** : centralisation in-app
- **`public.producer_interests`** : leads B2B (formulaire `/devenir-producteur` + opt-out HMAC)
- **`public.producer_invitations`** : tokens admin → prospect (flow invitation)

### RPCs clés

- **`create_order_with_items`** : validation slot (`active`, `excluded_at IS NULL`, `capacity FOR UPDATE` anti race condition) + stock + commission.
- **`search_producers`** : recherche public, hardcode `statut='public'`.
- **`delete_user_account`** : RGPD hard delete (logique hybride selon présence d'`orders`).
- **`opt_out_producer_interest`** : opt-out auto-généré via HMAC.

### RLS policies

Strictes, chaque table a ses policies SELECT/INSERT/UPDATE/DELETE selon le rôle (owner / admin / public). **Toujours filtrer `statut='public'` sur les pages publiques qui utilisent `createSupabaseAdminClient` (service_role bypasse RLS).**

## Environnement

- **Vercel projet** : `terr-oir-21cl`
- **Supabase** : projet TerrOir
- **Stripe** : mode Test actuellement, bascule Live prévue avant lancement
- **Resend** : domaine `terroir-local.fr` vérifié (DKIM + SPF + MX + DMARC posés)
- **Domaine** : OVH + Vercel (branchement 21/04/2026)

## Variables d'env critiques (noms seulement)

Gérées via Vercel Dashboard. Jamais dans le code.

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY` (test)
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (test)
- `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `OPT_OUT_TOKEN_SECRET` (RGPD opt-out HMAC)
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_PRODUCER_URL`

## Chantiers majeurs clos

(Résumé ; détails dans `TODO.md` section « ✅ Fait ».)

- **Chantier 1 — Refactor rôles** : `admin_users` + `users.roles text[]` cumulables, exclusion mutuelle via triggers.
- **Chantier 2 — Flux invitation producteur** (6 phases) : admin invitation → onboarding 3 étapes → validation admin → auto-promotion public au 1er produit.
- **Chantier 4 — Isolation cookies admin vs www/pro** : `sb-admin-auth-token` isolé, `sb-*` partagé `.terroir-local.fr`.
- **Chantier 5 — Middleware simplifié** : plus de redirect forcé `/compte` → pro pour dual-role users.
- **Chantier 6 — Switcher consumer/producer** : composant `role-switcher` dans sidebars.
- **Chantier F — Mot de passe oublié** : flow complet `/mot-de-passe-oublie` + template Supabase fixé.
- **RGPD suppression compte** : hard/soft delete hybride selon orders, UI `/compte/profil`.
- **RGPD opt-out leads** : token HMAC 2-step anti email-scanner + standalone recovery form.
- **Créneaux personnalisables** (Phases 1→7 + 2bis ponctuels/exceptions) : schema `slot_rules`, générateur TZ-aware (Europe/Paris), UI producer CRUD, UI consumer accordéon, RPC capacity FOR UPDATE, horizon 90j, 27 tests vitest.
- **Stripe Customer MVP** (Phases 1→7) : customer lazy-create, page `/compte/paiements`, attach checkout, `save_card` consentement explicite, auto-default, sélecteur CB enregistrées 1-click, fingerprint dedupe.
- **Rename `actif` → `active`** (slots + products) : schema principal 100% anglais pour booléens techniques.
- **Consolidation admin** : Phase A (formatters `formatDateFr`, `formatEuro`), Phase B (badges, modals, filter tabs, page header, table status), Phase C.1 (StatusPanel), Phase C.2 (MetricCard).
- **Helper `fetchPublicProducerBySlug`** : centralisation filtre `statut='public'` pour pages publiques.
- **Page admin leads** : `/producer-interests` + toggle `showAll` sur `/gestion-producteurs` + lien « Inviter » pré-rempli.
- **Force-dynamic** sur pages consumer data-live (évite cache SSR silencieux).
- **Fingerprint dedupe Stripe** : prévention CB dupliquées.

## Chantiers en cours

- **Magic link admin** (TA) — en cours, changements unstaged sur `app/(public)/connexion/actions.ts` + `app/(public)/connexion/page.tsx`. Objectif : flow magic link pour admins (recovery / invite). Impliquera ajout de `admin.terroir-local.fr/auth/callback` aux redirect URLs Supabase.
- **Consolidation admin — Phase C.3 / C.4** (TC, faible priorité) : audit fait, non prioritaire. Table action buttons + success confirmation restants.

## Dettes techniques connues

- **Doublon timestamp migration `20260422300000`** : utilisé pour `slot_rules_and_materialized_slots.sql` ET `add_stripe_customer_id_to_users.sql`. Ordonnancement alphabétique OK en pratique, mais convention à corriger un jour.
- **Setup CLI Supabase pour migrations auto** : aujourd'hui apply manuel via SQL Editor. À automatiser si fréquence de migrations augmente.
- **Framework de tests** : vitest installé mais uniquement utilisé sur `lib/slots/`. Pas de tests sur le reste du codebase.
- **Phase B5 TableStatus** : livrée (commit `b89160f`), mais à vérifier que toutes les tables admin l'utilisent.
- **Marquer auto lead `'contacted'`** après envoi d'invitation : transition non câblée, à faire dans la même transaction que `InviteModal`.
- **Stripe Link account-wide** : à désactiver manuellement dans Dashboard Stripe (action externe).
- **Edge case panier** : si producer passe `'suspended'` entre ajout panier et consultation → lien mène à un 404. Pas une fuite, juste UX mineur.

## Users de test

(Emails uniquement ; jamais de mots de passe dans ce document.)

- `admin@terroir-local.fr` — admin root
- `test-phase3-newuser@mailinator.com` — consumer + producer `statut='public'`
- `test-chantier5-draft@mailinator.com` — user draft
- `test-phase4-resume@mailinator.com` — reprise onboarding mid-wizard
- Leads seed : `*@seed.terroir-local.fr` (cleanup via `scripts/cleanup-seed.ts`)

## Décisions produit structurantes

- **Pas d'adresses consumer** (retrait 100% à la ferme).
- **Pas de livraison domicile**.
- **Stripe Customer** oui (CB enregistrée pour commandes récurrentes, consentement explicite RGPD).
- **Créneaux personnalisables** par producer : règles récurrentes + ponctuels + exclusions, horizon 90 jours.
- **RGPD suppression** :
  - **users** : hard delete complet si sans orders, sinon anonymisation soft (`statut='deleted'`).
  - **producers** : hybride — produits hard-delete, producer anonymisé `statut='deleted'`.
- **RGPD opt-out leads** : hard-delete, flow 2-step anti email-scanner, token HMAC 7 jours.
- **Commission plateforme** : configurée en DB (vérifier `producers.commission_rate` ou RPC `create_order_with_items` selon évolution).
- **Auth** :
  - `www` + `pro` : session partagée via cookie domain `.terroir-local.fr`.
  - `admin` : session isolée (cookie `sb-admin-auth-token`, pas de domain).

## Contexte humain : Romain

- Indépendant iOS developer + side projects (quantitative trading, desktop apps, freelance).
- Ne s'identifie pas comme dev « formel » (pas de credentials CS).
- Utilise Claude Code comme son équipe dev.
- Français, INTP-A, déterministe Spinoza.
- Direct, casual, pas de patience pour hedging / elaboration inutile.
- Décisions produit rapides et cohérentes.
- **Refuse de se voir suggérer des pauses** (« je décide »).
- Apprécie les arbitrages explicites en 3 options max avec trade-off par option.

## Comment reprendre ce projet

Pour un Claude frais qui hérite du projet :

1. **Lire `HANDOFF.md`** (ce fichier) en entier.
2. **Lire `METHODOLOGY.md`** pour la méthode de collaboration.
3. **Lire `TODO.md`** pour la priorisation actuelle et l'historique détaillé.
4. Consulter les **derniers commits git** (`git log --oneline -20`) pour le contexte récent.
5. **Pas d'empilement** : max 3 chantiers en vol en parallèle (TA/TB/TC), périmètres de fichiers disjoints.
6. Chaque chantier suit le pattern : **inspection → validation → code → auto-QA (`tsc --noEmit` + `npm run build`) → commit normé → push → rapport**.
7. Toute migration DB doit être **rappelée explicitement à Romain en fin de rapport** pour apply manuelle via Supabase Studio SQL Editor.
8. Toute modif auth / RLS / Stripe webhook / RGPD → demander validation explicite avant push.
