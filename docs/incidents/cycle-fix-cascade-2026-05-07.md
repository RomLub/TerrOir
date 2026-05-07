# Post-mortem — Cycle FIX méga-audit cascades Vercel 2026-05-07

**Date** : 2026-05-07
**Cycle** : FIX méga-audit (50 findings, 4 phases séquentielles)
**Cascades observées** : 2 (peer dep ESLint + module manquant ops/alert)
**Impact final** : aucune perte de données, aucune indisponibilité prod (TerrOir pré-Live, pas encore ouvert publiquement)

---

## Résumé exécutif

Cycle FIX méga-audit (Phase 1 + Phase 2 + Phase 3 parallèle 6 teammates + Phase A stabilisation + Phase B reprise serial + Phase C Tailwind 4 + Phase D cleanup) a vu **2 cascades de builds Vercel rouges** intermédiaires, toutes deux résolues par fix forward sans rollback. Cause-racine commune : **doctrine pré-push systématique pas appliquée à 100%** sur les bumps deps + nouveaux modules cross-fichiers en Phase 3 parallèle.

Le HEAD final de chaque phase a toujours été vert sur Vercel. Les builds rouges ont concerné des commits intermédiaires de Phase 2 et Phase 3.

---

## Cascade #1 — Peer dep ESLint sur bump Next 14→16

### Chronologie
- **Phase 2 démarrée** par teammate T3 (single teammate séquentiel, scope = 4 bumps breaking)
- T3 push commit `c717e8b` : `chore(deps): bump Next 14->16 + React 18->19 + useFormState->useActionState`
  - `npm install --legacy-peer-deps` utilisé localement (autorisé par brief)
  - `npm run build` local vert
  - `npm run test` local 2332/2332 vert
- **Vercel build sur c717e8b → ROUGE** : `npm install` ERESOLVE peer dep mismatch
  - `eslint-config-next@16.2.5` exige `eslint >=9.0.0`
  - Repo avait `eslint@^8.57.1`
  - Vercel n'utilise pas `--legacy-peer-deps` par défaut
- T3 push `72abd17` : `chore(deps): bump Zod 3->4` (toujours rouge sur Vercel, mais T3 ne l'a pas vu localement car son build local passait avec `--legacy-peer-deps`)
- Lead détecte la cascade rouge via dashboard Vercel + ping Romain
- **Fix forward** : commit `9b123be` `fix(deps): bump eslint 8.57->9 pour peer dep eslint-config-next 16`
  - `npm install --save-dev eslint@^9` SANS `--legacy-peer-deps` → résolu sans ERESOLVE
  - `npm run build` + `npm run test` vert local
  - Push vert sur Vercel

### Cause racine
**T3 a utilisé `--legacy-peer-deps` qui a masqué le conflit peer dep localement.** Vercel produit n'utilise pas ce flag → ERESOLVE en prod alors que tout passait en dev.

Sous-cause : le brief T3 autorisait `--legacy-peer-deps` comme fallback ("Si ERESOLVE → STOP, diagnostic"). Mais T3 n'a pas STOP, il a continué avec le flag, ce qui a masqué le problème.

### Impact
- 2 builds Vercel rouges consécutifs (c717e8b, 72abd17)
- ~30 min de cascade rouge avant détection + fix
- Aucun impact métier (pré-Live)

### Fix appliqué
- Bump eslint 8.57→9 (pas 10 flat-only) en commit dédié
- Conservation `.eslintrc.json` legacy via env var `ESLINT_USE_FLAT_CONFIG=false` (implicite v9)
- Migration vers flat config = chantier dédié post-Live (idem Tailwind 4)

### Apprentissages
1. **`--legacy-peer-deps` est un signal d'alerte, jamais un fix**. Si nécessaire localement → STOP, diagnostic peer dep AVANT push, sinon Vercel rouge garanti.
2. **Bump Next 16 implique chain de peer deps** (eslint-config-next 16 → eslint ≥9 → typescript-eslint ≥8). À traiter atomiquement dans le même commit.
3. **Doctrine bumps deps amendée** dans CLAUDE.md (cf. update Phase D).

---

## Cascade #2 — Module `@/lib/ops/alert` manquant

### Chronologie

Phase 3 parallèle (6 teammates simultanés T4-T9 + commits push fréquents). Race git inter-teammates a créé une chain d'imports temporairement cassée.

- T7 (bumps non-breaking) push `b4ac065` : `chore(deps): bump TypeScript 5->6`
  - **Incident contamination working tree** : T7 a embarqué par erreur la refacto webhook de T8 (suppression branche `payment_intent.succeeded` inline ~250 lignes) sans le nouveau fichier d'extraction `handle-payment-succeeded-notify.tsx`
  - Vercel build → ROUGE : import cassé sur le fichier inexistant
- T5 push `9d5b501` : `fix(crons): timezone Europe/Paris` (toujours rouge — héritage cassure b4ac065)
- T8 push `67872ea` : `fix(webhook): add missing handle-payment-succeeded-notify module`
  - Crée le fichier MAIS il importe `@/lib/ops/alert` qui n'existait pas encore (T4 pas encore push f09c642)
  - Vercel build → ROUGE : `Cannot find module '@/lib/ops/alert'`
- T9 push `e74444d` : `test: aligner tests` (toujours rouge — héritage)
- **4 builds Vercel rouges consécutifs** (b4ac065, 9d5b501, 67872ea, e74444d)
- T4 push `f09c642` : `feat(ops): integration Sentry + helper sendOpsAlert`
  - Crée enfin `lib/ops/alert.tsx`
  - Build Vercel **vert** sur ce commit et tous les suivants (e4b6622, c613721, f8d1d3a, a7f2f67, 37397ba, 2d8e404, d7559e6, 698a335, 73c738f)
- Lead détecte la cascade rouge via dashboard Vercel post-Phase-3 + ping Romain
- **Fix forward** : aucun fix supplémentaire nécessaire — la chain d'imports était déjà résolue sur HEAD `73c738f`

### Cause racine
**Race git multi-teammates Phase 3 parallèle**. T7 a pull l'état working tree d'un autre teammate (T8 refacto webhook) en cours, sans embarquer le fichier d'extraction nécessaire. Doctrine `git commit -o <files> --only` strict ne suffit pas si l'index préexistant contient des fichiers d'autres teammates (stash-pop accidentel).

Sous-cause : **6 teammates simultanés sur même working tree partagé**. Apprentissage cycle 06/05/2026 (cross-terminal-staging-race) déjà documenté mais nouvelle saveur découverte (Agent Teams parallèles vs terminaux humains parallèles).

### Impact
- 4 builds Vercel rouges consécutifs (~15 min de cascade)
- Aucun impact métier (pré-Live)
- Aucun rollback nécessaire (chain d'imports résolue par commits ultérieurs T4)

### Fix appliqué
- Pas de fix dédié : la cascade s'est résolue d'elle-même quand T4 a push `f09c642` qui crée `lib/ops/alert.tsx`
- Diagnostic lead : confirmation que HEAD `73c738f` était vert local + push lead du fix régressions vitest dans Phase A (`90c5a01`, `45f9490`, `6991850`)

### Apprentissages
1. **Race git Agent Teams parallèles** sur same working tree = risque de stash-pop accidentel. Pour cycles >4 teammates parallèles, soit :
   - Worktrees séparées par teammate (isolation forte)
   - Soit doctrine `git stash push -- <files>` ciblé avant `git pull --rebase` pour ne pas embarquer fichiers étrangers
   - Soit accepter la cascade et fix forward systématique (approche cycle 07/05)
2. **Si nouveau module `@/lib/...` créé/référencé** : `grep import "@/lib/..."` AVANT push pour vérifier que le fichier source existe ET est exporté. Apprentissage critique car incident T8 + T7 + T4 chain.
3. **Doctrine pré-push systématique amendée** dans CLAUDE.md (cf. update Phase D).
4. **Supervision Agent Teams longue** : pour cycles >2h sans Romain présent, lead doit pinger immédiatement en cas d'ARBITRAGE REQUIS bloquant plutôt que d'attendre return Romain (apprentissage T6 race git bloquée pendant pause).

---

## Backlog ouvert post-incident

- **Worktrees Agent Teams** : explorer `git worktree` pour isolation forte teammates parallèles. Implique adaptation outillage Agent Teams.
- **CI pré-push validation** : automatiser `npm install` (sans `--legacy-peer-deps`) + `npm run build` + `npm run test` en pre-commit hook ou CI early-fail. Pas de `.github/workflows/` dans le repo aujourd'hui (T1 backlog).
- **Doctrine grep import pré-push** : ajouter au lint custom du repo une règle qui vérifie que tous les imports `@/lib/...` résolvent à un fichier existant. ESLint `import/no-unresolved` peut couvrir avec config TypeScript paths.

---

## Conclusion

Les 2 cascades ont eu un impact métier nul (pré-Live) et ont permis de **stress-tester la robustesse de la doctrine fix forward**. Aucun rollback effectué, master toujours récupérable en avançant.

**Apprentissages intégrés au CLAUDE.md** dans Phase D du même cycle. Cycle FIX méga-audit reste un succès (48/50 findings livrés + 1 doublon N/A + 1 partiel mineur).

---

**Auteurs** : lead Agent Teams (Claude Opus 4.7) + supervision Romain
**Reviewed** : 2026-05-07 fin de cycle Phase D
