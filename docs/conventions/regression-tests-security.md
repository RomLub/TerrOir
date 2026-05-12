# Tests régression sécurité — convention TerrOir

> **Source** : chantier P1 régression sweep (2026-05-12), suite à audit pré-launch 2026-05-10 + audit verif 2026-05-11.
> **Cible** : encadrer l'écriture des tests qui verrouillent les findings sécu fermés contre la régression silencieuse.
> **Stack** : `vitest@4` (rolldown) + suite SQL-integ dédiée (`vitest.sql.config.ts`) + Playwright E2E (`tests/e2e/security/`).

Ce document grandit au fil des chantiers. Quand un nouveau pattern émerge, l'ajouter ici avant le prochain ajout de test.

---

## 1. Quand écrire un test régression sécu

> _Section à compléter — Axe 4 finir_

---

## 2. Pattern SQL-integration (vitest.sql.config.ts)

> _Section à compléter — Axe 4 finir_

---

## 3. Pattern unit handler avec mock (vitest.config.ts standard)

> _Section à compléter — Axe 4 finir_

---

## 4. Pattern E2E Playwright (tests/e2e/security/)

> _Section à compléter — Axe 4 finir_

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

## 7. Index actuel des tests régression sécu

> _Section à compléter — Axe 4 finir (table tenue à jour à chaque ajout)_
