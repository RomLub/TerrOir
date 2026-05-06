# CLAUDE.md — TerrOir

Doctrine, conventions et leçons consolidées du cycle 06/05/2026.
À lire en début de toute session Claude Code (single ou Agent Teams).

---

## Contexte produit

TerrOir est une marketplace short-circuit Sarthe (Next.js 14 App Router 
+ Supabase Postgres/Auth/RLS + Stripe Connect + Resend + Vercel) avec 
3 subdomains (www, pro, admin). État pré-launch : pas encore Live 
public, en préparation ouverture (T-001 onboarder Julien / T-002 bascule 
Stripe Live / T-003 audit pré-launch externe dans TODO.md).

Owner : Romain (vibecoder, autodidacte, INTP-A, communique en français 
casual direct, valorise honnêteté et pushback constructif sur 
validation creuse).

---

## Doctrine git multi-terminal

Cycle 06/05/2026 a vu 3 incidents de race condition working tree 
partagé entre 3 terminaux Claude Code (commit 132b469 mêlant fichiers 
de 2 chantiers, race rate-limit.ts entre TA et TC, staging T-110-bis 
perdu transitoirement chez TB). Doctrine durcie :

### Avant chaque commit (obligatoire)
- `git status` complet
- `git add <fichier précis>` (jamais `git add .` ou `git add -A`)
- `git diff --cached --stat` pour vérifier ce qui est stagé
- Si fichiers inattendus dans le cached : STOP + diagnostique avant 
  de forcer

### Format messages commit
- Pas de heredoc bash multiligne (`<<EOF`) — risque interprétation 
  bash sur backticks et substitutions
- Utiliser `git commit -m "..."` simple, ou `git commit -F message.txt` 
  pour les longs messages

### Procédure résolution race git multi-terminal (validée)
1. `git reset HEAD` pour défaire le staging
2. `git checkout` pour restaurer si nécessaire
3. Re-stage uniquement les fichiers du chantier en cours
4. `git diff --cached` final avant commit

### Si conflit working tree avec un autre terminal détecté
STOP et reporter à Romain. Ne pas forcer.

---

## Doctrine privacy

### Doctrine T-200 r1 (raffinée par T-219)
- Pas de log par-IP côté serveur
- Pas de profilage user via géoloc
- Pas de PII traversant les services externes (Stripe, gouv.fr, etc.)
- `hit_count` agrégé anonyme dans `geocode_cache` = pas de table 
  jointure user→cp
- Cache geocode_cache = donnée publique INSEE (CP français), pas PII

### Doctrine FORCE RLS (T-218 + T-218-bis + T-295-bis)
- Trigger `producers_block_owner_admin_columns` BEFORE UPDATE bloque 
  self-update producteur sur 25 colonnes admin-only (incluant lat/lng 
  T-218-bis)
- Toutes les RPC SECURITY DEFINER : EXECUTE révoqué de PUBLIC + anon 
  + authenticated, GRANT EXECUTE à service_role exclusivement
- Trigger functions : pas besoin de GRANT (trigger engine bypass ACL)
- Superuser SQL Studio sans `SET ROLE service_role` ne bypass pas le 
  trigger T-218 (auth.role() = NULL ≠ 'service_role', is_admin() = 
  false car auth.uid() = NULL). Pour UPDATE admin manuel via SQL 
  Studio : SET ROLE service_role explicite obligatoire.

### Doctrine anti-PII tracking (préparée pour T-201/T-245/T-246 PostHog)
Pour tout event tracking analytics :
- Aucun event ne capture : CP, lat/lng, email, phone, consumer_id, 
  consumer_name, adresse, téléphone
- producer_id autorisé pour events scroll/clic produit (T-245), 
  INTERDIT pour events widget distance (T-201) et expand/collapse 
  (T-246) — joindre producer_id à un event widget distance créerait 
  un signal géo dérivé de profilage user
- Helper centralisé `lib/analytics/track.ts` avec filtrage runtime 
  + assertion + throw en mode dev pour repérer les leaks PII en CI/local
- Provider retenu : PostHog (plan gratuit suffit, funnels + replays + 
  feature flags inclus, self-host possible)

### Floutage coordonnées producteur (T-217 Option A)
- Politique : `roundCoord` 2 décimales (~1.1km) sur tous call sites 
  publics
- Helper canonique : `lib/producers/coords.ts` (importé par 
  `fetch-public.ts`, `/api/producers/search`, `/compte/commandes/[id]`)
- Page `/producteurs/[slug]` : floutage garanti via fetcher 
  `fetchPublicProducerBySlug`
- Test contractuel pour verrouillage anti-régression future
- Menace résiduelle T-227 : croisement nom + commune + photos + GPS 
  arrondi peut ré-identifier. Mitigation = UX onboarding + CGU.

---

## Doctrine migrations SQL

### Idempotence (T-297, forward-only convention)
- `CREATE OR REPLACE FUNCTION` (jamais DROP + CREATE)
- `ALTER TABLE ADD COLUMN IF NOT EXISTS` quand pertinent
- `CREATE TABLE IF NOT EXISTS`
- `CREATE INDEX IF NOT EXISTS`
- `DROP POLICY IF EXISTS` avant `CREATE POLICY`
- Convention opposable forward-only (pas de rétrofit des migrations 
  historiques non conformes — coût > bénéfice)

### Application des migrations
Les terminaux ont MCP Supabase configuré (`project_ref=exsxharjqqpohkbznhss`).

**Doctrine 06/05/2026 : migrations livrées ET appliquées par le 
terminal qui les écrit, avec smoke tests post-apply obligatoires.** 
Pas de "livrée mais non appliquée" (perte de temps). Sauf si Romain 
demande explicitement le contraire.

### Smoke tests post-apply (structure standard)
- Test cas nominal (write/read OK comme prévu)
- Test cas d'erreur (CHECK constraint, RLS, trigger blocage)
- Test bypass (service_role, admin) si pertinent
- Reporter résultats explicitement dans le rapport de chantier

### Workflow staging → prod (T-225 backlog post-Live)
Pratique actuelle pré-launch (apply direct prod via MCP) acceptable. 
À reconsidérer avant ouverture publique : monter projet Supabase 
staging, workflow standard apply staging → tests → apply prod.

---

## Doctrine vitest mocking patterns (T-130 + LOTs 3/4 pickup)

Voir `docs/conventions/vitest-mocking-patterns.md` pour les détails.

### 3 patterns à respecter
1. **`importOriginal` dans `vi.mock`** pour préserver les exports 
   transverses d'un module partagé entre tests. Sans ça, le mock 
   pollue les autres tests qui consomment le même module dans le 
   worker vitest.

2. **Imports directs vs barrel pour tests jsdom** : éviter 
   `@/components/ui` (le barrel peut tirer du `server-only` à la 
   transformation Vite, et `vi.mock("server-only")` arrive trop tard 
   au runtime). Préférer imports directs `@/components/ui/button`, 
   `@/components/ui/admin-modal`.

3. **`act()` autour des helpers DOM custom qui déclenchent setState** 
   (pas seulement events `click`/`change` standards). Sinon warnings 
   React state update pollent la sortie.

### Patterns bonus
- Mock Supabase queue par-table (pattern posé en LOT 2 pickup, 
  réutilisé LOTs 3/5/7) — réutilisable pour tous tests touchant 
  Supabase admin client
- Hoisted env stubs pour éviter throw de `lib/env/urls.ts` dans tests 
  SSR

---

## Doctrine wording certifié DGCCRF (T-241 + T-282)

### Single source of truth
`lib/producers/declaration-veracite.ts` map 
`DECLARATION_VERACITE_WORDINGS` archive le texte exact de chaque 
version (`v1.0`, `v1.1`, ...).

### Immuabilité stricte
- NE JAMAIS modifier une entrée existante de la map
- Toute modif (même typo) = nouvelle version, jamais correction sur 
  version courante
- Sinon les snapshots `producers.declaration_indicateurs_*` perdent 
  leur valeur probatoire DGCCRF

### CHECK constraint (T-292)
`producers.declaration_indicateurs_wording_version` contraint à 
whitelist `('v1.0', 'v1.1')`. Pour bump v1.2+ : nouvelle migration 
DROP + ADD constraint avec liste étendue.

---

## Conventions repo

### Doctrine npm run build avant push JSX
Tout push touchant des nouvelles pages JSX (composants, pages 
App Router, etc.) doit avoir un `npm run build` local validé AVANT 
le push. Apprentissage incident T-130 : règle ESLint 
`react/no-unescaped-entities` stricte sur ce repo, ne pardonne pas 
les apostrophes non échappées.

### Doctrine apostrophe et lint storage (T-255 + T-266 + T-266-bis + T-266-tris)
- Règle ESLint anti-apostrophe courbe U+2019 active. Utiliser 
  `&rsquo;` ou `&apos;` dans JSX texte, ASCII droit `'` dans strings JS.
- Règle ESLint préfixe `terroir_` strict sur clés sessionStorage / 
  localStorage. Plus aucune clé legacy `terroir-` (migration T-266-tris 
  finalisée).

### Doctrine email lookup case-insensitive (T-110 + T-110-bis)
- Tous les lookups email-keyed utilisent `.ilike(escapeIlikeEmail(input))` 
- Helper `escapeIlikeEmail` échappe `_`, `%`, `\` (defense in depth 
  contre wildcards Postgres ilike sur emails RFC-valides)
- Validation Zod email amont + escape côté query = double couche

### Structure docs/
- `docs/fixes/` : récap chantiers livrés (convention dominante 
  ~30 fichiers, utilisée par TC en T-130 et chantier pickup)
- `docs/features/` : pas utilisé (convention pas en place)
- `docs/conventions/` : règles techniques transverses (vitest 
  mocking, idempotence migrations, wording governance, lint storage, 
  staging-prod workflow, rate-limiting)
- `docs/security/` : audits sécurité, threat models, ACL hardening
- `docs/runbooks/` : runbooks admin, checklist pré-Live
- `docs/incidents/` : post-mortems incidents méthodologiques 
  (cf. cross-terminal-staging-race 06/05/2026)
- `docs/CHANGELOG.md` : antichronologique
- `docs/TODO.md` : forward-looking uniquement (Romain demande de 
  ne pas trop le modifier, fichier sensible)

### Pattern test vitest TerrOir
- Test isolé par fichier (pas de globals partagés)
- `// @vitest-environment jsdom` en pragma quand nécessaire (env 
  jsdom pas global, décision T-269)
- Pattern `@testing-library/react` + `userEvent` pour tests 
  interactifs (depuis T-237)
- `react-dom/client` + `act()` brut accepté pour tests SSR légers

### Pattern audit log
Cluster nommés (`auth_*`, `payment_*`, `admin_invite_*`, 
`admin_category_*`, `pickup_*`, etc.). Helper dédié par cluster 
(`lib/audit-logs/log-<cluster>-event.ts`). Labels FR dans 
`lib/audit-logs/labels.ts`.

### Pattern rate-limit (Upstash)
Helpers dans `lib/rate-limit.ts`. Convention 10/min/keying-id par 
défaut. Voir `docs/conventions/rate-limiting.md` pour la table 
maintenue des call sites.

---

## Décisions produit consolidées

### Modèle 3 états orders (LOT 0 chantier pickup)
- `pending` (consumer commande, attend validation producer)
- `confirmed` (producer valide sous 24h)
- `completed` (producer saisit code retrait du consumer = livraison)

L'état `ready` en state machine est mort dans le modèle réel 
(héritage design antérieur). Backlog : nettoyage ou réaffectation 
(non bloquant).

### Catégorisation produits (T-130 Option A)
- 3 tables séparées : `product_categories` (flat) + `animals` + 
  `cuts` (scopé `animal_id`)
- Pas de récursivité (la viande a 3 niveaux mais légumes n'ont pas 
  d'animal — modèle artificiel rejeté)
- UI admin `/admin/categorisation/{categories,animaux,morceaux}`
- Garde-fous DELETE stricts : interdit si dépendances (count check 
  amont API + UI désactive bouton)

### Pickup validation (chantier complet 06/05/2026)
- 2 chemins UX cumulés : id-based page detail (1-clic) + code-based 
  haut-de-liste (preview modale obligatoire)
- Code retrait existant `TRR-XXXXX` (5 chars charset 
  23456789ABCDEFGHJKLMNPQRSTUVWXYZ via trigger Postgres 
  `generate_order_code()`)
- Cluster audit `pickup_*` avec discrimination `metadata.route`
- Rate-limit 10/min/producer sur les 2 routes
- Transition atomique race-safe : `UPDATE WHERE statut='confirmed'`
- Email J0 review-request post-validation
- Cron review-followup : J+2 + J+7 (calibrés sur données existantes, 
  pas de modif)

---


## Backlog ouvert (post-cycle 06/05/2026)

### Items chantier-suite identifiés
- T-201 + T-245 + T-246 (instrumentation PostHog event tracking, 
  doctrine + provider arbitrés, prêt à exécuter)
- T-131 + T-132 + T-133 (suite catégorisation : enrichissement seeds 
  via UI, NOT NULL columns, hybride parent_id si besoin émerge)

### Items pickup-validation
- Nettoyage état `ready` state machine (faible)
- Marqueur DB déduplication cron review-followup (faible, pré-Live 
  acceptable)
- Audit log cluster `review_followup_*` (moyenne, substantiel)
- Refactor pattern N+1 cron review-followup → embeds PostgREST 
  (moyenne, à reconsidérer si volume >50 pickups/jour)

### Bloquants Live (cf. docs/runbooks/checklist-pre-live-2026-05-06.md)
49 items P0 consolidés en checklist priorisée P0/P1/P2.

---

## Communication avec Romain

- Tutoyer (TerrOir tutoie partout par convention de produit)
- Français casual direct sans jargon technique
- Pas de hedging ni preamble
- Pas de réassurance creuse
- Maximum 3 options quand choix nécessaire
- Validation directe du raisonnement correct préférée à l'élaboration
- Pushback constructif sur validation aveugle valorisé
- Romain fait le minimum, CC fait le maximum (gain de temps n'est 
  jamais un argument, propreté de la solution oui)

---

Date de consolidation : 2026-05-06
Cycle de référence : multi-terminaux TA/TB/TC (avant migration 
Agent Teams expérimental)