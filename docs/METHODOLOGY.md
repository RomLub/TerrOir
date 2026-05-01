# METHODOLOGY — TerrOir

> Document vivant qui décrit la méthodologie de travail entre Romain, Claude (chat web) et Claude Code (CC).
> À mettre à jour quand une règle change ou qu'une leçon récurrente mérite d'être codifiée.

## Objectif

Permettre à toute nouvelle instance Claude (chat web ou CC) de reprendre le travail sans perdre le tempo de collaboration établi. Ce document fixe **comment** on travaille ; `docs/HANDOFF.md` fixe **sur quoi**. Voir `docs/README.md` pour l'index complet de la documentation.

## Communication avec Romain

> **Section critique. À lire EN PREMIER par toute nouvelle instance Claude (chat web ou CC). Tout le reste du document découle des principes ci-dessous.**

### Romain est feignant. Et c'est volontaire.

Romain est l'humain le plus feignant du monde. Tout effort cognitif inutile que tu lui demandes est une violation du contrat de collaboration. Ce n'est pas un trait négatif — c'est délégué exprès : Romain s'occupe du business, des décisions produit, de la stratégie ; toi tu absorbes la complexité technique pour qu'il puisse rester focus.

**Conséquences pratiques** :

- **Si tu peux faire à sa place, tu fais.** Pas de "tu peux lancer cette commande pour moi ?" si tu peux la lancer toi-même.
- **Si tu peux trancher pour lui sur des décisions à faible enjeu** (nommage de variable, ordre des arguments, micro-refacto, structure d'un commentaire), **tu tranches**.
- **Tu ne lui poses une question QUE** si la réponse est nécessaire pour avancer ET que tu ne peux pas la déduire toi-même.
- **Tu ne lui demandes pas** de re-vérifier des choses que tu peux vérifier (status git, build OK, tests verts, fichier existant, etc.).
- **"Veux-tu que je continue ?" à chaque message est interdit.** Romain dira lui-même quand stopper.

### Romain n'est PAS développeur

Romain est entrepreneur et vibecoder. Il a une intuition produit redoutable mais pas la base technique d'un dev. **Tout ce que tu lui dis doit être compréhensible par un enfant de 10 ans intelligent**.

**Règle d'or** : si tu utilises un terme technique, tu l'expliques en 1 ligne juste après. Si tu cites un nom de fonction ou de module, tu expliques ce qu'il fait. Pas "le `useFormState` chaining déclenche prématurément `completeAction`" mais "le hook qui gère l'état du formulaire (`useFormState`) lance la dernière étape (`completeAction` = finalisation du changement d'email) avant que l'utilisateur n'ait saisi son code".

**Exemples concrets de jargon à reformuler** :

| ❌ Jargon brut | ✅ Reformulé pour Romain |
|---|---|
| "Transport-only SDK" | "L'outil ne fait que envoyer des requêtes, il ne stocke rien" |
| "useFormState chaining déclenche prématurément" | "Les états des 2 formulaires sont mélangés, le 2e se lance trop tôt" |
| "Constant-time HMAC compare" | "Comparaison sécurisée qui prend toujours le même temps, pour qu'un attaquant ne puisse pas deviner le code lettre par lettre" |
| "Pattern @supabase/ssr cookies HTTP" | "Supabase stocke la session dans un cookie HTTP côté serveur, pas dans le navigateur" |
| "FK ON DELETE CASCADE" | "Quand on supprime le user, sa fiche profil est aussi supprimée automatiquement" |
| "Strict mode violation" | "Playwright a trouvé 2 éléments qui matchent ton sélecteur, il refuse de cliquer parce qu'il sait pas lequel" |
| "Patch contents already upstream" | "Le commit a déjà été appliqué sur master, Git le saute automatiquement" |
| "Race condition sur l'INSERT" | "Deux requêtes arrivent en même temps, l'ordre est imprévisible, ça peut casser" |

Quand tu cites un fichier, donne le chemin ET ce qu'il contient ("`lib/email-change/hmac.ts` — la logique de signature qui hash les codes OTP avant stockage en DB"). Quand tu cites un commit, donne le SHA court ET ce qu'il fait.

### Trancher des recos claires

Romain n'aime pas choisir entre 5 options similaires. Présenter une liste de 5 options qui se ressemblent revient à transférer ton effort cognitif sur lui — exactement ce qu'on veut éviter.

**Règle** : 1 reco + 1 raison. Pas plus.

Si plusieurs options ont vraiment du sens, tu en proposes **2 maximum** et tu **recommandes explicitement la meilleure** avec ton argumentation. Pas "voici 3 options, à toi de voir" — Romain attend ton avis tranché.

Exemple :
- ❌ "Tu peux faire (a) split en 2 hooks, (b) garde de version via ref, (c) reset useState, (d) mock le tout, (e) refacto complet. À toi de choisir."
- ✅ "Reco : (a) split en 2 hooks, parce que c'est sémantiquement le plus propre et que (b) avec ref est un anti-pattern fragile. Si tu veux explorer (b), je peux détailler, mais (a) est mon choix."

### Prompts CC auto-suffisants

Quand tu rédiges un prompt destiné à une autre instance Claude (Code ou web), il doit être **complet et exploitable sans contexte additionnel**. Pas de placeholder type `[colle ici le bloc]` ou `[insère le diff]`.

Le prompt doit contenir directement la valeur attendue. Si tu fais référence à un commit, tu mets le SHA. Si tu fais référence à un fichier, tu mets le chemin complet. Si tu fais référence à une décision, tu rappelles cette décision en 1 ligne.

### Pattern dual-GO sur opérations à risque

Pour toute opération à risque (apply migration prod, force push, rebase complexe, modif env vars, suppression de branche, merge PR), pattern :

1. **Affiche l'action prévue** (commande exacte, scope, ce que ça va modifier).
2. **Attends GO 1 explicite** de Romain.
3. **Exécute**.
4. **Montre le résultat** (output complet ou résumé selon volume).
5. **Attends GO 2** avant l'étape suivante.

Pas d'enchaînement silencieux. Romain doit pouvoir relire entre chaque action.

### Auto-confirm OFF maintenu sur write-prod

Aucune exception. Toute écriture sur la prod (DB, env vars, MCP Supabase write, cron jobs, secrets rotation) passe par approbation manuelle Romain. Même si tu trouves ça lourd. Même si Romain a déjà approuvé une opération identique 5 minutes avant.

### Garde-fous brefs

Quand tu signales un risque ou un piège : **⚠️ + 1 ligne**. Pas un paragraphe d'avertissement qui noie l'info. Si l'info est critique, elle doit être visible immédiatement, pas planquée dans un mur de texte.

### Anti-patterns à proscrire

- ❌ Placeholder type `[colle ici X]` dans les messages → coller directement la valeur attendue.
- ❌ S'inquiéter de la fatigue de Romain ("tu veux faire une pause ?") → laisser Romain juger par lui-même.
- ❌ Suggérer "on continue ou on stoppe ?" à chaque message → Romain dira lui-même quand stopper.
- ❌ Demander des confirmations sur des décisions évidentes que Romain a déjà prises implicitement.
- ❌ Hedging ("peut-être que", "il se pourrait que", "ça pourrait être une bonne idée") → affirmations directes.
- ❌ Compliments gratuits ("excellente question", "parfait choix") → exécuter, pas flatter.

### Style d'écriture

- **Français**, ton casual, direct.
- Pas de hedging.
- Sobre, pas de flattering.
- Quand Romain tranche, exécute sans revenir sur la décision sauf information nouvelle qui change le contexte.
- **Pas de suggestion de pause**. Romain décide de son rythme.

## Rôles

| Acteur | Périmètre | Outils |
|---|---|---|
| **Romain** | Décisions produit, validation finale, tests prod, arbitrages business, apply des migrations DB | Navigateur, Supabase Studio, Stripe Dashboard, Vercel Dashboard, Mailinator |
| **Claude (chat web)** | Décomposition des chantiers, rédaction des prompts CC, arbitrages architecturaux, coordination parallélisation, review de rapports | Chat Claude.ai |
| **Claude Code (CC, terminaux TA/TB/TC)** | Exécution du code, inspection préalable, tests, commits, push | CLI locale avec accès repo + MCP |

## Parallélisation 3 terminaux (TA / TB / TC)

- Jusqu'à **3 terminaux CC en parallèle** (TA, TB, TC).
- **Règle critique** : éviter que 2 terminaux touchent le même fichier en même temps.
- Si overlap possible → **séquencer** ou **fractionner** les prompts pour que chaque terminal ait son périmètre strict.
- Avant de lancer un prompt en parallèle, Claude doit vérifier que les fichiers cibles sont disjoints des autres prompts en vol.

### Bonnes pratiques git en working tree partagé (consolidé 25/04)

Les 3 terminaux CC travaillent sur le même working tree local. Un terminal peut donc embarquer par accident des modifications en cours d'un autre terminal si le staging est imprécis. **5 règles à respecter dans l'ordre, sans en sauter** :

1. **`git add <fichier précis>` systématique.** JAMAIS `git add .` ni `git add -A`. Lister chaque chemin explicitement à la commande.
2. **`git status` AVANT chaque `git add`** pour observer l'état de l'index global. Pas après — *avant*, pour anticiper ce que tu vas trouver.
3. **Si fichiers staged qui ne sont pas les tiens** → `git reset HEAD <files>` préventif pour nettoyer l'index avant de stager les tiens. OU stop, signale, et attends que l'autre terminal commit.
4. **`git diff HEAD --name-only` AVANT commit** pour confirmer que le diff correspond aux modifs que tu as **vraiment** faites. Comparer avec `git status` pour repérer ce qui ne t'appartient pas.
5. **Si tu détectes un working tree avec WIP d'un autre terminal pré-staged** → STOP, signale, attends. Ne pas tenter de « commiter autour ».

**Piège QA local** : `npx tsc --noEmit` et `npm run build` peuvent **passer localement** parce que le working tree inclut les modifs incomplètes des autres terminaux qui se complètent mutuellement (rename + update d'imports postés par 2 terminaux différents). **Vercel rejoue chaque commit ISOLÉMENT** — un commit qui n'embarque pas l'ensemble cohérent fera échouer le deploy de ce commit-là, même si HEAD master final est OK. Bisect-unfriendly.

### Incidents documentés

- **Nuit 22→23/04/2026** : TA (page admin leads) et TC (toggle `showAll`) ont tous les deux modifié `/gestion-producteurs/page.tsx`. Le commit TA a embarqué les modifs TC en cours → commit label « impur » (logique TC livrée sous message TA). Code final correct, historique git confus. Mitigation : planifier les périmètres en amont et fractionner si collision possible.
- **23/04/2026 soir** (commit `5e1a48a docs(todo)`) : le commit docs a embarqué par accident 3 migrations SQL WIP de TC (chantier conseil éleveur) parce que le terminal docs a staged large au lieu de cibler. Mitigation : règle `git add <fichier précis>` systématique + vérif `git status` avant push.
- **25/04/2026 fin d'après-midi** (commit `11b914e fix(carte)`) : TT a embarqué par accident 3 renames du chantier connexion TA en cours (`app/(public)/connexion/*` → `app/connexion/*`) via working tree partagé. Build Vercel ko sur ce commit isolément à cause des imports périmés non encore fixés (TA finissait en parallèle). HEAD master final `2652e4d` OK, mais 2 commits intermédiaires bisect-unfriendly. **C'est cet incident qui a motivé la consolidation des 5 règles ci-dessus** (vs la règle initiale « `git add` précis » seule, jugée nécessaire mais non suffisante). Bonne pratique observée le même jour : TC a fait `git reset HEAD <files>` préventif après détection d'un staging inattendu — pattern à répliquer.

## Cleanup d'une branche de chantier post-merge

### Quand et pourquoi

Une branche de chantier (ex: `chantier/playwright-setup`) qui a mergé une PR pour pré-tester son code va se retrouver en doublon avec master une fois la PR squash-mergée. Exemple vécu 30/04/2026 :

- `chantier/playwright-setup` contenait : 4 commits infra Playwright + 14 commits PR2 mergés via merge commit `fec5176` + 1 cherry-pick fix bug (`ad23f47`) + 1 commit chantier final (`c0c9e54`).
- PR #88 (PR2) squash-mergée sur master → master gagne **1 seul commit** `da801b8` qui contient tout PR2 + le fix bug.
- La branche chantier contient toujours les 14 commits PR2 individuels + le merge commit, mais leur effet est désormais sur master sous une autre forme (squashé).

### Stratégie : reset hard + cherry-pick (pas rebase classique)

Un `git rebase origin/master` essaye de **rejouer chaque commit individuel** sur le nouveau master. Git détecte que les premiers patches sont déjà upstream (skip auto via "patch contents already upstream"), mais dès qu'un commit a touché un fichier qui a été modifié par d'autres commits dans le squash, les hunks ne matchent plus → conflit.

Conséquence vécue : sur 14 commits PR2 à rejouer, ~9 conflits manuels à trancher pour rien (puisque l'effet final est déjà sur master sous le squash).

**Pattern correct** :

1. `git rebase --abort` si tu as commencé un rebase qui conflicte.
2. `git checkout chantier/<nom>` puis `git status` (working tree clean, modulo untracked hors scope).
3. `git fetch origin` pour avoir master à jour.
4. **Noter les SHA exacts** des commits propres au chantier (ceux qui n'étaient PAS dans la PR mergée) avant le reset. `git log --oneline -10` puis copier les hash.
5. `git reset --hard origin/master` ⚠️ **destructif** mais réversible via `git reflog` si erreur.
6. `git cherry-pick <sha1> <sha2> <sha3> ...` dans l'ordre chronologique pour rejouer les commits chantier sur le nouveau master. Les SHA changeront (rebased) — c'est normal.
7. Sanity checks : `npx tsc --noEmit` + `npm test` + lecture `git log` pour confirmer historique linéaire avec master en parent direct.
8. `git push --force-with-lease origin chantier/<nom>` (jamais `--force` brut — `--force-with-lease` refuse le push si quelqu'un a poussé entre temps, sécurité importante).

### Quand préférer un autre pattern

- **Branche chantier sans doublons avec la PR** (chantier purement parallèle qui ne touche pas les mêmes fichiers) : `git pull --rebase origin master` peut suffire sans conflits.
- **Branche chantier qui sera elle-même mergée bientôt** : ne pas la cleaner, juste merger directement.
- **Tu n'es pas sûr des SHA à conserver** : `git log --oneline` AVANT le reset pour les noter, puis double-check avant d'exécuter le reset.

## Pattern de chantier CC

Chaque chantier non-trivial suit ce cycle, sans sauter d'étape :

1. **Inspection préalable** — CC lit les fichiers concernés, produit un rapport avec :
   - Structure actuelle (quel fichier fait quoi)
   - Structure proposée
   - Questions ouvertes ou arbitrages nécessaires
   - Risques identifiés (migrations, ruptures de contrat, impacts cross-fichier)
2. **Validation du plan** — Romain ou Claude (chat) valide / ajuste les décisions. Aucun code n'est écrit tant que le plan n'est pas validé, sauf tâche triviale.
3. **Code** — CC implémente strictement dans le périmètre validé.
4. **Auto-QA obligatoire** (cf section dédiée).
5. **Commit normé + push** (cf commits conventionnels).
6. **Rapport de résultat** — CC renvoie :
   - Hash du commit
   - Fichiers touchés
   - Notes importantes (migrations à apply, tests à faire côté Romain, dettes créées)

Pour les tâches triviales (fix typo, rename évident, etc.) les étapes 1 et 2 peuvent être fusionnées en une inspection-courte + implémentation directe.

## Commits conventionnels

Format : `type(scope): message`

Types utilisés :

| Type | Usage |
|---|---|
| `feat` | Nouvelle feature |
| `fix` | Correction de bug |
| `refactor` | Restructuration sans changer le comportement observable |
| `chore` | Cleanup, suppressions, réorganisation fichiers |
| `docs` | Documentation projet (voir `docs/README.md` pour l'index) |
| `test` | Ajout ou modification de tests |
| `style` | Formatting, indentation (jamais de logique) |

Exemples réels :
- `feat(rgpd): standalone opt-out link request form`
- `refactor(admin): extract shared MetricCard component (Phase C.2)`
- `fix(stripe): prevent duplicate payment methods via fingerprint check`

Le message reste concis (< 72 caractères idéalement sur la 1re ligne). Body optionnel pour les refactos complexes.

## Auto-QA obligatoire avant push

Avant chaque `git push`, CC doit lancer **dans cet ordre** :

1. `npx tsc --noEmit` — type-check strict.
2. `npm run build` — build production Next.js.

Ne **pas** se contenter de `npx tsc --noEmit` quand un refactor supprime, déplace ou renomme un fichier : `tsc` ne reproduit pas la résolution de modules webpack et laisse passer des imports morts. `npm run build` est le seul garant.

Si erreur → fix puis re-run, OU rapport à Romain/Claude si blocage de conception.

## Tests prod

- **Un test à la fois**, pas tous d'un coup.
- Tests manuels par Romain (Playwright E2E disponible depuis 30/04/2026 pour les flows critiques, cf. section dédiée).
- Validation incrémentale : on ne passe à la feature suivante qu'après validation de la précédente.
- Pour les flows multi-étapes (checkout, RGPD suppression, invitation onboarding), lister les cas à tester **avant** de pousser, pour que Romain les valide un par un.

## Tests E2E Playwright

Mis en place lors du chantier `chantier/playwright-setup` (30/04 → 01/05/2026). Premier test E2E réel : `tests/e2e/change-email.spec.ts` (T-013 PR2 happy path).

### Pyramide de tests TerrOir

- **80% unit** (vitest, helpers + fonctions pures) : `tests/lib/email-change/hmac.test.ts`, `tests/lib/auth/sanitize-next.test.ts`, etc.
- **15% intégration** (vitest, server actions avec mocks Supabase) : `tests/app/(consumer)/compte/profil/_actions/integration-flow.test.tsx`.
- **5% E2E** (Playwright, parcours complet UI + DB prod) : `tests/e2e/*.spec.ts`.

**Convention TerrOir** : pas d'`@testing-library/react`. Tout test UI passe donc par Playwright. Si une feature ne peut être testée qu'au niveau composant React, on accepte de ne pas avoir de test unit pour elle et on couvre via Playwright.

### Helpers existants (`tests/e2e/helpers/`)

| Helper | Rôle |
|---|---|
| `test-context.ts` | Fixture Playwright `ctx: TestContext` avec `runId` (worker scope) + `testId` + `trackedIds`/`trackedEmails` (test scope). Cleanup auto en afterEach. |
| `guards.ts` | Allow-list email pattern `playwright-test-{ts}@mailinator.com` + deny-list 4 emails personnels. `assertSafeEmail()` throw si non-safe. `generateTestEmail(suffix?)` produit un email conforme. |
| `supabase-admin.ts` | 4 helpers `safeInsert/safeUpdate/safeDelete/safeUpsert` qui valident email + tracking IDs + écrivent un audit log JSONL. `getReadOnlyAdminClient()` pour les SELECT post-flow (sans risque). |
| `user-lifecycle.ts` | `createTestUser(ctx, options?)` crée un user via `auth.admin.createUser` ET INSERT la row `public.users` (reproduit le pattern signup prod `actions.ts:102-110`). `loginAs(page, user)` traverse le formulaire `/connexion` réel (pas de bypass localStorage). `cleanupTestUser` cascade. |
| `otp-capture.ts` | `seedOtp(ctx, opts)` DELETE+INSERT une row OTP avec hash d'un code clair connu. `assertOtpRowExists`, `assertAuditLogContains` pour vérifier l'état post-flow. |
| `audit-log.ts` | Append JSONL `tests/e2e/.audit-log.jsonl` (gitignored) à chaque write des helpers safe*. Permet le debug post-mortem ("qu'est-ce qui a été écrit ce run ?"). |

### Pattern type pour ajouter un test E2E

```ts
import { test, expect } from "./helpers/test-context";
import { generateTestEmail } from "./helpers/guards";
import { createTestUser, loginAs } from "./helpers/user-lifecycle";
import { seedOtp } from "./helpers/otp-capture";
import { getReadOnlyAdminClient } from "./helpers/supabase-admin";

test.describe("Mon flow (T-XXX)", () => {
  test("happy path", async ({ page, ctx }) => {
    // 1. Setup user (auth.users + public.users)
    const user = await createTestUser(ctx, { suffix: "happy" });
    await loginAs(page, user);

    // 2. Naviguer
    await page.goto("/compte/profil");

    // 3. Stratégie seed : attendre un hint discriminant qui garantit
    //    que le serveur a fini son INSERT avant de DELETE+INSERT notre row
    await expect(page.getByText(/discriminateur unique/i)).toBeVisible();
    await seedOtp(ctx, { userId: user.id, step: "current", email: user.email, code: "123456" });

    // 4. Assertions DB post-flow via getReadOnlyAdminClient
    const admin = getReadOnlyAdminClient();
    const { data } = await admin.from("...").select("...").eq("id", user.id).single();
    expect(data).toBeDefined();
  });
});
```

### Lancement

1. **Terminal séparé** : `npm run dev` (Romain le lance, pas CC). Le serveur Next.js doit répondre sur `localhost:3000` AVANT de lancer Playwright.
2. **Terminal CC** : `npx playwright test tests/e2e/[spec].spec.ts --reporter=list`.
3. **Volumétrie** : ~10-20 tests E2E max pour respecter le quota Resend (~3000 mails/mois).

### Pièges connus

- ⚠️ **Strict mode violations** : Playwright refuse les sélecteurs ambigus qui matchent plusieurs éléments. Solutions : `{ exact: true }` sur `getByLabel`/`getByRole`, ou phrases discriminantes complètes (ex : `getByText(/Saisissez le code à 6 chiffres reçu à votre adresse actuelle/i)` au lieu de `getByText(/à votre adresse actuelle/i)` qui matchait aussi un paragraphe header).
- ⚠️ **Cookies Supabase SSR vs localStorage** : `loginAs` DOIT passer par le formulaire UI réel (`page.goto('/connexion')` + fill + submit). Une injection synthétique dans `localStorage` ne marche pas — `@supabase/ssr` lit la session depuis les cookies HTTP côté serveur, pas depuis localStorage côté client.
- ⚠️ **`RESEND_API_KEY` `.env.local`** : vérifier qu'elle est valide AVANT tout test E2E qui déclenche un envoi mail. Une clé cassée fait que `sendTemplate` retourne `{ ok: false }` silencieusement, et le serveur affiche "Impossible d'envoyer le code" sans cause évidente. Diagnostic : grep `[EMAIL_SEND_FAIL]` dans les logs `npm run dev`, ou query `SELECT metadata->>'error' FROM public.notifications WHERE statut='failed'` (rows purgées par cleanup donc fenêtre courte).
- ⚠️ **`auth.admin.createUser` ne crée PAS la row `public.users`** : il n'y a pas de trigger DB qui le fait automatiquement (cf. migration `20260419000000`). Le pattern signup prod fait l'INSERT manuel (`app/(consumer)/auth/inscription/actions.ts:102-110`). Le helper `createTestUser` reproduit ce pattern avec fail-fast.
- ⚠️ **Tracking `trackedIds` unifié** : le Set `ctx.trackedIds` contient à la fois les UUIDs user ET les UUIDs de rows OTP créées par `seedOtp`. `cleanupAllTrackedUsers` itère naïvement et appelle `auth.admin.deleteUser` sur chaque, produisant des warnings "User not found" sur les row UUIDs. **Non bloquant** (catché en interne) mais bruit visible dans les logs. Ticket T-021 prévu pour séparer `trackedUserIds` / `trackedRowIds`.
- ⚠️ **Stratégie seed timing** : avant un `seedOtp(ctx, { step })`, attendre la visibilité d'un hint UI **discriminant** qui garantit que le serveur a fini son INSERT (ex : transition step `verify-current` → `verify-new`). Sinon race condition : DELETE peut s'exécuter avant que le serveur ait inséré sa row.

## Migrations DB

- Fichiers dans `supabase/migrations/` avec préfixe timestamp `YYYYMMDDHHMMSS_description.sql`.

### Apply via CC + MCP Supabase (workflow standard depuis 30/04/2026)

Mis en place lors de T-013 PR1. CC dispose désormais du MCP Supabase en read-write sur le projet `exsxharjqqpohkbznhss`. **Activation** : config `~/.claude.json` scope local avec `features=database,docs` sur le serveur MCP Supabase (write-prod activé seulement sur ce scope, pas en global). Workflow nominal :

1. PR mergée sur master via GitHub (CC peut le faire via `gh pr merge --rebase --delete-branch` après approbation Romain).
2. `git pull origin master` local pour récupérer le fichier migration.
3. CC apply via MCP `apply_migration` en lisant le fichier depuis le repo local. La query passée au MCP doit **omettre les `begin;`/`commit;` explicites** : l'API Management `POST /v1/projects/{ref}/database/migrations` wrappe sa propre transaction et insère le row de tracking dans `supabase_migrations` après le DDL. Un `commit;` explicite couperait la transaction wrapper avant l'insert metadata.
4. CC vérifie via MCP `list_migrations` + `list_tables verbose=true` + `execute_sql` sur `pg_indexes` et `pg_tables.rowsecurity` que l'apply a réussi (indexes, contraintes, RLS).
5. ⚠️ **Gotcha timestamp** : le MCP génère son propre timestamp à l'apply (ex : `20260430161902`) au lieu de réutiliser celui du nom de fichier (ex : `20260430153937`). Conséquence : si le fichier disque garde l'ancien timestamp, un futur `supabase db push` local verra une migration disque non trackée en DB et tentera de la réapply → CREATE TABLE échoue. **Toujours renommer le fichier disque pour matcher le timestamp DB tracking** avant le commit doc final. Procédure : `git mv supabase/migrations/<old_ts>_<name>.sql supabase/migrations/<new_ts>_<name>.sql` (préserve trace de rename via R100).
6. CC commit + push update `HANDOFF.md` "Migrations apply confirmées prod" avec le timestamp DB final (post-rename).

⚠️ **Garde-fous obligatoires** :
- Auto-confirm OFF dans CC sur les outils MCP write : chaque appel `apply_migration` ou `execute_sql` non-trivial passe par approbation manuelle Romain.
- Lecture explicite de chaque SQL avant approbation. Identifier la clause `WHERE` sur les `UPDATE`/`DELETE`. Si manquante → refus.
- Migrations auth-sensibles (FK vers `auth.users`, RLS, triggers Supabase Auth) : validation explicite Romain avant push code, et re-validation explicite avant apply via MCP.
- **Tests collision UNIQUE / CHECK runtime non recommandés sur prod** : la garantie structurelle de `pg_indexes` (type, expression, predicate) suffit. PostgreSQL respecte ses contraintes par design. Le test runtime touche prod (WAL, triggers, locks) pour zéro info-gain.

### Apply manuel via Studio (fallback)

Mode pré-30/04/2026 (CLI Supabase non configurée à l'époque). Reste un fallback légitime si MCP indisponible (extinction Supabase, problème OAuth, panne Anthropic, etc.). Procédure :

1. Ouvrir Supabase Studio SQL Editor.
2. Copier-coller le DDL depuis le fichier migration (avec `begin;`/`commit;` cette fois — Studio ne wrappe pas).
3. Run.
4. Mettre à jour `HANDOFF.md` manuellement.

### Règle GRANT cross-schema

Toujours inclure les GRANT sur `supabase_auth_admin` quand une migration touche une FK vers `auth.users` (USAGE schema + ALL PRIVILEGES sur `public.*`). Sinon GoTrue renvoie « Database error querying schema » sur `/token` et `/recover`.

## Gestion de la dette technique

### Pendant un chantier en cours

- Dettes identifiées pendant un chantier hors scope → **note en TODO ou en dette HANDOFF**, pas de fix immédiat dans le commit en cours (pollution de scope).
- Fix immédiat uniquement si :
  - C'est un bug bloquant le chantier en cours.
  - Le fix est vraiment trivial (< 5 min, pas de risque de régression).

### Traitement systématique entre chantiers (décision Romain 2026-04-25)

**Principe** : toute dette technique identifiée se traite **dès qu'un terminal CC est libre**, même si l'impact utilisateur est nul ou minime. Pas de « ça attendra » ni de classement « non prioritaire » qui s'éternise.

**Raisons** :

- La dette qui s'accumule devient une dette qui ne se traite jamais — l'inertie l'emporte.
- Le coût marginal de fix immédiat est faible (terminal libre = ressource déjà allouée).
- Le coût de revisite plus tard est élevé (re-charger le contexte, re-comprendre le pourquoi, re-tester).
- L'objectif lancement = code aussi propre que possible le Day 1, pas de dette mentale qui pèse en background.

**Application** :

- Les dettes notées dans `HANDOFF.md` « Dettes techniques connues » → à traiter avant lancement.
- Les dettes flaggées par les terminaux dans leurs rapports → à traiter dès que le terminal libre devient dispo.
- Les pages/features incomplètes pour cause de pré-requis externe (ex: Mentions légales si la page n'existe pas) → exception : skip jusqu'à ce que le pré-requis soit prêt.
- Si un chantier semble être « skip-justifié » (cas Phase C.4 `SuccessConfirmation`) : **faire l'inspection, prendre la décision argumentée, la tracer dans `CHANGELOG.md`, retirer du TODO**. C'est aussi traiter — clore une dette par décision YAGNI vaut autant que la fixer.

### Priorisation dans `docs/TODO.md`

- 🔴 Bloquants lancement
- 🟠 En cours
- 🟡 Non bloquants
- 🔐 Avant lancement public (audit, sécurité, conformité)
- 🔵 Idées / améliorations
- 🗺️ Roadmap produit

## Secrets et sécurité

### Règle critique : jamais de secrets dans le chat

Les secrets (API keys, tokens, mots de passe, clés privées, service role keys) ne doivent **JAMAIS** être partagés dans le chat avec Claude, même dans un exemple `curl` ou pour du debugging. Un secret collé dans le chat est **instantanément compromis** et doit être roté sans délai.

**Bonnes pratiques :**

- **Tests `curl` / PowerShell** : stocker la clé dans une variable locale, ne coller que la commande qui la référence par la variable — jamais la valeur en clair.
  - PowerShell : `$key = "<paste-in-your-terminal-only>"; curl.exe -u "resend:$key" …`
  - Bash : `export KEY=<paste>; curl -u "resend:$KEY" …`
- **Screenshots** : masquer les tokens visibles avant d'envoyer. Au moindre doute, ne pas envoyer.
- **Si un secret est leaké par accident** :
  1. Révocation immédiate côté provider (Stripe, Supabase, Resend, OVH…).
  2. Génération d'une nouvelle clé.
  3. Audit des logs d'utilisation côté provider pour détecter un usage frauduleux avant rotation.
  4. Mise à jour des env vars Vercel / configs externes avec la nouvelle clé.

### Autres règles secrets

- **Env vars** gérées via **Vercel Dashboard** (pas de `.env.local` commité).
- Pas de hardcoding d'IDs de test ni de credentials dans le code livré en prod.
- Les logs doivent redacter les valeurs sensibles (pas de `console.log` brut d'un objet de réponse qui contient un token).

## Configurations externes critiques

Certaines configurations critiques vivent **hors du repo** et ne peuvent pas être versionnées. Elles doivent être documentées dans `docs/HANDOFF.md` (section « Configurations externes critiques ») pour reproduction et audit.

Périmètre typique :

- **Supabase Dashboard** : SMTP custom, email templates, Redirect URLs, Site URL, webhook hooks.
- **OVH Zone DNS** : enregistrements SPF, DKIM, DMARC, MX, CNAME Vercel.
- **Stripe Dashboard** : mode Test/Live, webhook endpoints, payment methods account-wide (Link).
- **Resend Dashboard** : domaines vérifiés, clés API.
- **Vercel** : env vars, domaines.

**Règle** : toute modification d'une de ces configs par Romain doit être reportée dans `docs/HANDOFF.md` dans la session où elle a été faite. Sinon un Claude frais (ou Romain dans 3 mois) ne pourra pas reproduire l'environnement.

## Taxonomie closure_reason

Champ DB : `orders.closure_reason` (string nullable). Renseigné lors d'une transition vers un statut terminal (`cancelled` ou `refunded`), ou lors d'un événement post-clôture qui modifie le motif (overwrites). Permet de tracer pourquoi un order a été clôturé sans devoir inférer depuis le contexte.

| Valeur | Type | Émetteur | Path | Sémantique |
|---|---|---|---|---|
| `admin_refund` | Pose initiale | Admin via UI | `app/api/stripe/refund/route.ts` | Refund manuel décidé par un admin (motif libre, pas de validation algorithmique). |
| `timeout` | Pose initiale | Cron (auto) | `app/api/cron/order-timeout/route.tsx` | Auto-annulation d'un order resté pending > 24h. |
| `consumer_cancel` | Pose initiale | Consumer via UI | `app/api/orders/[id]/cancel/route.tsx` | Consumer annule lui-même son order avant confirmation. |
| `stock` | Pose initiale | Producer via UI | `app/api/orders/[id]/cancel/route.tsx` | Producer annule pour rupture de stock. |
| `producer_cancel` | Pose initiale | Producer via UI | `app/api/orders/[id]/cancel/route.tsx` | Producer annule pour autre raison (indisponibilité, etc.). |
| `other` | Pose initiale | Default fallback | `app/api/orders/[id]/cancel/route.tsx` | Annulation avec motif "autre" (fallback hors taxonomie). |
| `payment_failed` | Pose initiale | Stripe webhook | `lib/stripe/handle-payment-failed.ts` | Webhook payment_intent.payment_failed — paiement Stripe refusé (3DS, fonds insuffisants, etc.). |
| `revival_blocked_stock` | Overwrite | Stripe webhook | `lib/stripe/handle-payment-succeeded.ts` | Path revival 3DS-retry : PI succeeded reçu après cancellation, mais stock pris entre-temps (RPC `revive_order_with_stock_check` retourne `blocked_stock`). Refund Stripe émis. |
| `revival_blocked_slot` | Overwrite | Stripe webhook | `lib/stripe/handle-payment-succeeded.ts` | Path revival 3DS-retry : PI succeeded reçu après cancellation, mais slot pris entre-temps (RPC retourne `blocked_slot`). Refund Stripe émis. |

### Notes

- **Multi-emitter** : `timeout` peut être posée par le cron (path principal) OU par `cancel/route.tsx` via le zod enum `reason` (cas où un acteur passe manuellement `closure_reason=timeout`). Si tu inférais l'émetteur depuis la valeur, tu aurais tort.

- **Overwrites** : `revival_blocked_stock` et `revival_blocked_slot` écrasent un `closure_reason='payment_failed'` posé initialement par le webhook payment_failed. Le `cancelled_at` reste figé, seul le motif change.

### Notes d'extension

- Toute nouvelle valeur DOIT être documentée dans cette table avant merge.
- Convention snake_case (cohérent DB).
- Pas de migration DB requise (champ `string` libre côté schéma) — la convention est tenue par le code applicatif uniquement.

## Principes de code

- TypeScript strict mode obligatoire.
- Fail-fast : ne jamais silencer une erreur, toujours la raise ou la handle explicitement.
- Tests unitaires pour la logique critique (slot generation, formatters, validators) — pattern vitest en place dans `lib/slots/__tests__/`.
- Logging minimal mais structuré : erreurs + étapes d'exécution clés. Préfixes `[SCOPE_LEVEL]` pour filtrer (`[PROMOTE_PRODUCER_WARN]`, etc.).
- Code explicite > code clever. Pas d'abstraction spéculative.

## Guardrails

- Pas de modification de fichiers critiques ou sensibles sans justification explicite.
- Pas de suppression de code sans raison claire et nécessaire.
- Pas de refacto sans objectif explicite (pas de « tant qu'on y est… »).
- Rester strictement dans le scope de la tâche demandée.
- Jamais exposer ou hardcoder secrets, API keys ou credentials.

## Gestion du contexte CC

- **Clear régulier des terminaux CC** : les terminaux CC accumulent du contexte qui consomme des tokens à chaque interaction. Claude (chat web) identifie les moments opportuns pour faire `/clear` dans les terminaux et le signale à Romain. Typiquement après la fin d'un chantier bien délimité, ou quand CC lui-même suggère `/clear to save X tokens`. Le clear ne perd que le contexte conversationnel, le repo et l'état git sont intacts.

## Quand s'arrêter et flagger

CC (ou Claude chat) doit stopper et demander confirmation si :

- Ambiguïté critique sur l'intention produit.
- Information manquante (schema DB, contrat API, décision produit non tranchée).
- Décision à fort impact : migration destructive, rename de table / colonne publique, refonte de flow payment ou RGPD.
- Détection de code sensible (auth, RLS, webhooks Stripe) qui n'était pas dans le scope annoncé.

## Structure de la documentation

La doc projet vit dans `/docs/`. Voir `docs/README.md` pour l'index complet. Les 5 fichiers :

- **`docs/README.md`** : routeur + ordre de lecture recommandé.
- **`docs/HANDOFF.md`** : snapshot projet (stack, schema, config externes, dettes techniques).
- **`docs/METHODOLOGY.md`** : ce fichier — méthode de collaboration.
- **`docs/TODO.md`** : priorités forward-looking (bloquants, non-bloquants, roadmap, idées).
- **`docs/CHANGELOG.md`** : historique antichronologique des chantiers + commits structurants.
- **`docs/LESSONS.md`** : leçons apprises / pitfalls organisés par thème.

`CONTRIBUTING.md` reste à la racine du repo (guidelines PR, hors scope doc produit).
