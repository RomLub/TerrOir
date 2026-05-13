# Tests régression sécurité — convention TerrOir

> **Source** : chantier P1 régression sweep (2026-05-12), suite à audit pré-launch 2026-05-10 + audit verif 2026-05-11.
> **Cible** : encadrer l'écriture des tests qui verrouillent les findings sécu fermés contre la régression silencieuse.
> **Stack** : `vitest@4` (rolldown) + suite SQL-integ dédiée (`vitest.sql.config.ts`) + Playwright E2E (`tests/e2e/security/`).

Ce document grandit au fil des chantiers. Quand un nouveau pattern émerge, l'ajouter ici avant le prochain ajout de test.

---

## 0. Index findings couverts (single source of truth)

> **Règle de maintenance** : à chaque ajout/retrait de test régression, mettre à jour cette table dans le même commit. Cf. section 7.

| Finding | Sévérité | Tests | Fichier(s) | Commit livraison |
|---|---|---|---|---|
| F-001 | CRITIQUE | 6 SQL-integ + 2 E2E | `tests/sql-integration/orders-block-owner-update.test.ts` + `tests/e2e/security/orders-postgrest-attack.spec.ts` | PR #119 |
| F-003 | CRITIQUE | 4 unit | `tests/app/api/stripe/webhook/route.test.tsx:914-1037` | `a630530` |
| F-004 | CRITIQUE | 5 helper + 2 grep statique + intégration cron/dispute | `tests/lib/stripe/{reverse-transfer,refund-clawback-coverage}.test.ts` + `handle-dispute-closed.test.ts` + `payouts.test.ts:977` | `9de460c`, `e3c810c`, `2837c3b` |
| F-008 | HAUT | 7 SQL-integ (incl. 2 lat/lng T-218-bis bonus) | `tests/sql-integration/producers-block-owner-admin-columns-trigger.test.ts` | `3f37c0d` |
| F-009 | HAUT | 7 SQL-integ | `tests/sql-integration/users-block-owner-protected-columns-trigger.test.ts` | PR #119 |
| F-014 | HAUT | 6 route + 2 admin decide + 1 cron J+7 = 9 | `tests/app/api/stripe/refund/route.test.ts:705-836` + `tests/app/(admin)/refunds/pending/decide.test.tsx` + `tests/app/api/cron/refund-expire-pending/route.test.tsx` | `d841ccc`, `0786124` |
| F-026 | HAUT | 2 middleware | `tests/middleware.test.ts:196,230` | `630bd4a` |

**Findings explicitement skippés (lecture pg_* suffit, cf section 4) :** F-024, F-032, F-058.

---

## 1. Quand écrire un test régression sécu

### Règle obligatoire AVANT toute écriture

```bash
git log --all --grep="F-XXX"
grep -rn "F-XXX" tests/
```

Si l'un des deux retourne au moins 1 hit non-trivial → **lire les tests existants AVANT** d'écrire. Couverture éventuelle déjà en place.

### Pourquoi

Les tests régression peuvent être livrés dans des commits `feat(...)`, pas seulement `test:`. Le scope challenge initial du chantier P1 (cette session) avait estimé 4h CC pour écrire F-003 / F-014 / F-026 / F-004 — l'audit batch a révélé qu'ils étaient déjà couverts depuis le chantier P0 sweep des 10-11 mai, livrés ensemble code+tests dans des commits feat(). Coût grep préalable : ~5min. Coût écriture redondante évitée : 4-6h CC. **ROI ~10-20x.**

### Exemple concret

Cf. `docs/audits/audit-batch-axe1-coverage-2026-05-12.md` — méthode reproductible documentée + traçabilité par finding.

### Anti-pattern

> Écrire le test sans grep préalable. Symptôme : 4h CC perdues à dupliquer une couverture déjà en place. Démo session 2026-05-12.

---

## 2. Pattern SQL-integ vs unit vs E2E — matrice de décision

### Règle

Le pattern test à choisir dépend de la nature de la garantie protégée par le finding.

| Nature de la garantie | Pattern recommandé | Config | Exemple chantier |
|---|---|---|---|
| RLS policy UPDATE/DELETE | **SQL-integ** | `vitest.sql.config.ts` | F-001 (orders), F-008 (producers), F-009 (users) |
| Trigger BEFORE UPDATE | **SQL-integ** | `vitest.sql.config.ts` | F-008, F-009 |
| RPC SECDEF métier | SQL-integ ou unit | selon complexité | F-024 = pg_proc suffit (cf section 4) |
| Route handler Next.js (rate-limit, cap, branching) | **Unit avec mocks** | `vitest.config.ts` standard | F-003 (webhook), F-014 (refund cap) |
| Middleware Next.js | **Unit** | `vitest.config.ts` standard | F-026 (role_snapshot) |
| Cron job | **Unit avec mocks** | `vitest.config.ts` standard | F-014 cron J+7 expire |
| Coverage statique (tous call sites importent X) | **Unit grep statique** | `vitest.config.ts` standard | F-004 grep statique (`2837c3b`) |
| Path d'attaque utilisateur réel | **E2E Playwright** | `tests/e2e/security/` | F-001 (orders-postgrest-attack.spec.ts) |
| Webhook intégration runtime | **Unit avec mocks Stripe SDK** | `vitest.config.ts` standard | F-003 webhook |

### Pourquoi cette matrice

- **SQL-integ** = quand la garantie vit dans la DB (RLS, trigger, RPC). Reproduit le rôle PostgREST `authenticated` réel via `seedAuthenticatedClient` (`tests/sql-integration/helpers/auth.ts`). Sans ça, on ne teste que le bypass `service_role` = théâtre.
- **Unit + mocks** = quand la garantie vit dans le code applicatif (route handler, middleware, cron). Plus rapide (~ms), déterministe, pas de Docker. Mocker `@/lib/rate-limit` exige `importOriginal` — cf. `docs/conventions/vitest-mocking-patterns.md` section 1.
- **E2E Playwright** = quand on veut valider le path utilisateur complet contre la prod ou staging. Coûteux (cleanup, flake risk, pollution prod). À garder pour les findings **CRITIQUES** uniquement, et idéalement contre staging (cf. T-225 backlog).

### Anti-pattern

> Tester via service_role uniquement. Le bypass au début du trigger/policy `service_role` retourne `new` immédiatement → 0 protection RLS testée. Théâtre. Toujours combiner 1 test bypass + N tests authenticated owner.

---

## 3. Header obligatoire des tests

### Règle

Tout test régression sécu DOIT commencer par un header doc selon le template canonique de la **section 5**. Sans exception.

### Pourquoi

Sans header, un futur dev voit `expect(error).toBeNull()` sans comprendre quelle attaque est verrouillée → suppose c'est cosmétique → supprime le test "qui pollue" → régression devient possible.

### Champs obligatoires (résumé — détails section 5)

1. `F-XXX — résumé court audit`
2. Date audit + sévérité (CRITIQUE/HAUT/MOYEN)
3. Cible (objet protégé : policy/trigger/RPC/handler/middleware)
4. Path d'attaque exact (verbatim audit)
5. Justification d'existence (lecture pg_* ne couvre PAS)
6. Comportement attendu (sémantique exacte)
7. Pré-requis runtime

### Exemple positif

`tests/sql-integration/orders-block-owner-update.test.ts:1-22` — header canonique F-001 RLS orders.

### Anti-pattern

> Test sans contexte = invisibilité 6 mois post-livraison. Risque : suppression accidentelle par un futur dev qui croit qu'il s'agit d'un test cosmétique sans valeur sécurité.

---

## 4. Quand NE PAS écrire de test régression

### Règle

Skip le test régression si la garantie est **purement structurelle** (état DB visible via `pg_*`) sans race condition possible. Lecture pg_* one-shot suffit (couverte par audit verif périodique).

### 3 cas concrets observés

| Finding | Garantie | Pourquoi pas de test régression |
|---|---|---|
| F-024 | RPC `increment_otp_attempts_if_below_cap` atomique | Single-statement `UPDATE ... WHERE attempts < 5 RETURNING attempts`. Atomicité garantie par PostgreSQL natif. Aucune race possible. Lecture `pg_get_functiondef` suffit. Coût test ~45min pour 0 valeur ajoutée vs vérif statique. |
| F-032 | FORCE RLS sur `admin_users`, `email_suppressions`, `notifications` | État booléen `pg_class.relforcerowsecurity = true`. SELECT direct vérifie. Test ajoutera 0 valeur. |
| F-058 | Helpers SECDEF (`is_admin()`, `owns_producer()`) gardent EXECUTE GRANT pour `anon` + `authenticated` (c'est l'INVERSE du durcissement métier) | Doctrine documentée CLAUDE.md L90-100. État GRANT visible via `information_schema.role_routine_grants`. Lecture suffit. |

### Critère général

| Type garantie | Décision |
|---|---|
| Purement structurelle (état DB booléen, GRANT, contrainte CHECK statique) | **Skip test** — lecture pg_* suffit |
| Runtime (logique multi-étapes, comportement async, ordre d'évaluation, race) | **Test obligatoire** |

### Anti-pattern

> Écrire un test pour un état booléen DB. Théâtre — le test ne peut pas mieux vérifier qu'un `SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.X'::regclass` direct.

---

## 4 bis. Drift local Supabase post-apply MCP : procédure

### Contexte

Quand une migration est appliquée prod via `mcp__supabase__apply_migration`, la base prod est à jour mais le Docker local pas. Les tests SQL-integ tournent contre local → fail jusqu'à sync.

### Symptômes

- `npm run test:sql` plante avec erreurs Postgres référençant des objets inexistants en local mais existants en prod (ou inversement).
- Exemple session 2026-05-12 : trigger F-008 `record "new" has no field "prenom_affichage"` après apply prod du fix `20260512100000` mais avant sync local.
- `42703 undefined_column` ou `42883 function does not exist` typiques.

### Procédure (commandes copier-collables)

```bash
# 1. Sync local depuis migrations locales (incluant celle apply prod via MCP)
npx supabase migration up --local

# 2. Vérifier état local
npx supabase status

# 3. Re-run la suite SQL-integ
npm run test:sql
```

### Anti-pattern

> Modifier le test pour qu'il passe sans drift local. Masque la vraie cause (drift) → le test ne reflète plus la réalité prod → le filet anti-régression devient illusoire.

### Référence

Constaté session 2026-05-12, commits `3f37c0d` (apply prod via MCP) → drift local → `npx supabase migration up --local` → `26e3411`, `2837c3b`.

---

## 5. Doc header obligatoire (template copy-paste)

Tout test régression sécu DOIT commencer par un header doc minimum. Sans header, le test devient invisible 6 mois post-livraison : un futur dev voit `expect(error).toBeNull()` sans comprendre quelle attaque est verrouillée, supprime le test "qui pollue", la régression devient possible.

### Template canonique

```ts
// Test F-XXX — <résumé court audit, 1 ligne>
// (audit pré-launch <YYYY-MM-DD>, finding <CRITIQUE|HAUT|MOYEN>).
//
// Cible : <objet protégé — policy/trigger/RPC/handler/middleware>.
//   <2-4 lignes décrivant ce qui est protégé et comment>.
//
// IMPORTANT : ce test verrouille <attaque exacte décrite dans l'audit>.
// Sans lui, <régression silencieuse possible — ex: refactor migration X
// peut casser la policy sans alerte>. La lecture <pg_policy/pg_trigger/
// pg_proc/grep code> côté audit verif <YYYY-MM-DD> ne couvre PAS la
// régression (snapshot ≠ filet).
//
// Comportement attendu : <décrit la sémantique exacte — ex: PostgREST
// + RLS USING=false retourne 200 mais 0 row affecté ; ou RAISE 42501
// avec message "X is admin-only">.
//
// Pré-requis : <`npx supabase start` / mocks / staging Supabase / etc.>.
```

### Champs obligatoires expliqués

| Champ | Pourquoi obligatoire |
|---|---|
| `F-XXX — résumé` | Permet de retrouver le finding source de l'audit en 1 grep |
| `audit pré-launch <date>, sévérité` | Trace temporelle + priorisation visible |
| `Cible : objet protégé` | Identifie le composant qui peut être cassé par refactor |
| `IMPORTANT : verrouille <attaque>` | Documente le path d'attaque exact — sans ça, un futur dev ne peut pas évaluer si son refactor est dangereux |
| `lecture pg_* ne couvre PAS la régression` | Justifie l'existence du test (vs juste relire le code en review) |
| `Comportement attendu` | Évite la confusion sur la sémantique (ex: RLS USING=false ≠ erreur, mais 0 row) |
| `Pré-requis` | Permet à un dev qui voit le test rouge de savoir quoi lancer |

### Exemple réel (référence)

Cf. `tests/sql-integration/orders-block-owner-update.test.ts` (header lignes 1-22) — exemple canonique de header complet sur F-001 RLS orders.

---

## 6. Anti-patterns

### Anti-pattern : `CREATE OR REPLACE FUNCTION` sans diff vs version actuelle prod

**Symptôme :** une migration sweep qui veut ajouter UN check à un trigger existant
copie-colle l'ancienne version du fichier source (ou la version T-N) sans vérifier
ce qui tourne actuellement en prod. Toute modif intermédiaire (T-N+1, T-N+2...) est
silencieusement **écrasée** par le `CREATE OR REPLACE`.

**Exemple concret (régression P0_F008 → P1 fix `20260512100000`) :**
- T-218 (2026-05-06) trigger producers admin-only 23 colonnes
- T-218-bis (2026-05-06+) ajoute checks `latitude` + `longitude` (privacy)
- T-300 (2026-05-07) retire check `prenom_affichage` après DROP COLUMN
- P0_F008 (2026-05-11) ajoute check `enums_version` mais **écrase T-218-bis ET T-300**
- Impact : 2 régressions latentes ~36h en prod (bug 1 `prenom_affichage` bloque
  paradoxalement bug 2 lat/lng exploitable), détectées par filet F-008 (test
  régression `nom_exploitation` qui plantait 42703).

**Pattern à respecter avant tout `CREATE OR REPLACE FUNCTION` en sweep migration :**

```sql
SELECT pg_get_functiondef('public.<function_name>'::regprocedure);
```

Diff vs ce qu'on s'apprête à apply. Si lignes inattendues = STOP, comprendre, intégrer.

---

## 6 bis. Anti-pattern : extension whitelist sans justification (F-004 style)

### Symptôme

Un test régression à filet déterministe utilise une `EXEMPTIONS_WHITELIST` (ex: F-004 grep statique `tests/lib/stripe/refund-clawback-coverage.test.ts`). Un dev futur peut contourner le filet en ajoutant son nouveau call site à la whitelist sans réfléchir → régression silencieuse.

### Règle : 3 critères obligatoires pour étendre une whitelist

1. **Commentaire source dans le fichier exempté** pointant vers le finding (F-XXX) et expliquant pourquoi le helper/protection n'est pas applicable. **Modèle canonique :** `lib/refund-incidents/retry-incident.ts:104` — commentaire `F-004 sub-2 : pas d'appel reverseTransferIfNeeded sur ce path.` (le retry est une re-tentative d'un refund qui a déjà passé par `reverseTransferIfNeeded` au premier essai → re-reverse = double clawback bug).
2. **Revue humaine documentée dans le commit ajoutant l'exemption.** Pas d'auto-merge possible.
3. **Justification écrite minimum 1 paragraphe** dans le message commit OU dans un commentaire de la whitelist elle-même, expliquant le cas d'usage et pourquoi le risque résiduel est acceptable.

### Pourquoi

Sans ces 3 critères, la whitelist devient un trou laissé ouvert. Avec, elle reste un mécanisme délibéré + traçable + reviewable.

### Exemple concret

`tests/lib/stripe/refund-clawback-coverage.test.ts` (commit `2837c3b`) — `EXEMPTIONS_WHITELIST = new Set(["lib/refund-incidents/retry-incident.ts"])` + commentaire pointant vers `retry-incident.ts:104` + justification dans le header doc + dans le commentaire de la constante.

### Anti-pattern

> Ajouter à la whitelist sans commentaire source ni justification. Le filet devient théâtre.

---

## 7. Maintenance long terme

### Qui maintient quoi

| Section | Cadence maintenance | Owner |
|---|---|---|
| **0** Index findings | À chaque ajout/retrait test régression (même commit) | Auteur du test |
| **1-4** Quand écrire / patterns | Review annuelle ou quand un nouveau pattern émerge | Owner sécu / lead chantier |
| **4 bis** Drift local | Statique sauf changement workflow Supabase MCP | Owner DB |
| **5** Template header | Statique sauf evolution structure header | Lead chantier |
| **6 / 6 bis** Anti-patterns | Append-only quand nouveau cas concret rencontré (pas de réécriture rétro) | Auteur du fix qui a révélé l'anti-pattern |
| **7** Cette section | Review semi-annuelle | Lead chantier |

### Règle de mise à jour Section 0

> À chaque ajout/retrait de test régression, le commit DOIT inclure la mise à jour de la table Section 0. Sinon le doc devient obsolète sous 1 mois et perd sa valeur "single source of truth".

### Mécanique de relecture

- **Pré-Live** : relecture complète obligatoire (intégration check-list `docs/runbooks/checklist-pre-live-2026-05-06.md`).
- **Post-incident sécu** : si un incident révèle un pattern non documenté, ajouter en section 6/6 bis avec exemple chantier (commit + impact + fix).
- **Avant écriture nouveau test** : appliquer Section 1 (grep F-XXX préalable). Si trouvé → lire l'existant. Si pas trouvé → écrire + mettre à jour Section 0.

### Cross-doctrines

- `docs/conventions/vitest-mocking-patterns.md` — pièges mock vitest (importOriginal, isolation worker, etc.). Référencer plutôt que dupliquer.
- `docs/audits/audit-batch-axe1-coverage-2026-05-12.md` — méthodologie audit batch reproductible.
- `CLAUDE.md` doctrines transverses (à mettre à jour Axe 5 chantier P1 pour pointer vers cette doctrine régression).
- `scripts/cleanup-test-residuals-e2e.ts` — wrapper CLI standalone sur `sweepE2EResiduals` pour invocation hors Playwright lifecycle (cron, sweep manuel, debug). Livré chantier P1 commit `f2f8f77`.
