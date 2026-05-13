# CLAUDE.md — TerrOir

Document chargé en début de toute session Claude Code (CC).
Double lecture : par les instances CC d'abord, par Romain quand il en
a besoin.

═══════════════════════════════════════════════════════════════════════════
                              RÈGLES D'OR
              (elles dominent tout le reste — aucune exception)
═══════════════════════════════════════════════════════════════════════════

## 1. FAINÉANTISE MAXIMALE DE ROMAIN

Romain est le plus fainéant du monde. Toute tâche techniquement faisable
par CC est faite par CC. Sans demander. Sans renvoyer la balle.

Concrètement :
- Migration SQL à appliquer → CC l'applique via MCP Supabase
- Script à lancer → CC le lance
- Vérification dans le repo → CC fait la vérification
- Test à écrire → CC l'écrit
- Recherche d'info dans le code ou la doc → CC la fait

### Avant d'envisager une action UI tierce : tenter l'automatisation

CC ne renvoie une tâche à Romain QUE si l'action est techniquement UI-only
sans équivalent API/CLI/MCP. Avant de basculer en pas-à-pas UI, CC vérifie
systématiquement ce qui est automatisable :

- **Stripe** : API + MCP server officiel couvrent création produits/prix,
  lecture compte, gestion webhooks, refunds, recherche objets, etc.
- **Vercel** : CLI (`vercel env add`, `vercel env rm`, `vercel deploy`,
  `vercel domains`, `vercel logs`) couvre l'essentiel de la config
  projet.
- **Supabase** : MCP `apply_migration`, `execute_sql`, `list_tables`,
  CLI `supabase db *`. Quasi tout est automatisable.
- **GitHub** : `gh` CLI couvre PR, issues, releases, secrets, workflows.

CC ne bascule en pas-à-pas UI QUE si l'action est réellement UI-only
(validation KYC identité Stripe, changement de plan billing, certains
toggles de sécurité Supabase Auth comme HIBP). Chaque action confirmée
UI-only est documentée dans la section « Pièges connus » pour que les
sessions futures n'aient pas à re-vérifier.

### Procédure UI tierce pas-à-pas avec validation interactive

Quand l'UI tierce est inévitable, CC procède étape par étape, JAMAIS
en bloc :

1. CC donne l'étape 1 (chemin de clic précis, valeur exacte à entrer).
2. Romain exécute et renvoie une preuve : capture d'écran, copier-coller
   du résultat, ou confirmation textuelle de ce qu'il voit à l'écran.
3. CC valide la preuve. Si OK → étape 2. Si KO → CC diagnostique avant
   de continuer.
4. Et ainsi de suite jusqu'à la fin de la procédure.

Pas de liste à puces « fais ces 8 trucs ». Uniquement du séquencé avec
validation à chaque palier.

## 2. PROPRETÉ COMME SEUL CRITÈRE

Le temps que ça prend et la facilité ne sont JAMAIS des arguments.
Solution propre = solution choisie, même si elle prend 10× plus longtemps
que la sale.

Phrases interdites :
- « pour aller plus vite, je fais X »
- « plus simple, je shortcut Y »
- « on pourra faire propre plus tard »
- « ça ralentit le workflow, on pourrait... »

Aucun argument de temps. Aucun raccourci.

## 3. ZÉRO BACKLOG, ZÉRO TODO

Tout ce qui est identifié pendant une session ET qui est faisable
maintenant est fait maintenant. CC ne dit JAMAIS :
- « tu pourras ajouter ça plus tard »
- « TODO : compléter X »
- « à reprendre dans un prochain chantier »

Si CC voit un truc à faire pendant qu'il bosse, il le fait dans la foulée
sans demander.

### Distinction : backlog vivant vs actions conditionnées

Le mot « backlog » a disparu du repo. Il reste deux artefacts légitimes
pour tracer l'avenir, et seulement ceux-là :

- **`docs/post-launch-checklist.md`** — actions conditionnées à un
  **événement externe identifiable** (passage Live, KYC Stripe reçu,
  avocat livré, PostHog provisionné, etc.). Chaque item porte
  explicitement sa **condition de déblocage**. Pas un backlog, une
  trace d'exécution différée par dépendance externe.
- **`docs/decisions/`** — ADRs (Architecture Decision Records). Trace
  écrite des décisions structurantes avec leur rationale. Statuts :
  `Proposed`, `Accepted`, `Deferred`, `Rejected`, `Superseded`. Un ADR
  n'est pas une todo : c'est un cadre de réflexion réutilisable. Si en
  lisant l'ADR à froid dans 6 mois tu peux extraire une décision claire
  ou un cadre de réflexion, l'ADR a sa place. Sinon, il n'aurait pas dû
  être écrit.

**Ce qui n'a PAS sa place dans le repo** :
- Listes d'idées produit aspirationnelles (« on pourrait faire X un
  jour »). Si l'idée est bonne, elle ressortira.
- Suivi de chantier en cours. C'est la branche git + la PR qui tracent
  l'état d'avancement, pas un fichier statique.
- Tech debt « à payer plus tard ». Soit on la paie maintenant, soit on
  vit avec ; pas de tracking explicite.

Quand CC identifie un item :
- Faisable maintenant → CC le fait.
- Conditionné à événement externe identifiable → CC l'ajoute à
  `docs/post-launch-checklist.md` avec la condition explicite.
- Décision structurante avec rationale réutilisable → CC ouvre un ADR
  dans `docs/decisions/`.
- Aspirationnel sans condition claire → CC ne note rien.

## 4. LANGAGE NON TECHNIQUE AVEC ROMAIN

Romain n'est PAS développeur. Dans toute communication avec lui : zéro
jargon. Traduction systématique.

| À ne pas dire à Romain                | À dire à Romain                            |
|---------------------------------------|--------------------------------------------|
| « j'ai run vitest, le lint passe »    | « j'ai vérifié que tout marche »           |
| « migration appliquée + RLS OK »      | « la base de données est à jour »          |
| « npm install --legacy-peer-deps »    | (rien — CC gère sans en parler)            |
| « rate-limit Upstash configuré »      | « la protection anti-abus est en place »   |
| « rebase + push origin »              | « j'ai envoyé les changements sur GitHub » |

Exception : si Romain demande explicitement le détail technique
(« explique-moi exactement ce que tu as fait »), CC répond en détail.

Entre instances CC et dans le code : jargon normal, pas de traduction.

## 5. PAS DE FENÊTRES POUR LES QUESTIONS

Les questions à Romain sont posées en texte simple dans la conversation.
Jamais d'interface de choix multiples, jamais de question avec 4 boutons.
Si CC a besoin d'arbitrer, il pose la question en français normal et
attend la réponse.

═══════════════════════════════════════════════════════════════════════════

## 1. Contexte projet

TerrOir : marketplace short-circuit Sarthe, pré-launch (pas encore live
public). Stack Next.js 16 App Router (React 19) + Supabase
Postgres/Auth/RLS + Stripe Connect + Resend + Twilio + Upstash Redis +
Sentry, déployé sur Vercel.

3 sous-domaines isolés (cookies séparés) :
- `www.terroir-local.fr` — consumer
- `pro.terroir-local.fr` — producteur
- `admin.terroir-local.fr` — admin

Repo GitHub : `RomLub/TerrOir`. Branche par défaut : `master`. Owner :
Romain.

## 2. Architecture sub-agents CC

Romain utilise les sub-agents natifs Claude Code. À ce jour, AUCUN
sub-agent n'est défini : le dossier `.claude/agents/` n'existe pas
encore.

L'ancienne orchestration multi-terminaux nommée TA / TB / TC / TT
(plusieurs instances CC en parallèle sur le même working tree) est
ABANDONNÉE. Raison : trop d'incidents de race condition working tree,
doctrine de prévention trop lourde, mauvaise ergonomie. Tout passe
désormais par les sub-agents natifs CC (outil `Agent`, paramètre
`subagent_type`, worktrees isolées via le paramètre `isolation` si
besoin).

Quand des sub-agents seront créés dans `.claude/agents/`, leurs rôles et
règles d'invocation seront documentés dans cette section.

## 3. Workflow git

> Pour Romain : git c'est le système qui sauvegarde l'historique du code.
> Une « branche » = une copie séparée où on bosse sans casser la version
> principale. Un « commit » = un point de sauvegarde. Un « push » = on
> envoie le travail sur GitHub.

### Règles dures

- Avant tout commit : CC vérifie sur quelle branche il est. Jamais de
  commit direct sur `master`.
- Avant tout commit : CC liste précisément les fichiers à inclure et les
  ajoute UN PAR UN (pas d'ajout global type « tout ce qui a bougé »).
  Risque : on commit accidentellement des fichiers d'un autre chantier
  ou des fichiers sensibles.
- Avant tout commit : CC relit ce qui va être commité (diff complet du
  staging) et confirme que ça correspond au chantier en cours.
- Si CC trouve des fichiers inattendus dans le staging : STOP, on
  diagnostique avant de forcer.

### Format des messages de commit

Format : `<type>(<scope>): <résumé court en français>`

Types : `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `ci`,
`style`, `build`.

Exemples du repo :
- `feat(scripts): cleanup-test-residuals-e2e CLI standalone`
- `fix(test): normalize EOL in codegen-enums parity check`
- `docs(conventions): doctrine regression-tests-security complète`

Pour messages longs : pas de heredoc bash multi-lignes (risque
d'interprétation des backticks/substitutions par bash). Préférer
`git commit -m "ligne courte"` ou `git commit -F message.txt`.

### Convention de nommage des branches

- `feature/<nom-court>` — nouvelle fonctionnalité
- `fix/<nom-court>` — correction de bug
- `chore/<nom-court>` — maintenance, tooling
- `docs/<nom-court>` — documentation
- `refactor/<nom-court>` — refacto sans changement de comportement

### Interdits absolus

- **Force push sur `master`** : interdit. Risque = écraser l'historique
  partagé, perte irréversible de travail.
- **Skip des hooks pré-commit** (`--no-verify`) : interdit. Les hooks
  empêchent le code cassé de partir.
- **`npm install --legacy-peer-deps`** : interdit. C'est un signal
  d'alerte, jamais un fix. Vercel ne l'utilise pas en build, donc
  local-vert / Vercel-rouge garanti. Si `ERESOLVE` : STOP, on diagnostique
  la peer dep avant de pousser.
- **Commit de secrets** (clés API, mots de passe, tokens) : interdit. Si
  un secret s'est glissé, prévenir Romain immédiatement pour qu'il le
  révoque côté provider.

### Pré-push obligatoire

Avant tout push, CC valide localement :
1. `npm install` (sans `--legacy-peer-deps`)
2. `npm run lint` (ESLint)
3. `npm run type-check` (TypeScript strict)
4. `npm run build` (Next build complet)
5. `npm test` (Vitest)
6. Si modif spec E2E security (`tests/e2e/security/*.spec.ts`) :
   vérifier passage par helpers canoniques `seedConsumer` /
   `seedProducer` (jamais email custom hors pattern sentinel
   `playwright-test-*@mailinator.com`). Cf. doctrine
   `docs/conventions/regression-tests-security.md`.

Si un des cinq premiers casse → on fixe, on ne push pas. Le 6e
(spec E2E security) ne s'applique que si le périmètre est touché.

## 4. SQL / Supabase

INVERSION TOTALE de l'ancienne pratique. CC fait tout ce qu'il peut faire
automatiquement.

### CC gère seul (sans demander à Romain) :

- Écriture des migrations dans `supabase/migrations/`
  (format : `YYYYMMDDHHMMSS_nom_snake.sql`)
- Application des migrations via MCP Supabase (`apply_migration`)
- Smoke tests post-apply (cas nominal + cas d'erreur RLS/CHECK/trigger
  + bypass `service_role` si pertinent)
- Lecture/écriture des données via `execute_sql` MCP quand nécessaire
- Régénération des types TypeScript / enums via `npm run codegen:enums`

### Conventions migrations (forward-only, idempotentes)

- `CREATE OR REPLACE FUNCTION` (pas `DROP` + `CREATE`)
- `ALTER TABLE ADD COLUMN IF NOT EXISTS`
- `CREATE TABLE IF NOT EXISTS`
- `CREATE INDEX IF NOT EXISTS`
- `DROP POLICY IF EXISTS` avant `CREATE POLICY`
- Pas de rétro-modification des migrations historiques (forward-only)

### Romain intervient UNIQUEMENT si :

- Action UI Supabase Dashboard sans équivalent API/CLI confirmée comme
  telle (cf. règle d'or 1 : CC tente l'automatisation d'abord).
- Décision produit/stratégie sur le schéma (ex : « est-ce qu'on garde
  cette colonne ? ») — décision, pas exécution.

## 5. Tests

### Frameworks installés

- **Vitest** — tests unitaires + intégration, plusieurs centaines de
  tests dans `tests/`.
- **Playwright** — tests end-to-end (E2E), suite complète dans
  `tests/e2e/`.
- **@testing-library/react + user-event** — tests UI interactifs.
- **jsdom** — environnement DOM Vitest (pragma
  `// @vitest-environment jsdom` par fichier, pas global).
- **Tests SQL intégration** — config séparée `vitest.sql.config.ts`,
  requièrent Docker + `supabase start` local.

### Commandes

| Commande              | Effet                                              |
|-----------------------|----------------------------------------------------|
| `npm test`            | Vitest run complet (suite standard)                |
| `npm run test:watch`  | Vitest en mode watch                               |
| `npm run test:sql`    | Tests intégration SQL (nécessite Supabase local)   |
| `npm run test:e2e`    | Playwright run                                     |
| `npm run test:e2e:ui` | Playwright en mode UI interactive                  |

### Emplacement

- Tests unitaires : `tests/**/*.test.{ts,tsx}` — miroir de l'arbo source
  (`tests/app/...`, `tests/lib/...`, `tests/components/...`).
- Tests E2E : `tests/e2e/**/*.spec.ts`
- Tests SQL : `tests/sql-integration/`

### Règle « nouveau code = nouveau test »

Toute nouvelle logique métier (fonction lib, route API, RPC SQL, server
action) DOIT être livrée avec son test. Pas de livraison sans test. Si
le test n'est techniquement pas faisable (glue code trivial, UI très
simple), CC l'explique explicitement dans la conversation et propose un
test E2E à la place.

### Seuil acceptable

- Toute PR : `npm test` vert en local.
- Toute PR touchant à la DB : `npm run test:sql` vert (si Docker dispo)
  OU smoke tests post-apply migration reportés dans la conversation.
- Toute PR touchant à un parcours user critique (checkout, signup,
  pickup validation, refund) : test E2E associé écrit ou mis à jour.

### Pattern E2E (Playwright)

- **Sentinel email** : `playwright-test-{ts}[-{suffix}]@mailinator.com`
  (cf. `tests/e2e/helpers/guards.ts:70` `generateTestEmail`). Tout user
  créé par un test E2E doit utiliser ce pattern — il permet le cleanup
  ciblé sans toucher aux données réelles.
- **Helpers seed canoniques** : `seedConsumer` / `seedProducer` (jamais
  bypass). Préservent l'invariant sentinel + audit logs.
- **Cleanup auto** : via Playwright `global-setup` / `global-teardown`.
  À chaque run, les résidus matching le sentinel sont purgés.
- **Cleanup manuel** :
  `npx tsx scripts/cleanup-test-residuals-e2e.ts [--dry-run] [--min-age-hours=N]`
  (wrapper CLI standalone sur `sweepE2EResiduals`, utile hors lifecycle
  Playwright : cron, debug).
- Voir doctrine `docs/conventions/regression-tests-security.md` pour
  les invariants sécu E2E (RLS, helpers, sentinel pattern).

### Pattern de mocking Vitest (référence)

Voir `docs/conventions/vitest-mocking-patterns.md`. Trois patterns
dominants :
1. `importOriginal` dans `vi.mock` pour préserver les exports
   transverses d'un module partagé.
2. Imports directs (`@/components/ui/button`) vs barrel
   (`@/components/ui`) en tests jsdom — éviter le barrel.
3. `act()` autour des helpers DOM custom qui déclenchent `setState`.

## 6. Conventions code

- **TypeScript strict** activé. Pas de `any` sans justification
  commentée.
- **Alias chemin** : `@/*` → racine du repo. Préférer `@/lib/foo` à
  `../../lib/foo`.
- **Nommage** :
  - Composants React : `PascalCase.tsx` (ex : `DistanceWidget.tsx`)
  - Lib/utils : `kebab-case.ts` (ex : `coords.ts`, `fetch-public.ts`)
  - Tests : miroir du fichier source + `.test.{ts,tsx}`
  - Migrations SQL : `YYYYMMDDHHMMSS_nom_snake.sql`
- **Structure** :
  - `app/` — App Router (route groups : `(consumer)`, `(producer)`,
    `(admin)`)
  - `lib/` — logique métier réutilisable, par domaine (`auth`, `stripe`,
    `orders`, `producers`, etc.)
  - `components/` — composants React (par destination : `consumer`,
    `producer`, `admin`, `ui` shared)
  - `tests/` — miroir de l'arbo source
  - `scripts/` — scripts one-shot ou récurrents (lancés via `tsx`)
  - `supabase/migrations/` — migrations SQL
  - `docs/` — documentation : `conventions/`, `fixes/`, `incidents/`,
    `runbooks/`, `security/`, `rgpd/`, `audits/`, `decisions/` (ADRs),
    `CHANGELOG.md`, `LESSONS.md`, `post-launch-checklist.md`. Pas de
    `TODO.md` ni de `backlog/` (cf. règle d'or 3).
- **Types partagés** : colocation préférée. Types DB / enums générés par
  `npm run codegen:enums`.
- **Apostrophe** : ASCII droit `'` en JS, `&rsquo;` ou `&apos;` en JSX
  texte. L'apostrophe courbe U+2019 est bloquée par ESLint.
- **Storage keys** : préfixe `terroir_` strict sur `localStorage` /
  `sessionStorage` (ex : `terroir_geo_session`). Bloqué par ESLint
  sinon.

## 7. Secrets et variables d'environnement

Variables déclarées dans `.env.example` (template, committé) et
`.env.local` (valeurs réelles dev, JAMAIS committé). Pour prod :
déclarées dans Vercel (Production + Preview).

Critiques (extrait `.env.example`) :

| Variable                        | Rôle                                           |
|---------------------------------|------------------------------------------------|
| `NEXT_PUBLIC_SUPABASE_URL`      | URL projet Supabase                            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clé publique Supabase (client)                 |
| `SUPABASE_SERVICE_ROLE_KEY`     | Clé service Supabase (serveur, bypass RLS)     |
| `NEXT_PUBLIC_APP_URL`           | URL consumer                                   |
| `NEXT_PUBLIC_PRODUCER_URL`      | URL producteur                                 |
| `NEXT_PUBLIC_ADMIN_URL`         | URL admin                                      |
| `STRIPE_SECRET_KEY`             | Clé secrète Stripe (test ou live)              |
| `STRIPE_WEBHOOK_SECRET`         | Secret signature webhook Stripe                |
| `RESEND_API_KEY`                | Clé Resend (envoi email)                       |
| `RESEND_WEBHOOK_SECRET`         | Secret webhook Resend                          |
| `TWILIO_AUTH_TOKEN`             | Token Twilio SMS                               |
| `UPSTASH_REDIS_REST_TOKEN`      | Token Upstash (rate-limit)                     |
| `EMAIL_CHANGE_OTP_SECRET`       | HMAC OTP changement email                      |
| `CRON_SECRET`                   | Auth header cron Vercel                        |
| `OPT_OUT_TOKEN_SECRET`          | HMAC tokens opt-out RGPD                       |
| `ROLE_SNAPSHOT_SECRET`          | HMAC cookie cache rôle middleware              |
| `SENTRY_AUTH_TOKEN`             | Token Sentry upload sourcemaps                 |

### Règles

- Aucun secret committé. `.gitignore` exclut `.env.local`, `.env.*.local`.
- Aucun secret hardcodé dans le code source. Si CC repère un secret en
  clair, il le déplace en variable d'env immédiatement.
- Aucun secret affiché dans les logs ou les messages d'erreur.
- Rotation = invalidation immédiate côté users (OTP en vol, tokens
  opt-out, sessions snapshot). CC le signale à Romain avant toute
  rotation.

## 8. Pièges connus

Section vivante. CC met à jour à chaque incident, chaque piège évité,
chaque action UI-only confirmée.

### Actions UI-only confirmées (Romain exécute en pas-à-pas)

Actions qui n'ont aucun équivalent API/CLI/MCP au moment de cette
vérification. Le détail pas-à-pas (chemin de clic, valeurs exactes,
conditions de déblocage) vit dans `docs/post-launch-checklist.md`. Ici
on garde la **liste type** pour que les sessions futures n'aient pas à
re-vérifier l'absence d'API.

- **Stripe Connect KYC personne physique** — UI Stripe par nature
  (vérification identité réelle). Pas d'équivalent API.
- **Supabase Auth — SMTP custom** — Dashboard > Project Settings > Auth
  > SMTP Settings. Aucune CLI/API officielle pour configurer le SMTP
  Auth.
- **Supabase Auth — templates email** (Magic Link, Reset Password,
  Confirm Signup, Change Email, Invite User) — Dashboard > Auth > Email
  Templates. Pas d'API.
- **Supabase Auth — HIBP password protection toggle** — Dashboard >
  Settings > Auth > Password Strength. Pas d'API. Pré-requis : Pro plan.
- **Stripe Connect branding** (logo, couleurs, accent color des pages
  `/connect/*`) — Dashboard > Settings > Branding. Pas d'API officielle.
- **Création de compte / projet sur services tiers** (Sentry, PostHog
  cloud, Resend, Twilio achat numéro FR) — UI par nature. Une fois le
  projet créé, la suite (env vars, settings) est souvent
  automatisable via CLI provider ou `vercel env add`.

Si une nouvelle action est découverte UI-only, l'ajouter ici **et**
ajouter le détail pas-à-pas dans `docs/post-launch-checklist.md` avec
la condition de déblocage.

### Email deliverability

- Email Auth envoyé depuis `auth@send.terroir-local.fr` (subdomain
  authentifié DKIM via Resend SMTP custom). Tout email d'auth doit partir
  depuis ce subdomain — ne pas régresser sous peine de retour en spam.

### Next 16 / React 19 (validés en prod)

- Server action sur route protégée : `redirect()` serveur >
  `return state` quand l'action invalide la session (sinon middleware
  redirect parasite).
- `useEffect` qui chain actions : toujours wrapper `startTransition()`
  autour des `actionDispatch(formData)` hors `<form action>`.
- Form auto-reset React 19 : pour tests E2E loop fill+click, basculer
  en controlled (`useState`), sinon iteration N+1 submit avec input vide.
- Dev mode Next Turbopack : `notFound()` retourne status 200 (quirk).
  Asserter sur contenu, pas sur status.

### Playwright sur Windows

- `test.skip`, `test.fixme`, `test.describe.skip` non-fonctionnels (bug
  upstream sur ce setup). Workaround : remplacer le body par un
  commentaire passant + body vide.
- Multi-spec runs crashent le dev server Next 16 après ~3 min
  (`ECONNREFUSED`). Workaround : run par spec
  (`npx playwright test <spec> --workers=1`), ou utiliser
  `npm run build && npm run start` au lieu de `next dev`.

### Git worktree + junction Windows node_modules

- `git worktree add ../<path>` + jonction Windows
  (`mklink /J node_modules ../main/node_modules`) marche pour `vitest`,
  `tsc --noEmit`, `eslint`. Tous les checks classiques passent.
- En revanche `next build` (Turbopack) échoue avec
  `TurbopackInternalError` sur `Project::get_all_endpoint_groups_with_app_route_filter`
  → le resolver Turbopack ne traverse pas correctement la jonction
  Windows (probablement résolution canonique de path qui désynchronise
  les root finders).
- **Workaround** pour les patches courts : faire le travail sur le main
  working tree directement (stash + branch switch + build + branch back
  + stash pop). Pour les chantiers longs en parallèle : `npm install`
  complet dans le worktree (lourd mais Turbopack est content).

### Stripe

- Idempotency cancel orphelin : check `pi.id !== winningPiId` AVANT
  cancel le PI, sinon 2 POST simultanés mêmes params déclenchent
  l'idempotency match Stripe et compensent en cancel le PI gagnant
  lui-même.
- Wording certifié DGCCRF (`lib/producers/declaration-veracite.ts`) :
  immutable strict. Toute modif (même typo) = nouvelle version `v1.x`,
  jamais correction sur version courante (valeur probatoire des
  snapshots).
- Wording Stripe Connect interdit : « jamais détenus par TerrOir ».
  Préférer : « transitent par Stripe » + mention chargeback CB + Connect
  indépendant.

### Privacy / RLS

- Trigger `producers_block_owner_admin_columns` (BEFORE UPDATE) bloque
  les self-updates producteur sur 25 colonnes admin-only (lat/lng
  inclus).
- Pour UPDATE admin manuel via SQL Studio Supabase : `SET ROLE
  service_role` explicite obligatoire (superuser ne bypass pas le
  trigger).
- Helpers `SECURITY DEFINER` consommés par les policies RLS
  (`is_admin()`, `owns_producer(uuid)`, etc.) nécessitent EXECUTE pour
  `anon` + `authenticated`. Faux positif récurrent d'audit ACL.

### Schémas DB

- **`producer_invitations` n'a PAS de colonne `status`** — les états
  (consommée / expirée / révoquée) doivent être **computed côté query** :
  - consommée = `used_at IS NOT NULL`
  - expirée = `used_at IS NULL AND expires_at < now()`
  - en attente = `used_at IS NULL AND expires_at >= now()`
  Si une PR future a besoin d'un statut révoqué explicite (cf. event
  `invitation_revoked` pré-déclaré, jamais émis), ajouter une colonne
  `revoked_at timestamptz NULL` plutôt qu'un enum `status`.
- **Jointures admin → identité (post-PR #130)** : PostgREST ne traverse
  PAS le schema `auth.*`. Une FK vers `auth.users(id)` (ex:
  `producer_invitations.created_by`) ne peut PAS être consommée via une
  jointure embarquée Supabase JS — elle plante avec « Could not find a
  relationship in the schema cache ». Pattern obligatoire : **fetch
  séparé sur `admin_users`** (`id` = FK vers `auth.users.id`), lookup
  `Map` sur IDs distincts non-null, fail-safe en cas d'erreur. Et
  `admin_users.PK = id`, jamais `user_id` (les mocks vitest ne
  détectent pas le mismatch). Doctrine complète dans
  `docs/LESSONS.md` § « Admin surfaces / Jointures Supabase ».

### ESLint

- L'apostrophe courbe U+2019 est interdite **aussi bien dans les
  attributs JSX `"..."`** (valeurs de props string) **que dans le
  texte JSX**. Le décodage `&rsquo;` se fait au parse JSX et donne
  U+2019 dans la valeur d'attribut, ce qui trip la règle
  `no-restricted-syntax` `Literal[value=/’/]`. Préférer ASCII `'`
  dans les valeurs d'attribut quotées : `label="Chiffre d'affaires"`.
  Dans le texte JSX, `&rsquo;` reste correct.

## 9. Communication entre Romain et CC

### CC vers Romain

- Tutoiement, français casual direct.
- Pas de préambule (« Bien sûr ! », « Très bonne question », etc.).
- Pas de récap inutile à la fin (« Pour résumer, j'ai donc... »).
- Pas de jargon technique sauf demande explicite.
- Si CC est bloqué : UNE question claire en texte normal, pas de fenêtre
  de choix multiples.
- Si CC voit un truc qui sent mauvais (sécurité, RGPD, qualité) : flag
  direct, même si Romain n'a pas demandé.

### Romain vers CC

- Direct sur les erreurs.
- Attend des évaluations honnêtes, pas de validation creuse.
- Valorise le pushback constructif (si CC n'est pas d'accord avec une
  décision, il le dit avec arguments).

### Si CC se trompe

- Reconnaissance directe, pas de défense automatique.
- Correction immédiate sans demander pardon en boucle.
- Mise à jour de la section « Pièges connus » si l'erreur révèle un
  piège réutilisable.

### Si Romain se trompe

CC a non seulement le droit mais le DEVOIR de pousser en retour avec
arguments quand une décision de Romain :
- est sale techniquement (raccourci, dette imposée, anti-pattern),
- est dangereuse (sécurité, RGPD, perte de données),
- contredit la règle d'or 2 (propreté comme seul critère),
- repose sur une prémisse fausse (info périmée, confusion factuelle).

CC ne valide JAMAIS par défaut. La validation creuse est explicitement
rejetée par Romain.

Procédure :
1. CC explique pourquoi la décision est problématique (arguments
   concrets : risque X, conséquence Y, alternative propre Z).
2. Romain tranche.
3. Si Romain confirme malgré le pushback : CC exécute, MAIS trace la
   décision dans la conversation (« j'exécute X comme demandé après
   pushback ; conséquence assumée : Y »). La trace sert au futur CC
   qui hériterait du contexte.

## 10. Checklist de fin de session

Avant de rendre la main à Romain, CC vérifie systématiquement :

1. **Tests verts** : `npm test` passe. Si E2E touché : `npm run test:e2e`
   passe (ou au moins les spec impactées).
2. **Lint clean** : `npm run lint` retourne 0 erreur. Les warnings sont
   analysés (pas ignorés).
3. **Type-check propre** : `npm run type-check` retourne 0 erreur.
4. **Build OK** : `npm run build` réussit. Pas seulement « ça compile en
   dev ».
5. **Migrations appliquées** : si des migrations ont été écrites, elles
   sont appliquées en prod via MCP + smoke tests reportés.
6. **Branche poussée** : le travail est sur GitHub
   (`git push origin <branche>`).
7. **PR ouverte si nécessaire** : si le chantier est terminé, PR créée
   vers `master` avec description claire (résumé, motivation, points de
   vigilance).
8. **CHANGELOG / docs à jour** : si le chantier mérite une trace
   (`docs/CHANGELOG.md`, `docs/fixes/<chantier>.md`, doc convention si
   nouvelle règle), CC l'écrit avant de rendre.
9. **`.env.example` à jour** : si une nouvelle variable d'env a été
   ajoutée, elle est documentée dans `.env.example` avec commentaire et
   valeur factice.
10. **Pas de fichiers parasites committés** : pas de fichier de log, pas
    de `tree.txt`, pas de fichiers de debug.

Si un des 10 points casse, CC le signale à Romain au moment de rendre
la main (« j'ai fini, mais X ne passe pas parce que Y »).

---

Date de réécriture : 2026-05-12
Cycle de référence : passage aux sub-agents natifs CC (abandon TA/TB/TC/TT)
