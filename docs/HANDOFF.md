# HANDOFF — TerrOir

> À jour le **2026-04-25** après session matinée + après-midi (chantiers Mapbox, webhook decoupling, landings pro/admin, public stats).
> Commits récents : `5dca301` (hover popover conseil), `22bf88e` (centralize geoloc fallback), `c3d62ee`+`83b5326`+`e03734e`+`3ea3555` (4 fixes carte Mapbox), `0761bbe`+`db63440` (webhook decoupling waitUntil), `f3fb891` (MiniMap Mapbox produit), `dcbc747`+`4b9f08d`+`ef6bfe4` (landings publiques pro/admin + middleware rewrites), `2e63dc5`+`0caf4c2`+`b07e8d8` (public stats home + revalidation cache), `6db046c` (carte WebGL markers), `ddb3a02` (Phase C.4 YAGNI clôt).
>
> Objectif : permettre à un Claude frais de reprendre le projet exactement où on en est, juste en lisant ce document (puis `docs/METHODOLOGY.md` et `docs/TODO.md`). Voir `docs/README.md` pour l'index complet de la documentation.

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
- `NEXT_PUBLIC_MAPBOX_TOKEN` (carte producteurs + MiniMap fiche produit)

## Configurations externes critiques

(Configs qui vivent **hors du repo** et doivent être reproduites manuellement lors d'une migration provider / recovery / nouvel environnement.)

- **Supabase Dashboard > Authentication > SMTP** : custom SMTP Resend configuré.
  - `smtp.resend.com:465`, username=`resend`, password=Resend API Key Full Access, sender=`no-reply@terroir-local.fr`.
  - Remplace le built-in Supabase SMTP (rate limit ~3-4/h, non prod).
- **Supabase Dashboard > Authentication > Email Templates** : templates Magic Link et Reset Password utilisent `{{ .RedirectTo }}` (pas `{{ .SiteURL }}`) pour honorer `emailRedirectTo` passé côté server. Type de callback hardcodé (`&type=magiclink&`, `&type=recovery&`) — `{{ .EmailActionType }}` peut renvoyer vide silencieusement.
- **Supabase Dashboard > Authentication > URL Configuration > Redirect URLs** : doit inclure :
  - `https://www.terroir-local.fr/auth/callback`
  - `https://admin.terroir-local.fr/auth/callback`
  - `https://pro.terroir-local.fr/auth/callback` (si flow magic link étendu au producer)
- **Supabase Dashboard > Authentication > URL Configuration > Site URL** : `https://www.terroir-local.fr`.
- **OVH Zone DNS `terroir-local.fr`** : SPF inclut `include:mx.ovh.com` (MX OVH) et `include:amazonses.com` (Resend via SES) pour permettre Resend → boîtes `@terroir-local.fr` sans rejet MX interne.
  - Enregistrement complet : `v=spf1 include:mx.ovh.com include:amazonses.com ~all`.
- **Resend Dashboard** : domaine `terroir-local.fr` vérifié (DKIM + SPF + MX + DMARC). Clé API Full Access utilisée par le code app (`RESEND_API_KEY` Vercel) ET par le SMTP custom Supabase.
  - **Rotation de cette clé = 2 endroits en parallèle** : (1) Vercel `RESEND_API_KEY`, (2) Supabase Dashboard > Auth > SMTP custom. Oublier le 2e = Supabase continue silencieusement avec la clé révoquée.
- **Vercel Dashboard > Environment Variables** : toutes les clés listées dans la section « Variables d'env critiques » ci-dessus.
- **Stripe Dashboard** :
  - Mode Test actuel → Live à basculer avant go-live.
  - Webhook endpoint à pointer sur `https://www.terroir-local.fr/api/stripe/webhook` pour la prod.
  - Payment methods > Link : à désactiver account-wide avant lancement.
- **Mapbox account** : token `NEXT_PUBLIC_MAPBOX_TOKEN` configuré sur Vercel **Production + Preview**. Restrictions URL configurées côté Mapbox account sur les 4 domaines : `https://www.terroir-local.fr/*`, `https://pro.terroir-local.fr/*`, `https://admin.terroir-local.fr/*`, `https://terroir-local.fr/*`, plus `http://localhost:3000/*` pour le dev local. Sans ces restrictions URL, le token serait utilisable depuis n'importe quel domaine si exfiltré (token public bundlé côté client).

## Chantiers majeurs clos

(Résumé ; détails chronologiques complets dans `docs/CHANGELOG.md`.)

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
- **Edge case panier** : validation DB au load panier + re-check au checkout + RPC (3 couches défense en profondeur), banner `StaleItemsBanner` dismissable, auto-remove des fatals (producer/product/slot), auto-adjust stock_insufficient.
- **Tests vitest étendus** : 77 tests au total couvrant slots, HMAC opt-out, cookie-domain, formatters date/currency.
- **Magic link admin** : flow universel sur `/connexion` (password + magic) avec `emailRedirectTo` routé server-side selon admin vs autres. Config externe : templates Supabase migrés à `{{ .RedirectTo }}`, `admin.terroir-local.fr/auth/callback` ajouté aux Redirect URLs.
- **Custom SMTP Resend** : Supabase Auth envoie via Resend SMTP (plus de rate limit built-in). SPF OVH complété pour permettre Resend → boîtes `@terroir-local.fr`.
- **Auto-bump lead `'contacted'` à l'envoi d'invitation admin** (commit `dbe6360`) : UPDATE conditionnel gaté sur `emailResult.ok` dans `invite/route.tsx` ; match email case-insensitive dans `producer_interests` en statut `'new'`. Corrige au passage un bug latent d'INSERT inconditionnel qui créait un doublon fantôme.
- **Pages landing Stripe Connect onboarding** (commit `e93043e`) : `app/(producer)/connect/done/page.tsx` (return_url, auto-redirect `/parametres` 3s) + `app/(producer)/connect/refresh/page.tsx` (refresh_url, bouton « Reprendre l'onboarding »). Débloque le flow onboarding producer Stripe en prod.
- **Robustesse flow Resend + invitation producer** (commit `ef7f10b`) : logging `[EMAIL_SEND_FAIL]` grep-able Vercel, `renderEmail` wrappé try/catch, appel `sendTemplate` wrappé côté route, tokens hoistés AVANT INSERT `producer_invitations`, fail-fast `RESEND_FROM_EMAIL` au module-load.
- **Chantier « Conseil de l'éleveur »** (commits `ffea6b2` + `07a65d4` + migrations `20260423100000`/`110000`/`120000`) : colonne `producers.prenom_affichage` (1-50 char) REQUIRED côté wizard + édition onboarding, colonne `products.conseil` (280 char) côté éditeur producer, post-it manuscrit affiché côté consumer sur la fiche produit (tooltip desktop + post-it mobile). Défense `prenom_affichage=null` pour producers `deleted`. Migrations appliquées prod OK (add column nullable → backfill depuis `users.prenom` → SET NOT NULL).
- **Hotfix INSERT `prenom_affichage`** (commit `95d0572`) : placeholder `"À compléter"` ajouté sur les 3 INSERT runtime de `producers` (`create-account.ts`, `login-and-upgrade.ts`, `invitation/page.tsx` SSR) + seed aligné sur `p.prenom`. La reprise d'onboarding traite `"À compléter"` comme vide. Débloque l'Étape 1 du wizard après apply de la migration C NOT NULL en prod.
- **Conseil éleveur en icône cliquable popover (cross-device)** (commits `aa15782` + `5dca301`) : remplacement du post-it permanent par une icône discrète à côté du nom produit. Tap mobile → popover. Hover desktop → open via détection `matchMedia('(hover: hover) and (pointer: fine)')`. Fiche plus épurée + découvrabilité préservée.
- **Centralize fallback géoloc Le Mans** (commit `22bf88e`) : `lib/geo/fallback.ts` exposant `GEOLOC_FALLBACK` + helper. 8 hardcodes Le Mans migrés sur 6 fichiers. Régionalisation future en 1 endroit.
- **Carte Mapbox stabilisée — 4 fixes layout/canvas** (commits `c3d62ee` + `83b5326` + `e03734e` + `3ea3555`) : pattern `h-full w-full` (pas `absolute inset-0`) + `ResizeObserver` + pas de `bg-*` sur le wrapper. Voir `LESSONS.md` section « Mapbox / WebGL » pour le détail.
- **Markers carte WebGL** (commit `6db046c`) : couche `circle` Mapbox + GeoJSON FeatureCollection (1 layer pour N producers, fini les N nœuds DOM SVG). Marker user en pulsing dot custom layer animé via `requestAnimationFrame`.
- **Découplage notifications webhook Stripe** (commits `0761bbe` deps + `db63440` fix) : Resend + Twilio basculés en background via `@vercel/functions waitUntil()`. Ack 200 immédiat à Stripe. Résout les 13% de timeout webhook observés sur le Dashboard Stripe.
- **MiniMap Mapbox sur fiche produit** (commit `f3fb891`) : composant partagé `components/ui/mini-map.tsx` réutilisable, fallback gracieux si coords absentes. Embarque le pattern Mapbox propre (cascade hauteurs + ResizeObserver + pas de bg).
- **Pages landing publiques `pro` + `admin`** (commits `dcbc747` + `4b9f08d` + `ef6bfe4`) : `/pro-accueil` + `/admin-accueil` (chrome public, hero + value prop + CTA `/connexion`). Middleware rewrite `pro.*/` → `/pro-accueil` et `admin.*/` → `/admin-accueil` pour visiteurs anonymes uniquement (sessions actives → dashboard). 301 cross-subdomain bonus depuis `www`.
- **Section « Stats publiques » home consumer** (commits `2e63dc5` + `0caf4c2` + `b07e8d8`) : Server Component `components/ui/public-stats.tsx` + helper `lib/stats/public-stats.ts` (counts producers/orders/products, cache 5 min via `unstable_cache`, fail-open par count). Skip individuel par stat sous seuil minimum (5/10/15) pour éviter l'effet « projet vide ». Cache invalidé via `revalidateTag('public-stats')` dans le webhook Stripe sur événement `confirmed`.
- **Phase C.4 `SuccessConfirmation` clôturée YAGNI** (commit `ddb3a02`) : inspection a confirmé `ConfirmationClient` déjà extrait, 1 call site, 0 duplication. Décision YAGNI tracée. Item retiré du TODO.

## Chantiers en cours

_(rien en cours)_

## Dettes techniques connues

- **Setup CLI Supabase pour migrations auto** : aujourd'hui apply manuel via SQL Editor. À automatiser si fréquence de migrations augmente.
- **Framework de tests** : vitest couvre slots, HMAC opt-out, cookie-domain, formatters, fetch-public, promote-to-public, maskEmail (90+ tests). Reste à étendre à d'autres helpers critiques si besoin.
- **Phase B5 TableStatus** : livrée (commit `b89160f`), mais à vérifier que toutes les tables admin l'utilisent.
- **Stripe Link account-wide** : à désactiver manuellement dans Dashboard Stripe (action externe).
- **Webhook Stripe `account.updated` manquant** : `producers.stripe_account_id` est set AVANT onboarding complété côté Stripe → le badge « ✓ Compte Stripe connecté » sur `/parametres` peut être un faux positif si le producer abandonne à mi-course. Chantier : ajouter handler webhook qui synchronise un flag `stripe_onboarding_completed` (ou équivalent) avec `charges_enabled` / `details_submitted` côté Stripe. Bloquant avant go-live public si on veut un statut Connect fiable.
- **Mentions légales footer pro** : page absente, le footer pro pointe sur un href mort. À créer une fois le contenu juridique disponible (action externe Romain — pré-requis hors code).
- **`PublicLayout` connexion sous-domaines** : la page `/connexion` rendue sur `pro.terroir-local.fr` et `admin.terroir-local.fr` doit adapter son chrome (navbar/footer) selon le hostname pour cohérence branding. Détection via `headers().get('host')` côté server component. À traiter dès qu'un terminal libre est dispo.

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

1. **Lire `docs/README.md`** d'abord (routeur vers l'ensemble de la doc).
2. **Lire `docs/HANDOFF.md`** (ce fichier) en entier.
3. **Lire `docs/METHODOLOGY.md`** pour la méthode de collaboration.
4. **Lire `docs/TODO.md`** pour la priorisation forward-looking. Historique chronologique dans `docs/CHANGELOG.md`, leçons transversales dans `docs/LESSONS.md`.
5. Consulter les **derniers commits git** (`git log --oneline -20`) pour le contexte récent.
6. **Pas d'empilement** : max 3 chantiers en vol en parallèle (TA/TB/TC), périmètres de fichiers disjoints.
7. Chaque chantier suit le pattern : **inspection → validation → code → auto-QA (`tsc --noEmit` + `npm run build`) → commit normé → push → rapport**.
8. Toute migration DB doit être **rappelée explicitement à Romain en fin de rapport** pour apply manuelle via Supabase Studio SQL Editor.
9. Toute modif auth / RLS / Stripe webhook / RGPD → demander validation explicite avant push.
