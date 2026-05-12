# Audit batch Axe 1 — couverture F-003 / F-014 / F-026 / F-004 (chantier P1 régression sweep 2026-05-12)

> **Date** : 2026-05-12
> **Contexte** : session `/plan-ceo-review` P1 régression sweep (branche `feature/p1-regression-sweep-axes-1-5`). Audit batch effectué AVANT écriture de tests régression pour les 4 findings restants après F-008, afin d'éviter la duplication de tests déjà livrés par les Teammates TA/TB/TC dans le chantier P0 sweep des 10-11 mai.
> **Méthode** : grep `F-XXX` dans `tests/` + `git log --all --grep="F-XXX"` croisé avec lecture ciblée des fichiers identifiés.

---

## 1. Surprise méthodologique

L'analyse initiale de cette session a manqué que **les tests régression P0 sweep ont été livrés DANS les commits `feat(...)` des 10-11 mai** (pas dans des commits préfixés `test:`). Le scope challenge initial du chantier P1 a donc surévalué le travail restant : F-003 / F-014 / F-026 / F-004 étaient en réalité déjà couverts.

**Leçon gravée pour la doctrine `docs/conventions/regression-tests-security.md` section 1 (à finir Axe 4) :**

```bash
# AVANT d'écrire un test régression :
git log --all --grep="F-XXX"
grep -rn "F-XXX" tests/
```

Les tests sont parfois livrés dans des commits `feat(...)`. Le coût grep < le coût d'écrire un test redondant. À intégrer en doctrine impérative.

---

## 2. Statut par finding

### F-003 — Rate-limit IP-keyed webhook Stripe (CRITIQUE)
- **Statut** : ✅ DÉJÀ COUVERT (full)
- **Fichier test** : `tests/app/api/stripe/webhook/route.test.tsx:914-1037`
- **Describe** : `POST /api/stripe/webhook — rate-limit IP-keyed (F-003)` — **4 tests**
  - L945 : `success=true → handler exécuté normalement`
  - L963 : `success=false → 429 + log RATE_LIMITED + AUCUN appel handler`
  - L987 : `fail-open (Upstash KO) → handler exécuté` (cas régression critique)
  - L1011 : `aucun header IP → rate-limit skip + handler exécuté`
- **Commit livraison** : `a630530` (2026-05-10 11:18) — `feat(stripe): rate-limit IP-keyed webhook 100/min (F-003)`
- **Gap** : aucun.

### F-014 — Cap refund 500€ + workflow approval admin (HAUT)
- **Statut** : ✅ DÉJÀ COUVERT (full)
- **Fichiers tests** :
  - `tests/app/api/stripe/refund/route.test.ts:705-836` — describe `F-014 v2 — workflow approval admin` — **6 tests** (F-014-A à F-014-F)
  - `tests/app/(admin)/refunds/pending/decide.test.tsx` — server actions admin decide
  - `tests/app/api/cron/refund-expire-pending/route.test.tsx` — cron J+7 expire
- **Couverture** : cap nominal, dépassement cap, admin path bypass, idempotence pending existing, cap configurable env, propagation reason, decide admin, cron expire J+7.
- **Commits livraison** :
  - `d841ccc` (2026-05-10 11:23) — `feat(stripe): cap dur producer self-refund 500 EUR (F-014)`
  - `0786124` (2026-05-11 01:06) — `feat(refunds): workflow approval admin producer self-refund > cap (F-014 v2 audit P0 sweep)`
  - `a2ae90b` (2026-05-11 20:17) — `feat(admin): lien sidebar Refunds en attente + badge count pending (F-014 v2 followup audit P0 sweep)`
- **Gap** : aucun.

### F-026 — role_snapshot revocation `minIssuedAtMs` (HAUT)
- **Statut** : ✅ DÉJÀ COUVERT (full sur les cas critiques)
- **Fichier test** : `tests/middleware.test.ts:15,67,196,230` — **2 tests F-026 explicites + helpers**
  - L196 : `snapshot frais (issued_at > min_issued_at) → utilise cache, pas de DB lookup`
  - L230 : `snapshot stale (min_issued_at > issued_at) → force DB lookup refresh`
  - L15 : helper RPC `get_role_snapshot_revocation` mocké
  - L67 : setup default
- **Commit livraison** : `630bd4a` (2026-05-11 01:30) — `feat(security): F-024 race OTP atomic RPC + F-025 rate-limit re-auth + F-026 role snapshot revocations + F-032 FORCE RLS + F-034 rate-limit orders/create (audit P0 sweep batch C)`
- **Gap** : aucun sur les cas critiques (les 2 cas testés sont l'attaque cible audit). Edge cases marginaux possibles (ex: revocation row absente, RPC throw) — non bloquant.

### F-004 — Clawback `reverseTransferIfNeeded` (CRITIQUE)
- **Statut** : ✅ DÉJÀ COUVERT (full sur helper + chemins critiques) avec **1 gap mineur**
- **Fichiers tests** :
  - `tests/lib/stripe/reverse-transfer.test.ts:58-205` — **5 tests sur le helper standalone**
    - `transfer_id présent → createReversal appelé + audit kind='reversed'`
    - `transfer_id NULL → noop + AUCUN appel createReversal`
    - `lookup DB échoue → noop_lookup_failed`
    - `Stripe createReversal throw → kind='failed' + audit stripe_transfer_reversal_failed`
    - 1 cas params
  - `tests/lib/stripe/handle-dispute-closed.test.ts:25-300` — describe `F-004 sub-3 reversal sur lost`
  - `tests/lib/stripe/payouts.test.ts:977` — describe `F-004 write-back orders.transfer_id` (cron weekly-payout)
- **Commits livraison** :
  - `54af45e` (2026-05-10 11:28) — `feat(stripe): orders.transfer_id + writeback cron weekly-payout (F-004 1/3)`
  - `9de460c` (2026-05-10 23:31) — `feat(stripe): helper reverseTransferIfNeeded + integration 6 call sites refund (F-004 sub-2 audit P0-TB)`
  - `e3c810c` (2026-05-10 23:39) — `feat(stripe): reversal auto sur dispute lost + tests dedies (F-004 sub-3 audit P0-TB)`
- **Gap identifié** : **grep statique strict absent** — pas de test qui force "tous les call sites refund continuent à importer `reverseTransferIfNeeded`". Si un futur dev ajoute un nouveau site `stripe.refunds.create` sans le helper, aucune alerte automatique. Tâche planifiée : 1 test qui scanne `app/`+`lib/` pour les hits `stripe.refunds.create`, count, fail si ≠ N attendu (N=6 actuellement).
- **Effort restant** : ~20min CC (à exécuter dans la suite de cette session — décision Romain validée).

---

## 3. Récap couverture totale Axe 1

| Finding | Sévérité | Statut | Tests existants | Commits livraison |
|---|---|---|---|---|
| F-001 | CRITIQUE | ✅ full | 6 SQL-integ + 2 E2E (PR #119) | (PR #119) |
| F-003 | CRITIQUE | ✅ full | 4 unit | `a630530` |
| F-008 | HAUT | ✅ full (post-session) | 7 SQL-integ incl. 2 lat/lng bonus | `3f37c0d` (cette session) |
| F-009 | HAUT | ✅ full | 7 SQL-integ (PR #119) | (PR #119) |
| F-014 | HAUT | ✅ full | 6+2+1 = 9 | `d841ccc`, `0786124`, `a2ae90b` |
| F-026 | HAUT | ✅ full (cas critiques) | 2 middleware | `630bd4a` |
| F-004 | CRITIQUE | ✅ full + 1 gap mineur | 5 helper + intégration + cron = 7+ | `54af45e`, `9de460c`, `e3c810c` |

**Verdict : Axe 1 essentiellement done.** Reste à fermer F-004 grep statique (~20min) puis attaquer Axe 2 (CI), Axe 3 (sentinel), Axe 4 (doctrine finir), Axe 5 (validation).

---

## 4. Méthode reproductible (à intégrer en doctrine Axe 4 section 1)

Pour tout futur audit batch de couverture régression :

```bash
# 1. Audit Git — qui a livré quoi
git log --all --format="%ai %h %s" --grep="F-XXX"

# 2. Audit code — où sont les tests
grep -rn "F-XXX" tests/

# 3. Cross-check : pour chaque commit feat trouvé, vérifier que les tests sont bien dedans
git show <SHA> --stat

# 4. Lecture ciblée des describe identifiés pour confirmer la couverture
```

Coût audit batch : ~15-30min pour 4-5 findings.
Coût d'écriture redondante évitée : 4-6h CC.
ROI : 10-20x.
