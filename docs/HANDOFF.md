# HANDOFF — TerrOir

> À jour le **2026-04-27 (fin de journée, post-session complète)**. Suite directe de la session 26/04 nuit qui a couvert 3 bugs critiques orders/paiement (P0 stock non restauré, P2 commande fantôme 3DS, P1 idempotence retentative paiement) + extension massive de la couverture vitest sur les routes orders + finalisation navbar SSR-aware (`isAdmin` + `isProducer`). Suite session 27/04 matin : chantier P1 robuste résurrection paiement avec RPC SQL atomique + refund Stripe automatique + audit_logs Phase 2 payment events. **Suite session 27/04 après-midi/soir** : (1) chantier alignement routes orders TA (refund + cron-timeout), (2) chantier pré-fetch SSR ProducerLite TC (élimination flash placeholder ProducerLayout), (3) push back TB auto-bump lead onboarded (chantier déjà livré matin), (4) refonte design system + homepage consumer via Claude Design (~3h, 19 blocs DS validés + bundle handoff vers terminal CC pour implémentation Next.js sur branche `feature/home-refonte`).
>
> Commits récents (15 derniers) :
> - `1ef2d0d` test+fix(cron) : cron order-timeout durci avec check error UPDATE + drift detection + revalidateTag batch + 6 tests (TA)
> - `9ed9b0d` feat(navbar) : pré-fetch SSR ProducerLite — élimination flash placeholder ProducerLayout (TC, 4 fichiers, +109/-40)
> - `6bcc185` test+fix(refund) : refund admin route alignée sur patterns canoniques (assertTransition strict 409 + revalidateTag + 15 tests) (TA)
> - `5a572b2` feat(orders) : UI consumer revival_blocked + extension filtre payment_failed → revival_blocked_* (commit 3/3 chantier P1 robuste)
> - `9d6cb13` fix(webhook) : refund Stripe automatique si résurrection bloquée + audit logs payment events complets (commit 2/3)
> - `6b4a835` feat(orders) : RPC atomique résurrection avec check stock + slot + helper logPaymentEvent (commit 1/3)
> - `81b3c1a` test(orders) : vitest sur confirm + complete routes (37 tests)
> - `49c0f1b` fix(webhook) : idempotence retentative paiement après 3DS-fail (résurrection cancelled→pending)
> - `280ff69` test(cancel) : vitest sur cancel order route (27 tests)
> - `f32d083` test(cron) : vitest sur cron order-timeout (12 tests + 2 it.todo)
> - `56ab733` feat(orders) : exclusion UI commandes payment_failed + badge admin distinct (P2 partie 2)
> - `9482e5b` fix(webhook) : pose cancellation_reason payment_failed + guard rétrogradation (P2 partie 1)
> - `4584139` fix(orders) : trigger DB restauration stock à l'annulation (P0)
> - `799bf71` fix(refund) : pose cancellation_reason='admin_refund'
> - `f57d5ad` test(orders) : vitest matrice transitions state machine (89 tests)
>
> 🟢 **Chantiers majeurs clos cette session (full 27/04)** :
> - **3 bugs 🔴 critiques résolus** : P0 stock non restauré, P2 commande fantôme 3DS, P1 idempotence retentative paiement (matin).
> - **Chantier P1 robuste** (matin 27/04) : RPC SQL atomique `revive_order_with_stock_check` + refund Stripe automatique sur paths bloqués + audit_logs Phase 2 payment events (6 events) + UI consumer page confirmation + extension filtre `isVoidOrderRow`. Bug stock résiduel détecté en validation P1 entièrement résolu.
> - **Chantier alignement routes orders TA** (après-midi 27/04) : 2 commits `6bcc185` + `1ef2d0d` qui recolent les 3 dernières dettes flag par TB (`799bf71` + `f32d083`). Refund admin et cron-timeout alignés sur les patterns canoniques (assertTransition strict 409 + revalidateTag batch + tests vitest exhaustifs). 432/432 tests verts, 0 `it.todo` restant.
> - **Chantier pré-fetch SSR ProducerLite TC** (après-midi 27/04) : commit `9ed9b0d` qui fusionne les 2 lookups producers en 1 SELECT enrichi côté SSR. `ProducerLayout` initialise `producer` non-null dès le premier render — placeholder « — » devient inatteignable au hard refresh d'un user producer. Patch chirurgical : `ProducerLite` déplacé en client-safe partagé dans `lib/auth/types.ts`, invariant `isProducer === (producerLite !== null)`, fail-safe préservé. Hors périmètre `app/layout.tsx` et `ProducerLayout.tsx` non touchés.
> - **Refonte design system + homepage consumer** (après-midi 27/04) : première utilisation de **Claude Design** (Anthropic Labs research preview). Session de ~3h sur 19 blocs DS validés (Colors terra primary + Type Cormorant/Inter + Spacing/Radii/Elevation + Identité Logo lockups + Components atomic & composés). Homepage consumer maquettée desktop + mobile 375px en 8 sections cohérentes. Logo officiel Romain (8 paths vectoriels Inkscape) intégré. Bundle handoff `design_handoff_terroir.zip` exporté vers terminal CC (39 fichiers, ~21KB). Implémentation Next.js en cours sur branche `feature/home-refonte` (terminal TT, plan 7 pushes validé). Phase 2 (fiches produit, panier/checkout, UI kits producer & admin) reportée à sessions ultérieures.
> - **Couverture vitest passe de 207 à 432+ tests** (+108%) : state machine matrice 6×6, cron timeout, cancel route, confirm + complete routes, handle-payment-failed, handle-payment-succeeded, log-payment-event, refund admin (TA), get-initial-user-payload (TC).
> - **Navbar SSR-aware finalisée** : pré-fetch `isAdmin` puis `isProducer` (matin) puis `producerLite` complet (après-midi via TC). Type `InitialUserPayload` factorisé dans `lib/auth/types.ts`. Plus aucun flash CTA ni placeholder « — » au hard refresh.
>
> **Configurations externes Stripe Dashboard validées (mode Test)** :
> - Webhook URL pointe sur `https://www.terroir-local.fr/api/stripe/webhook` ✅
> - Stripe Link off account-wide ✅
> - Test 3DS scénarios complete + fail validés (carte `4000 0027 6000 3184`) ✅
> - Retentative paiement 3DS-fail + carte 4242 validée end-to-end ✅
>
> **Validations prod end-to-end** : P0 + P2 + P1 simultanés sur commande TRR-7235E (carte 4000-0027-6000-3184 puis 4242-4242-4242-4242). P1 robuste validé sur commande TRR-KKKDL (stock Salade mesclun 50→47 + audit_logs `order_payment_failed` + `order_revival_succeeded`).
>
> **Migrations apply confirmées prod** : `20260424000000` (Stripe Connect flags), `20260427100000` (audit_logs), `20260427200000` (trigger stock à l'annulation), `20260427300000` (RPC résurrection avec check stock + slot).
>
> **En cours sur branche feature** : `feature/home-refonte` (terminal TT, implémentation Next.js de la home consumer refondue depuis bundle Claude Design). Pas encore mergée sur master. Preview Vercel attendue. 7 pushes prévus (tokens DS + logo source + composants atomic + composants composés + navbar/footer + homepage finale).
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
- **Supabase Dashboard > Authentication > Email Templates** : 5 templates customisés via Dashboard (Magic Link, Confirm Signup, Reset Password, Change Email, Invite User) avec header logo TerrOir sur fond crème (cohérent avec emails Resend).
  - **Magic Link** (post-PKCE Option B `09c219d`) : utiliser `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=magiclink`. Le `RedirectTo` inclut déjà `/auth/callback` côté server. Le callback consomme le token via `verifyOtp` (pas de cookie `code_verifier` PKCE nécessaire).
  - **Reset Password** (post-`5ff9394`) : utiliser `${SITE_URL}/reinitialiser-mot-de-passe?token_hash={{ .TokenHash }}&type=recovery`. La nouvelle page dédiée affiche un form « nouveau mot de passe » avant tout login automatique.
  - **Confirm Signup, Change Email, Invite User** : non encore validés visuellement end-to-end (templates rendus mais flow non testé en situation réelle).
  - **Anti-pattern à éviter** : `{{ .RedirectTo }}?token_hash={{ .TokenHash }}` quand `emailRedirectTo` côté server embarque déjà une query string — la concat naïve produit deux `?` dans l'URL → `URLSearchParams` ne trouve plus `token_hash`. C'est ce bug qui a motivé l'Option B (le redirect deep-link transit via cookie HttpOnly cross-subdomain plutôt que via la query string `emailRedirectTo`). Cf `LESSONS.md` section « Auth & sessions ».
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
  - Mode Test actuel → Live à basculer avant go-live (cf `TODO.md` bloquants lancement).
  - Webhook endpoint mode Test : pointe sur `https://www.terroir-local.fr/api/stripe/webhook` ✅ (validé 26/04 via Dashboard). Events souscrits : `payment_intent.succeeded`, `payment_intent.payment_failed`, `account.updated`, `payout.paid` (alignés avec le handler `app/api/stripe/webhook/route.tsx`).
  - **Webhook endpoint mode Live** : à créer au moment de la bascule Test → Live (recopier la même URL côté Live).
  - Payment methods > Link : désactivé account-wide ✅ (vérifié 26/04 dans Settings > Paiements > Moyens de paiement).
  - Test 3DS scénarios validés : carte `4000 0027 6000 3184` complete + fail + retentative avec carte 4242 (validé end-to-end 26-27/04 sur 3 commandes successives TRR-DNW87, TRR-AM2UN, TRR-7235E, TRR-KKKDL).
  - **Branding Connect** : non configuré (flag pour investigation dédiée future, cf `TODO.md`).
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
- **3D pin images couleur terra sur producer markers** (commit `23d4fa0`) : couche `symbol` Mapbox + image pin canvas 2D générée côté browser (gradient terra-300→500, hover terra-500→700, inner dot blanc, ombre portée). Légende `/carte` mise à jour. Brand cohérent.
- **Hotfix carte split hover layer** (commit `11b914e`) : Mapbox refuse `feature-state` dans `icon-image` (layout). Fix : 2 layers `symbol` superposés (base + hover filtré sur feature-state). Incident embarqué : 3 renames TA chantier connexion via working tree partagé — bisect-unfriendly mais HEAD master OK. Pattern documenté dans `LESSONS.md` Parallélisation.
- **Helper pin image partagé `lib/maps/pin-image.ts`** (commit `78e0306`) : generator canvas 2D paramétrique consommé par `/carte` ET `components/ui/mini-map.tsx`. Cohérence brand cross-pages, fini la duplication du code canvas.
- **Couverture complète invalidation `public-stats`** (commits `b07e8d8` webhook order confirmed + `e16459d` 1ère vague + `af44d64` centralize promote helper + `90bf3e3` admin suspend/reactivate + `c0357f5` RGPD anonymisation) : tous les chemins de transition qui impactent les counts producers/orders/products visibles invalident désormais le tag `public-stats`. Helper centralisé `lib/stats/revalidate.ts`. 3 tests vitest sur `promoteProducerToPublicIfActive`. La home consumer reflète les changements sans attendre l'expiration cache 5 min.
- **Layout `/connexion` adaptatif au sous-domaine** (commit `2652e4d`) : `app/connexion/layout.tsx` détecte le hostname via `headers().get('host')` et injecte le chrome correspondant (navbar/footer www, pro ou admin). Sortie de `/connexion` du route group `(public)` (renames `app/(public)/connexion/*` → `app/connexion/*`). Bonus : redirect post-login devient host-aware + double `<main>` retiré.
- **Helper `lib/auth/post-login-redirect.ts`** (commit `797c89f`) : 3 niveaux d'API exposés (`loadRoleSnapshot()`, `canonicalPostLoginUrl(role)` cross-domain, `localPostLoginPath(role)` same-host). `loginAction` refactorisée pour consommer le helper. Voir `LESSONS.md` section « Post-login redirect cross-domain » pour le pattern complet.
- **Magic link callback rôle-aware cross-domain** (commit `2e1a3e5`) : `app/auth/callback/route.ts` utilise un cookie buffer (`cookiesToWrite[]`) attaché à la response finale après résolution du rôle, permettant la redirect cross-domain selon rôle (admin → admin., producer → pro., consumer → www.).
- **Redirect immédiat des users déjà loggés sur `/connexion`** (commit `8cb6114`) : check session côté server component → `redirect(canonicalPostLoginUrl(role))` immédiat. Évite l'écran de login inutile. Dette flaggée : `?redirectTo` non encore lu par `loginAction` (clos commits `53f8f6a` + `d4088d5`).
- **`?redirectTo` honoré par password login + magic link** (commits `53f8f6a` + `d4088d5`) : middleware pose `?redirectTo=<path>` sur les routes protégées → `loginAction` (mdp) ET `requestMagicLinkAction` (magic) propagent désormais l'intention. Magic link : path embarqué en query string sur `emailRedirectTo`, callback (`/auth/callback`) délègue à `canonicalPostLoginUrlWithRedirect` (rôle dicte le host, path validé sinon fallback canonique). Helpers ajoutés à `lib/auth/post-login-redirect.ts` : `isValidRedirectPath`, `resolvePostLoginPath`, `canonicalPostLoginUrlWithRedirect`. Validation defense-in-depth côté action ET côté callback (un email forgé `?redirectTo=//evil.com` retombe sur le path canonique). Le callback `/auth/callback` supporte les 2 formats Supabase : `?code=` PKCE et `?token_hash=&type=` OTP.
- **Logo SVG vectoriel + variants** (commit `51d409b` + 3 fixes layout `0fd3f54`/`cb3ebab`/`71905d2`) : `components/ui/logo.tsx` étend les variants à 3 (`full` / `icon` / `mono`) × 4 sizes (`sm` / `md` / `lg` / `xl`). Asset PNG legacy (`Logo_TerrOir_transparent.png`) retiré au profit du SVG (`Logo_TerrOir.svg`). Pattern leçon : après 3 itérations infructueuses sur un layout SVG, **modifier l'asset source** (Inkscape resize-to-drawing pour cropper le whitespace) plutôt que continuer à patcher le composant. Cf `LESSONS.md` section « Assets vectoriels ».
- **Navbar consumer agrandie** (commit `e523357`) : `Logo` size `xl` (64px) ajouté + `navbar-public.tsx` passe de `h-16` à `h-20` pour brand presence renforcée. Autres navbars (pro mini-header, sidebar producer, footer, admin) inchangées.
- **Logo dans header emails Resend** (commit `67e40fc`) : `lib/resend/templates/layout.tsx` étend le layout avec un header logo TerrOir sur fond crème. Asset PNG `public/email-assets/logo-email.png` généré via script `scripts/generate-email-logo.mjs` (les clients mail ne supportent pas SVG, d'où l'export PNG).
- **Vision funnel producteur — Phase 1 + 2** (commits `87bfff9` + `9e78ea4` + `783e071` + `a895ed2` + `49b45d8` + migrations `20260426000000` + `20260427000000`) : 
  - Phase 1 : colonnes `source` + `prenom` ajoutées à `producer_interests`. `source ∈ ('formulaire_public', 'invitation_directe')` DEFAULT `formulaire_public`. Création auto de lead `source='invitation_directe' statut='contacted'` quand un admin invite un prospect dont l'email n'est pas en base — l'onglet Leads devient le journal d'acquisition complet.
  - Phase 2 : formulaire `/devenir-producteur` simplifié (split prenom/nom, drop required Espèces élevées). Wizard onboarding réduit de 3 à 2 étapes (Compte / Profil), `StepPersonnel` fusionné dans `StepEntreprise` (renommage déféré). Helper `lib/producers/pick-initial-infos.ts` merge 3 sources par priorité (producer draft > user > lead) pour pré-remplir prenom/nom/telephone/nom_exploitation/commune. `'À compléter'` traité comme empty pour ne pas leak dans les inputs. `complete-onboarding` valide les 3 perso fields, écrit `users` AVANT `producers` (partial failure laisse le draft retryable). 7 tests vitest sur `pick-initial-infos`.
  - Phase 3 (DROP `prenom_affichage`, ~19 fichiers transversaux) **reportée** à une session dédiée — cf `TODO.md` Vision funnel.
- **Audit auto-promotion 3 conditions cumulatives** (commit `4911401`) : `promoteProducerToPublicIfActive` ne checkait que la garde `statut='active'` côté UPDATE — un producer pouvait apparaître sur `/producteurs` et la carte sans Stripe Connect prêt ou sans aucun créneau. Désormais 3 pré-checks cumulatifs avant la transition `active → public` : (1) `statut='active'` ET `stripe_charges_enabled=true`, (2) ≥ 1 produit `active=true`, (3) ≥ 1 slot `active=true` ET `excluded_at IS NULL`. Tests vitest étendus à 21 cas (vs 10 avant).
- **Purge panier au logout** (commit `a08a56e`) : `lib/auth/use-logout-flow.ts` purge le state panier au logout pour éviter la fuite entre sessions sur même device (un user A se déconnecte → user B se connecte → panier de A persiste en local storage).
- **Reset password page dédiée** (commit `5ff9394`) : `/reinitialiser-mot-de-passe` affiche un formulaire « nouveau mot de passe » avant tout login automatique (étape 2 explicite). Server action groupée `verifyOtp` + `updateUser` pour conserver les cookies de session. `/mot-de-passe-oublie` pointe désormais `redirectTo` vers la nouvelle page. ⚠️ Action Romain : template Supabase « Reset Password » à mettre à jour (`${SITE_URL}/reinitialiser-mot-de-passe?token_hash={{ .TokenHash }}&type=recovery`).
- **Phase 3 vision funnel — sous-chantier reads** (commits `894fa5e` helper + `1110816` lectures) : helper `getProducerDisplayName(producer)` créé. Toutes les lectures publiques + pré-fill wizard migrées vers `users.prenom`. `fetch-public` joint `users(prenom)` via FK `user_id`. Écritures conservées (placeholder `'À compléter'`) pour fenêtre rétro-compat. Phase 3 finale (DROP COLUMN) restante en chantier dédié.
- **Rattrapage 4 dettes techniques** (commits `3b29c34` + `e5c4234` + `92bbff7` + `6c2b5ef`) : (1) tests vitest `isValidRedirectPath` + `resolvePostLoginPath` (18 tests — vitest 130 → 148), (2) badge source col `/producer-interests` (`LeadSourceBadge` vert « Public » / orange « Invité »), (3) messages erreur callback user-friendly (mapping substring lowercase robuste), (4) bouton « demander un nouveau lien magique » inline.
- **Rename `StepEntreprise` → `StepInfos`** (commit `acc080b`) : depuis fusion `StepPersonnel` + `StepEntreprise` (commit `49b45d8`), composant gère perso ET entreprise. Renommage cosmétique trivial déféré pour ne pas mélanger refactor et delivery.
- **Remember email opt-in `/connexion`** (commit `71172e1`) : checkbox « Se souvenir de mon email ». Stockage local via helper `lib/storage/local-preferences.ts`. Pattern opt-in explicite (pas par défaut), aligné RGPD.
- **Magic link bascule OTP `token_hash` + cookie deep-link cross-subdomain (PKCE Option B)** (commit `09c219d`) : résolution du bug PKCE `code+challenge+does+not+match`. Diagnostic : cookie `code_verifier` PKCE non portable entre `www.*` (Server Action) et `admin.*` (callback) à cause de l'isolation Chantier 4 (cookie names distincts). Bascule au flow OTP `token_hash` (`verifyOtp` côté callback, sans cookie verifier nécessaire). Le `redirectTo` deep-link, qui causait le bug `Missing+code+or+token_hash`, est maintenant persisté dans un cookie HttpOnly `terroir_post_login_redirect` sur `.terroir-local.fr` au form submit, lu et expiré par `/auth/callback` après `verifyOtp`. Helper isolé `lib/auth/redirect-cookie.ts` + 173 lignes de tests vitest. ⚠️ Action Romain : template Supabase Magic Link à mettre à jour (`{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=magiclink`).
- **Navbar SSR-aware (fix flash hydration CTA)** (commits `209ce83` immédiat + `6a9ebd3` robuste) : sur hard refresh d'un visiteur anonyme, les boutons Connexion/S'inscrire disparaissaient pendant la fenêtre `loading=true` du `UserProvider`. Fix immédiat : retrait du branch `loading ?` du rendu. Fix robuste : `app/layout.tsx` devient async, lit `getUser()` côté server, passe `initialUser` au `UserProvider` qui s'initialise dès le SSR. `onAuthStateChange` émet `INITIAL_SESSION` sur abonnement → couvre la résolution initiale + tous les changements ultérieurs sans `getSession()` redondant. Dette résiduelle non bloquante : enrichir `initialUser` avec `isAdmin` SSR pour éviter le bref flash sans badge Admin.
- **Audit logs forensiques — Phase 1 auth** (commits `a36fcaa` helper + migration `20260427100000` + `acd8c03` 5 call sites) : trace forensique des events sensibles (RGPD art. 32, PCI DSS 10.x). Table `audit_logs` append-only avec RLS admin-only en lecture, écriture exclusive `service_role`. Helper `lib/audit-logs/log-auth-event.ts` fail-safe (try/catch silencieux, jamais re-throw — un échec d'audit ne casse jamais le flow métier) avec auto-extraction IP/UA via `next/headers()`. 5 events instrumentés : `account_login_password`, `account_login_magic_link`, `password_reset_request`, `password_changed`, `account_logout`. Décision technique : `await` (vs fire-and-forget) en server action pour ne pas perdre d'events. 11 tests vitest sur le helper.
- **`.gitignore` `tsbuildinfo`** (commit `229c0ec`) : `tsconfig.tsbuildinfo` (incremental build cache TypeScript) ignoré + retiré du tracking.
- **Trigger DB stock à l'annulation (P0)** (commit `4584139` + migration `20260427200000_restore_stock_on_order_cancel.sql`) : la RPC `create_order_with_items` décrémentait le stock à l'INSERT mais aucun chemin ne ré-incrémentait à l'annulation (3DS-fail webhook, cron timeout, cancel route, refund route). Trigger `AFTER UPDATE OF statut` avec clause `WHEN` PG-level filtre les transitions concernées (`pending|confirmed|ready → cancelled|refunded`). `IS DISTINCT FROM` garantit l'idempotence. `SECURITY DEFINER` bypass RLS. Exclusion délibérée de `completed → refunded` (cas litige post-retrait : produit déjà remis au consumer). Apply prod 26/04 + validation prod end-to-end OK.
- **Webhook payment_failed cancellation_reason + guard rétrogradation (P2)** (commits `9482e5b` + `56ab733`) : extraction `lib/stripe/handle-payment-failed.ts` avec return enum 5 valeurs + 7 tests vitest. Pose `cancellation_reason='payment_failed'` + `assertTransition` + `revalidateTag('public-stats')`. Guard explicite `[WEBHOOK_FAILED_AFTER_SUCCEEDED_NOOP]` sur statut confirmed/ready (Stripe peut émettre failed après succeeded). UI consumer exclusion à la source (compteur + listing + realtime), UI admin pseudo-statut `payment_failed_pseudo` "Tentative échouée" gris distinct + filtre tab dédié + metrics `today` / `completion` ajustés. Validation prod end-to-end OK.
- **Webhook succeeded résurrection cancelled → pending (P1)** (commit `49c0f1b`) : extraction `lib/stripe/handle-payment-succeeded.ts` avec return enum 6 valeurs + 8 tests vitest. Le scénario qui cassait : client paye → 3DS-fail → order cancelled+payment_failed → client retente avec autre carte → ancien handler tombait dans webhook_anomaly (state machine refusait `cancelled → confirmed`). Fix : résurrection conditionnelle si `cancellation_reason='payment_failed'`. Cible `pending` (pas `confirmed`) — TA a poussé back sur le brief initial après inspection (le webhook succeeded ne fait jamais d'UPDATE statut sur le path nominal, le passage `pending → confirmed` se fait via `/api/orders/[id]/confirm` par le producer). Reset `cancellation_reason` et `cancelled_at` à NULL. Bypass volontaire de la state machine sur path résurrection uniquement, commenté explicitement. Validation prod end-to-end OK (commande TRR-7235E).
- **Couverture vitest étendue à 411+ tests** (+98% en une session) : state machine matrice 6×6 (`f57d5ad` 89 tests) + auto-bump lead onboarded (`d0c87d2` 7 tests) + cron order-timeout (`f32d083` 12 tests + 2 it.todo) + cancel route (`280ff69` 27 tests) + confirm + complete routes (`81b3c1a` 37 tests) + handle-payment-failed/succeeded (15 tests + extension Phase 2 audit logs). Modif `vitest.config.ts` ajoute pré-transform inline via `transformWithEsbuild` pour parser JSX dans `.tsx` (vitest 4 / rolldown-vite ne le fait pas par défaut, sans dep additionnelle). Patterns capitalisés : `vi.hoisted` pour env vars, queues séparées par opération sur builder Supabase, sentinel `__REDIRECT__` pour mock server actions Next.js.
- **Refund admin cancellation_reason** (commit `799bf71`) : 1 ligne ajoutée à `app/api/stripe/refund/route.ts` (`cancellation_reason='admin_refund'`). Bug additionnel #4 du rapport TA inspection P2 clos. 3 dettes connexes flag pour le chantier futur "alignement routes orders".
- **Webhook account.updated extraction + tests + script backfill** (commits `8ba2e49` + `5592f30`) : extraction `lib/stripe/sync-account-flags.ts` du handler webhook `account.updated` (pattern fonction pure réutilisé pour P2 et P1) + 8 tests vitest. Script `scripts/backfill-stripe-connect-flags.ts` pour réconciliation initiale 3 flags Stripe Connect (cf migration `20260424000000`).
- **Navbar SSR isAdmin + isProducer** (commits `404bb0d` + `20304e9`) : extension du pattern `6a9ebd3` (initialUser) aux flags de rôle. `getInitialUserPayload()` pré-fetch `is_admin()` + lookup `producers.user_id` côté server. Type `InitialUserPayload` factorisé dans `lib/auth/types.ts` (client-safe). Pattern `Promise.all` + fail-safe par lookup (un throw isolé ne masque pas les autres flags). Élimine flash badge admin et flash CTA producer au hard refresh. Découverte importante capturée en LESSONS : triggers `users_exclusive_with_admin` + `admin_users_exclusive_with_users` (migration `20260421100000`) garantissent `isAdmin && isProducer === true` impossible côté DB par design. Néanmoins le code applicatif garde les 2 lookups indépendants par robustesse défensive.
- **Chantier P1 robuste — résurrection avec atomicité DB-side** (commits `6b4a835` RPC + `9d6cb13` webhook + `5a572b2` UI, matin 27/04) : bug détecté en validation prod après P1 `49c0f1b` — la résurrection ne re-décrémentait pas le stock (commande TRR-7235E, quantité 3, stock affiché 50 au lieu de 47). Solution Option C robuste :
  - **RPC SQL atomique** `revive_order_with_stock_check(p_order_id uuid)` retournant enum `'revived' | 'blocked_stock' | 'blocked_slot'`. Lock order + slot + multi-products `FOR UPDATE` (anti-deadlock via `ORDER BY id`). Garde-fou défensif sur `statut='cancelled' AND cancellation_reason='payment_failed'`. Check stock tout-ou-rien + check slot via `COUNT(*)`. Décrémentation atomique multi-products + UPDATE order vers `pending` + reset reason/cancelled_at. Migration `20260427300000_revive_order_with_stock_check.sql` apply prod confirmé via 3 scénarios SQL (revival OK, blocked stock, blocked slot — tous ✅).
  - **Helper `logPaymentEvent`** (Phase 2 audit_logs) avec 6 event types : `order_payment_succeeded`, `order_payment_failed`, `order_revival_succeeded`, `order_revival_blocked_stock`, `order_revival_blocked_slot`, `order_revival_refund_failed`. 11 tests vitest. Pattern symétrique à `logAuthEvent` Phase 1 mais sans IP/UA fallback (webhook Stripe IPs, peu pertinentes forensiquement). Clos la dette Phase 2 audit_logs orders/payment.
  - **Webhook handler étendu** (`lib/stripe/handle-payment-succeeded.ts` + `lib/stripe/handle-payment-failed.ts`) : enum return values 6 → 9 valeurs (ajout `revival_blocked_stock`, `revival_blocked_slot`, `revival_refund_failed`). Refund Stripe automatique sur paths bloqués (rupture stock ou slot saturé entre temps). Audit logs instrumentés sur tous les paths nominaux + résurrection. 25 tests vitest étendus (14 succeeded + 11 failed).
  - **UI consumer + admin** : template Resend `order-revival-blocked` (1 template avec prop discriminante `blockedReason: 'stock' | 'slot'`). Page `/compte/confirmation/[id]` détecte cancelled+revival_blocked_* et affiche `RevivalBlockedView` (icône terra + message contextualisé + montant remboursé + CTAs "trouver un autre producteur / créneau"). Filtre consumer `/compte/commandes` étendu via helper `isVoidOrderRow` à 3 reasons (`payment_failed` + `revival_blocked_stock` + `revival_blocked_slot`). Admin `/suivi-commandes` : 2 pseudo-statuts distincts terra (`revival_blocked_stock_pseudo` "Bloquée (stock)" + `revival_blocked_slot_pseudo` "Bloquée (créneau)") + 2 nouveaux filtres tabs + metrics `today` / `completion` étendus à `isVoidOrder`. Wiring email consumer via `waitUntil` (pattern producer notif).
  - **Validation prod end-to-end** : commande TRR-KKKDL (Salade mesclun, 3 unités, séquence 3DS-fail + retentative carte 4242). Stock 50 → 47 ✅. audit_logs : `order_payment_failed` à T+0 puis `order_revival_succeeded` à T+5s ✅. Le bug stock résiduel détecté matin du 27/04 est entièrement résolu.

## Chantiers en cours

_(rien en cours)_

## Dettes techniques connues

- **Setup CLI Supabase pour migrations auto** : aujourd'hui apply manuel via SQL Editor. À automatiser si fréquence de migrations augmente.
- **Framework de tests** : vitest couvre désormais 411+ tests sur slots, HMAC opt-out, cookie-domain, formatters, fetch-public, promote-to-public, maskEmail, redirect-cookie, log-auth-event, post-login-redirect, **state machine orders (89 tests, matrice 6×6)**, **handle-payment-failed (11 tests Phase 1+2 audit)**, **handle-payment-succeeded (14 tests étendus pour résurrection robuste)**, **routes orders cancel (27 tests) + confirm (16 tests) + complete (21 tests)**, **route cron order-timeout (12 tests + 2 it.todo bugs latents B1/B2 UPDATE silencieux)**, **complete-onboarding auto-bump lead (7 tests)**, **getInitialUserPayload (8 tests)**, **logPaymentEvent (11 tests)**. Pattern de mock Supabase builder thenable + `vi.hoisted` pour env stubs réutilisable pour les prochaines routes (cf `LESSONS.md` section "Tests vitest"). Total session 27/04 : passage 207 → 411+ tests (+98% de couverture en une session).
- **Mentions légales footer pro** : page absente, le footer pro pointe sur un href mort. À créer une fois le contenu juridique disponible (action externe Romain — pré-requis hors code).
- **Phase 3 vision funnel finale — DROP COLUMN `prenom_affichage`** : sous-chantier `reads` livré post-marathon (commits `894fa5e` + `1110816`). Restent à faire : retirer les écritures `prenom_affichage = 'À compléter'` (3 INSERT runtime), retirer le champ du wizard + édition onboarding, retirer côté seed/cleanup, migration DROP NOT NULL puis DROP COLUMN, purger le fallback dans `getProducerDisplayName`. Chantier dédié futur (~10-15 fichiers).
- **Backfill producers `count = 0`** : à réévaluer avant chaque lancement. Aujourd'hui négligeable (faible volume), mais à garder en tête si le funnel monte.
- **SMTP custom Supabase à confirmer/configurer** : observation récente — mails Auth Supabase atterrissant en spam. Configurer Resend en SMTP custom (rate limit Supabase built-in ~3-4/h, non destiné à la production) recommandé avant lancement. Action externe Romain via Dashboard.
- **Templates Supabase Auth Email — actions Romain post-session marathon** : (1) Magic Link template à mettre à jour avec `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=magiclink` (post-PKCE Option B `09c219d`). (2) Reset Password template à mettre à jour avec `${SITE_URL}/reinitialiser-mot-de-passe?token_hash={{ .TokenHash }}&type=recovery` (post-`5ff9394`). (3) Confirm Signup, Change Email, Invite User pas testés visuellement — à valider end-to-end. Action externe Romain via Dashboard.
- **Suppression page legacy `/reset-password` (~1 semaine post-deploy)** : la nouvelle page dédiée `/reinitialiser-mot-de-passe` (commit `5ff9394`) la remplace. Garder la legacy ~1 semaine pour absorber les emails reset password en transit avec l'ancien template, puis supprimer.
- **Code mort résiduel commit `d4088d5` (~1-2 semaines fenêtre rétro-compat PKCE)** : depuis la bascule OTP `token_hash` (commit `09c219d`), le flow PKCE magic link n'est plus utilisé. Code de gestion `?code=` côté `/auth/callback` devient mort à expiration de la fenêtre de rétro-compat (~1-2 semaines). Purge prévue post-fenêtre.
- **Chantier "alignement routes orders"** : recoller 3 dettes liées sur les routes d'annulation/refund (flag par rapports TB `799bf71` et `f32d083`).
  - `app/api/stripe/refund/route.ts` : `assertTransition` + `revalidateTag('public-stats')` + suite vitest manquantes.
  - `app/api/cron/order-timeout/route.tsx` : check d'erreur UPDATE silencieuse (B1+B2 documentés via `it.todo` dans tests `f32d083`) + `revalidateTag` (B3 absent vs webhook payment_failed).
  - 3 routes d'annulation à harmoniser avec les mêmes patterns (state machine + stats invalidation + error handling).
- **Pré-fetch SSR `ProducerLite` pour éliminer flash placeholder ProducerLayout** : flag boolean `isProducer` SSR (commit `20304e9`) résout le flash CTA mais `ProducerLayout` dépend de l'objet producer complet (`nom_exploitation`, `slug`, `statut`). Pré-fetch d'un objet allégé `ProducerLite` côté SSR éliminerait aussi ce flash. Pattern réplicable. Non bloquant — flash très court.
- **Branding Stripe Connect** (investigation dédiée future) : flag pendant la session 27/04 pour ne pas mélanger avec les bugs critiques. Investigation à faire avec accès doc Stripe à jour (logo, couleurs, pages `/connect/*`).
- **Webhook Stripe mode Live** : créer un nouveau webhook endpoint dans Stripe Dashboard pointant sur `https://www.terroir-local.fr/api/stripe/webhook` au moment de la bascule Test → Live (mode Test confirmé OK 27/04).
- **Cron retry-failed-refunds** (chantier dédié futur) : si `stripe.refunds.create` échoue côté webhook handler résurrection bloquée (rare : réseau, idempotency conflict), l'order reste cancelled+payment_failed, le client est débité, audit log `order_revival_refund_failed` poussé pour grep. Pas de retry auto. Couvre aussi les autres paths refund qui peuvent échouer (admin manuel, cron timeout).
- **Dédup webhook notifications** (chantier dédié futur) : table `webhook_events_processed(event_id, processed_at)` à créer pour idempotence sur les rejouages Stripe (tous handlers : succeeded, failed, account.updated, payout.paid). Pertinent à instrumenter avant volume significatif.
- **Migration `transformWithEsbuild` deprecated → `transformWithOxc`** (warning vitest 4 / rolldown-vite, commit `f32d083`) : non bloquant, à migrer quand l'API `transformWithOxc` est stable.
- **Investigations produit en attente de décision** (4 sujets remontés par les rapports vitest session 27/04) :
  - Consumer cancel route — la route `/api/orders/[id]/cancel/route.tsx` interdit aujourd'hui au consumer d'annuler sa propre commande (403). Voulu (philosophie anti-abus) ou trou ? Test D1 commit `280ff69`.
  - Transition `ready → refunded` illégale, fallback à `cancelled`. Décision produit ouverte.
  - Aligner guards `canTransition` vs `isTerminal` — asymétrie API state machine. JSDoc ou guard ?
  - Confirm route sans garde rôle explicite vs cancel — admin non-owner ne peut pas confirmer.
- **UI admin pour `audit_logs`** : la table existe et est alimentée (5 events auth Phase 1 + 6 events payment Phase 2 — total 11 event types instrumentés), mais aucune page back-office pour consulter les logs côté admin. Chantier futur : page `/admin/audit-logs` avec filtres par event_type, user_id, date range, pagination. D'autant plus utile que la table contient maintenant les events forensiques payment.
- **Events audit Phase 3 additionnels** : Phase 1 (auth, 5 events) + Phase 2 (payment, 6 events) livrées. Restent à instrumenter en Phase 3 : `account_signup`, `email_change`, `account_deletion` (RGPD), `admin_login` (event distinct du password login), `role_change` (promotion consumer→producer, suspend/reactivate), Stripe events spécifiques (dispute, payout completed/failed). Chantier futur dédié.

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
