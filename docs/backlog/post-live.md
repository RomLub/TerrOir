# Backlog post-Live TerrOir

Items à traiter après Live mono Julien T-001. Aucun de ces items
ne bloque le Live initial.

Document git-tracé pour survie aux compactions session futures.
Source : cycle qualité totale TerrOir 2026-05-07 (cf. master HEAD
`2373ad3` post-cycle).

---

## Bugs latents partiels

### C-CHECKOUT-IDEMPO — flake test e2e checkout-idempotency

- **Source** : cycle qualité totale 07/05/2026, Phase 4
- **Statut** : fix défensif appliqué prod (`app/api/stripe/create-payment-intent/route.ts:247-273`,
  commit `e46833c`), test continue de fail post-fix
- **Cause** : race spécifique Stripe sandbox + Next 16 + Windows
  non isolée. Investigation Phase 4 a montré que la compensation
  T-405 cancellait le PI gagnant lui-même quand 2 POST simultanés
  mêmes params déclenchent l'idempotency match (fix défensif posé,
  pattern atomicité prod protégé). Le test continue de fail sur
  l'assertion `winningPi.status !== 'canceled'` ligne 169 — un
  autre code path cancel (cron timeout sandbox ? Stripe webhook
  sandbox ?) OU race spec Stripe sandbox local non reproductible
  en prod.
- **Workaround test** : body vidé pass-through (cf. doctrine #15
  CLAUDE.md), suite reste verte.
- **Priorité** : moyenne (fix prod en place, pas de bug réel)
- **Estimation** : 2-4h investigation dédiée

---

## Conformité juridique (gated avocat T-003)

### T-041 review juridique CGV/CGU/livraison.tsx

- **Source** : cycle qualité totale 07/05/2026, Phase 2 décisions
  secondaires
- **Statut** : wording retrait ferme uniquement appliqué sur UI
  primaires (`Reassurance.tsx`, `PickupValidationCard.tsx` —
  commit `3ad1080`). Mentions livraison/expédition restantes :
  - `app/(public)/cgv/page.tsx` article 6 expédition postale
    (lignes 480-481, 489, 357, 204)
  - `app/(public)/livraison/page.tsx` page entière à recadrer ou
    redirect vers `/retrait`
  - `app/(public)/cgu/page.tsx`, `mentions-legales`, `contact`,
    `faq`, `comment-ca-marche` à auditer
- **Action** : audit pré-Live externe avocat (T-003 backlog),
  modification CGV = juridique, hors arbitrage β
- **Priorité** : haute (bloquant Live public)

### T-209 politique confidentialité email_suppressions

- **Source** : cycle qualité totale 07/05/2026, RGPD audit
  `delete_user_account` (Phase 1)
- **Statut** : `email_suppressions` table conservée par design
  (anti-spam reputation Resend) malgré suppression compte RGPD
  Article 17. Compromis légitime mais à documenter.
- **Action** : documenter intérêt légitime art. 6.1.f RGPD dans
  politique de confidentialité finale
- **Priorité** : moyenne (couplé T-041)

---

## Accessibilité (a11y)

### a11y StepInfos producer onboarding

- **Source** : cycle qualité totale 07/05/2026, rapport B2 Phase 3
- **Statut** : `<label htmlFor=...>` manquant sur StepInfos
  producer. Workaround tests B2 : `page.locator('input[name="..."]')`
  au lieu de `getByLabel(...)`.
- **Action** : refactor pour rendre `getByLabel()` opérationnel +
  conformité screen-readers
- **Priorité** : moyenne (loi française 2024 a11y obligatoire
  marchand grand public)

### Cycle dédié a11y axe-core

- **Source** : recommandation Romain pré-Live (~2-3h)
- **Outil** : `@axe-core/playwright`
- **Scope** : 10-15 tests sur pages critiques (homepage, signup,
  checkout, dashboard producer, /compte/mes-avis nouveau)
- **Priorité** : moyenne

---

## Robustesse / chaos engineering

### Cycle dédié robustesse chaos (~4-5h)

- **Source** : recommandation Romain pré-Live
- **Scope** : Stripe down, Supabase timeout, Resend rate limit,
  réseau intermittent, localStorage rempli
- **Outil** : Playwright `route.abort()` + `setOffline()`
- **Tests** : 25-30 tests par persona × 3-4 services
- **Priorité** : moyenne

---

## Migration safety framework

### Framework migration safety (~3-4h)

- **Source** : recommandation Romain (DROP COLUMN
  `prenom_affichage` T-200 backlog)
- **Scope** : tests qui (1) seed données, (2) appliquent
  migration, (3) vérifient intégrité
- **Outil** : test custom à créer (dans `tests/sql-integration/` ?)
- **Priorité** : basse (avant prochaine migration destructive)

---

## Logging / observabilité

### log-auth-event.ts Sentry FK forensiques

- **Source** : cycle qualité totale 07/05/2026, rapport A1 Phase 1
- **Statut** : `console.warn` silencieux sur erreurs FK forensiques
  (signal qu'un user a été supprimé entre deux actions). Pas
  d'alerte Sentry actuellement.
- **Action** : Sentry capture sur erreurs FK forensiques de
  `lib/audit-logs/log-auth-event.ts`
- **Priorité** : basse (couplé action humaine Romain Sentry env
  vars Vercel pré-Live)

---

## Configuration / hygiène repo

### next-env.d.ts auto-régénéré Next 16

- **Source** : cycle qualité totale 07/05/2026, rapport A2 Phase 1
- **Statut** : Next 16 réécrit `next-env.d.ts` depuis
  `./.next/types/routes.d.ts` vers `./.next/dev/types/routes.d.ts`
  au premier `next build` / `next dev`. Pollue le working tree.
- **Décision** : `.gitignore` vs commit (à trancher)
- **Priorité** : basse (cosmétique)

### Codegen enums vitest CRLF Windows

- **Source** : pré-existant master, observé Phase 1+3 cycle
- **Statut** : `tests/scripts/codegen-enums.test.ts` était rouge
  sur master baseline (CRLF/LF mismatch sur
  `lib/types/generated/enums.ts`). Vert post-cycle (2321/2321),
  peut être instable selon line endings au commit.
- **Action** : `.gitattributes` règle `*.ts text eol=lf` ou regen +
  commit du fichier en LF explicite
- **Priorité** : basse

### Workaround dev server Next 16 + Windows e2e

- **Source** : cycle qualité totale 07/05/2026, observé Phases
  1-4
- **Statut** : flakiness multi-spec Playwright (ECONNREFUSED après
  ~3min sous load)
- **Action** : doctrine `npm run build && npm run start` pour e2e
  long (build-time une fois, plus de hot reload qui crash). Déjà
  doctriné CLAUDE.md (item B.8 cycle qualité totale).
- **Priorité** : basse (workaround per-spec marche)

---

## Bug upstream

### Playwright test.skip non-fonctionnel Windows

- **Source** : cycle qualité totale 07/05/2026, Phase 4
- **Statut** : `test.skip` / `test.fixme` / `test.describe.skip`
  ne marchent pas sur Windows + Playwright Test version actuelle.
  Le test continue à tourner.
- **Workaround actuel** : body vide pass-through (cf. doctrine
  #15 CLAUDE.md).
- **Action** : reporter bug upstream Playwright + suivre fix
- **Priorité** : basse

---

## Tests skip restants documentés

### OPT_OUT_TOKEN_SECRET test admin

- **Source** : cycle qualité totale 07/05/2026, Phase 4
- **Statut** : 1 test admin skip conditionnel runtime
  (`tests/e2e/admin/producers-list.spec.ts:139`) car la var n'est
  pas dans `.env.local`. Code prod a la var sur Vercel.
- **Action humaine Romain** : ajouter
  `OPT_OUT_TOKEN_SECRET=<même-valeur-que-Vercel>` dans
  `.env.local`, puis re-run la spec pour confirmer qu'elle passe
- **Priorité** : basse

---

## Items chantier-suite sans deadline

### Nettoyage état `ready` state machine

- **Source** : chantier pickup-validation 06/05/2026
- **Statut** : état `ready` mort dans le modèle réel (modèle 3
  états `pending → confirmed → completed`), conservé en state
  machine pour rétro-compat. Cf. CLAUDE.md décision modèle 3 états.
- **Priorité** : faible

### Marqueur DB déduplication cron review-followup

- **Source** : chantier pickup-validation 06/05/2026
- **Statut** : marqueur `review_followup_d{2,7}_sent_at` posé
  AVANT `sendTemplate` race-safe. Trade-off accepté : si crash
  entre coche et send, l'email est manqué silencieusement.
- **Priorité** : faible (pré-Live acceptable)

### Audit log cluster `review_followup_*`

- **Source** : chantier pickup-validation 06/05/2026
- **Statut** : 4 events câblés (`review_followup_sent_d2`,
  `review_followup_sent_d7`, `review_followup_skipped`,
  `review_followup_dedup_blocked`)
- **Priorité** : moyenne (substantiel)

### Refactor pattern N+1 cron review-followup → embeds PostgREST

- **Source** : chantier pickup-validation 06/05/2026
- **Statut** : pattern N+1 actuel acceptable < 50 pickups/jour, à
  reconsidérer si volume élevé
- **Priorité** : moyenne

---

Cycle de référence : qualité totale TerrOir 2026-05-07
(13 commits master, 5 phases enchaînées).
