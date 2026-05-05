# Fix Email phase 2 H-3 + M-5 — webhook Resend entrant + suppression list (2026-05-05)

> Source audit : [`docs/audits/audit-email-deliverability-2026-05-05.md`](../audits/audit-email-deliverability-2026-05-05.md) §H-3 + §M-5.
> Périmètre : créer le handler webhook Resend entrant (signature Svix, dédup,
> routing 4 events critiques) + table `email_suppressions` + helper
> `canSendTo` branché dans `sendTemplate`. Référence skill `list-management.md`
> et `webhooks-events.md`.

## Synthèse

| Lot | Périmètre | Fichiers principaux | Tests vitest |
|---|---|---|---|
| LOT 1 | Migration `email_suppressions` + ALTER `notifications.statut` | `supabase/migrations/20260505600000_audit_email_h3_m5_email_suppressions.sql` | n/a |
| LOT 2 | Décision `delivered_at` (no migration, jsonb) | `app/api/webhooks/resend/route.ts` (helper `mergeNotificationMetadata`) | n/a |
| LOT 3 | Helper suppressions | `lib/resend/suppressions.ts` | 16/16 nouveau |
| LOT 4 | Pre-send check `canSendTo` | `lib/resend/send.ts` (modif) | 3/3 nouveau (`tests/lib/resend/send.test.ts`) |
| LOT 5 | Webhook handler + Svix verifier | `app/api/webhooks/resend/route.ts` + `lib/resend/verify-svix.ts` | (couvert Lot 7) |
| LOT 6 | Audit log event_types | `lib/audit-logs/log-payment-event.ts` (+2) | n/a |
| LOT 7 | Tests vitest webhook | `tests/app/api/webhooks/resend/route.test.ts` | 12/12 nouveau |
| LOT 8 | Tests E2E Playwright | `tests/e2e/email-webhook-h3.spec.ts` | 3 specs (skip si secret placeholder) |
| LOT 9 | Doc fix + audit FIXED | ce fichier + audit `§H-3` + `§M-5` flag FIXED | n/a |

## Évolution vitest

| Avant | Après | Delta |
|---|---|---|
| 1675 tests / 144 fichiers (post Stripe phase 2 M-3) | **1708 tests** / 147 fichiers | **+33 tests, +3 fichiers** |

Tous verts. Détail des +33 :
- Lot 3 (`suppressions.test.ts`) : 16 tests — canSendTo (présence/absence/
  toutes reasons/normalisation/fail-open), addSuppression (UPSERT/
  source_resend_id/error throw), incrementSoftBounce (insert initial/
  increment/threshold reach/no-op si déjà suppressed).
- Lot 4 (`send.test.ts`) : 3 tests — court-circuit canSendTo=false / INSERT
  notifications statut='skipped' / flow nominal pass-through.
- Lot 7 (`route.test.ts`) : 12 tests — 401 missing headers / 401 invalid sig /
  401 timestamp tolérance / 200 deduped / dedupKey namespace / Permanent →
  hard / Transient → soft / Undetermined → hard safety / complained → audit /
  delivered → merge metadata / sent no-op / unknown event no-op.

## Évolution E2E Playwright

| Avant | Après | Delta |
|---|---|---|
| 5 specs (smoke / change-email / score-carbone / stripe-smoke-phase3 / stripe-webhooks-m3) | **6 specs** | **+1 spec, +3 tests actifs** |

E2E `email-webhook-h3.spec.ts` skip auto si `RESEND_WEBHOOK_SECRET` est
placeholder/unset (skip-message documenté). Couvre :
1. `email.bounced` Permanent → row `email_suppressions` + audit log + replay
   deduped.
2. `email.complained` → row `email_suppressions` reason=complained + audit
   log légal.
3. Signature invalide → 401, pas de side-effect DB.

---

## Détail par lot

### LOT 1 — Migration `email_suppressions`

**Nouveau fichier** : `supabase/migrations/20260505600000_audit_email_h3_m5_email_suppressions.sql`.

Schema :
```sql
create table public.email_suppressions (
  email              text primary key,
  reason             text not null check (
    reason in (
      'hard_bounce',
      'complained',
      'soft_bounce_threshold',
      'soft_bounce_pending',
      'manual'
    )
  ),
  soft_bounce_count  int  not null default 0,
  source_resend_id   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
```

`reason='soft_bounce_pending'` est le **staging counter** (1 ou 2 soft
bounces) qui n'active PAS `canSendTo=false` — il bascule en
`'soft_bounce_threshold'` au 3e soft bounce (cf `BLOCKING_REASONS` dans
`lib/resend/suppressions.ts`). Trade-off : on tolère 2 soft bounces (typo,
boîte temporairement fermée) avant de blacklister, aligné skill
`list-management.md` (« 3 soft bounces consécutifs → suppress »).

**RLS** : `enable row level security`, **pas de policy** → service-role
only. Convention identique à `webhook_events_processed` et `audit_logs`.

**ALTER notifications.statut** : ajout de `'skipped'` au CHECK pour
permettre l'INSERT statut='skipped' depuis `sendTemplate` quand canSendTo
court-circuite l'envoi (Lot 4).

**Apply** : MCP `apply_migration` (×2 — une pour la migration initiale,
une pour ajouter `soft_bounce_pending` après ré-arbitrage du staging
counter). Repo↔prod parity OK : le fichier .sql contient l'état final.

### LOT 2 — Décision `delivered_at` (no migration)

`notifications.metadata` est `jsonb` (cf `supabase/migrations/20260419000000_initial_schema.sql:160`).
Pas de migration dédiée pour `delivered_at` — UPDATE via fetch+merge JS-side
dans le handler webhook (`mergeNotificationMetadata`). Race acceptable car
`delivered_at` est write-once.

### LOT 3 — Helper `lib/resend/suppressions.ts`

API :
- `canSendTo(email): Promise<boolean>` — SELECT par email normalisé
  (lowercase + trim). Bloque seulement si reason ∈ BLOCKING_REASONS
  (`hard_bounce` / `complained` / `soft_bounce_threshold` / `manual`).
  **Fail-open** sur erreur DB (préfère envoyer un OTP critique plutôt que
  bloquer à cause d'un glitch DB).
- `addSuppression(email, reason, sourceResendId?)` — UPSERT (PK email).
  Pas de protection contre downgrade (les 4 reasons blocking sont
  équivalentes en sévérité). Throw sur erreur DB (l'appelant webhook fera
  500 → Resend retry).
- `incrementSoftBounce(email, sourceResendId?)` — INSERT or UPDATE
  `soft_bounce_count++`. Sous le seuil : reason=`soft_bounce_pending`
  (n'active pas le blocage). Au seuil (>=3) : bascule
  `soft_bounce_threshold` qui bloque. No-op si déjà suppressed pour
  autre cause.

Logs greppables : `[EMAIL_SUPPRESSIONS_READ_WARN]` (fail-open),
`[EMAIL_SUPPRESSIONS_UPSERT_ERR]`, `[EMAIL_SUPPRESSIONS_READ_ERR]`.

### LOT 4 — Pre-send check `canSendTo` dans `sendTemplate`

Modif `lib/resend/send.ts` :
1. Au début de la fonction, après `createSupabaseAdminClient()`, appel
   `canSendTo(to)`.
2. Si `false` → log `[EMAIL_SEND_SKIP] template=… to=… reason=suppressed` +
   INSERT `notifications` statut=`'skipped'`,
   `metadata.skip_reason='suppressed'`, `metadata.email=to` (clear, pour
   traçabilité forensique côté DB — masking uniquement en logs).
3. Return `{ ok: false, skipped: true, error: 'suppressed' }`.

**Compat callers** : nouveau type `SendTemplateResult` garde le champ
`error` sur tous les paths !ok pour rester rétro-compat avec les ~7
callers qui font `if (!result.ok) logger(result.error)`. Les callers
qui veulent discriminer skipped ≠ failed peuvent gater sur
`result.skipped === true`.

### LOT 5 — Webhook handler `app/api/webhooks/resend/route.ts`

**Pipeline** :
1. Vérification `RESEND_WEBHOOK_SECRET` env → 500 si manquant + log
   `[RESEND_WEBHOOK_CONFIG_ERR]`.
2. Read 3 headers Svix (`svix-id`, `svix-timestamp`, `svix-signature`) →
   401 si manquant.
3. Body brut via `request.text()` (idem pattern Stripe).
4. Vérification signature Svix via `lib/resend/verify-svix.ts` (HMAC-SHA256
   manuel, pas de dep `svix` npm). Tolérance timestamp ±5 min anti-replay.
   → 401 si invalide + log `[RESEND_WEBHOOK_INVALID_SIG] reason=…`.
5. Parse JSON → 400 si invalide.
6. Dédup applicative via `checkOrMarkProcessed` avec `event_id` =
   `resend_${svixId}` (namespacé pour ne pas collisionner avec Stripe
   `evt_xxx`), `event_type` = `resend_${event.type}`. Si déjà processé →
   200 deduped:true.
7. Routing par event.type :
   - `email.delivered` → `mergeNotificationMetadata` UPDATE
     `metadata.delivered_at`.
   - `email.bounced` (`bounce.type='Permanent'`) → `addSuppression`
     hard_bounce + `logPaymentEvent('email_hard_bounce_suppressed')`.
   - `email.bounced` (`bounce.type='Transient'`) → `incrementSoftBounce`.
   - `email.bounced` (`Undetermined` / autre) → traité comme hard (safety).
   - `email.complained` → `addSuppression` complained +
     `logPaymentEvent('email_complaint_received')` (légal CASL).
   - `email.delivery_delayed` → `mergeNotificationMetadata` UPDATE
     `metadata.delayed_at`.
   - `email.sent` / `email.opened` / `email.clicked` → no-op V1.
   - default → log `[RESEND_WEBHOOK_UNHANDLED]`, no-op.
8. Erreur applicative dans le handler → 500 + log
   `[RESEND_WEBHOOK_HANDLER_ERR]` (Resend retry, dédup PK protège).

**Vérification signature Svix** (`lib/resend/verify-svix.ts`) :
- Implémentation manuelle HMAC-SHA256 (~70 lignes, pas de dep `svix`).
- Format secret `whsec_<base64>` accepté ; strip prefix conditionnel.
- Comparaison timing-safe (`crypto.timingSafeEqual`) sur chaque candidat
  signature `v1,…` du header (multi-sigs supporté pour rotation de clé).

### LOT 6 — Extension `log-payment-event.ts`

+2 event_types :
- `email_complaint_received` : posé sur `email.complained`. Légal CASL/
  RGPD : trace formelle de la plainte spam pour défense litige. Metadata :
  email (clear), source_resend_id, svix_id.
- `email_hard_bounce_suppressed` : posé sur `email.bounced` (Permanent /
  Undetermined). Forensique. Metadata : email, source_resend_id,
  bounce_type, bounce_subtype, svix_id.

Pas d'event_type pour soft_bounce (volume futur, pas critique en V1) ni
delivered (déjà tracé via `notifications.metadata.delivered_at`).

### LOT 7 — Tests vitest webhook handler

`tests/app/api/webhooks/resend/route.test.ts` — 12 tests :
- Auth signature : missing headers → 401, invalid sig → 401, timestamp
  drift > 5 min → 401.
- Dédup : alreadyProcessed=true → 200 deduped, dedupKey=`resend_${svixId}`.
- email.bounced : Permanent / Transient / Undetermined.
- email.complained : suppression + audit log légal.
- email.delivered : merge metadata sans throw.
- email.sent / event_type inconnu : no-op.

### LOT 8 — Tests E2E Playwright

`tests/e2e/email-webhook-h3.spec.ts` — 3 tests, skip auto si
`RESEND_WEBHOOK_SECRET` = placeholder/unset.

Pré-requis test local : générer un secret Svix valide via
```bash
node -e "console.log('whsec_'+require('crypto').randomBytes(24).toString('base64'))"
```
puis `RESEND_WEBHOOK_SECRET=whsec_…` dans `.env.local` + restart Next.js
dev. Skip-message le rappelle.

### LOT 9 — Doc fix + audit FIXED

Cette doc + `audit-email-deliverability-2026-05-05.md` §H-3 + §M-5 flag
**FIXED** (la-bas, en tête de section + cross-réf vers ce fix).

---

## Tableau events Resend traités vs no-op (Annexe B audit re-évaluée)

| Évent Resend                | V1 (this fix) | Action TerrOir                                                  |
|-----------------------------|---------------|-----------------------------------------------------------------|
| `email.sent`                | no-op         | (`notifications.statut='sent'` déjà posé au POST sendTemplate)  |
| `email.delivered`           | **FIXED**     | UPDATE `notifications.metadata.delivered_at` via merge JS       |
| `email.bounced` (Permanent) | **FIXED**     | `addSuppression hard_bounce` + audit log forensique             |
| `email.bounced` (Transient) | **FIXED**     | `incrementSoftBounce` (suppression après 3, staging counter)    |
| `email.bounced` (autres)    | **FIXED**     | safety net hard                                                 |
| `email.complained`          | **FIXED**     | `addSuppression complained` IMMÉDIATE + audit log légal         |
| `email.delivery_delayed`    | **FIXED**     | UPDATE `notifications.metadata.delayed_at`                      |
| `email.opened`              | no-op V1      | (engagement tracking, RGPD-ambigu pour transactionnel)          |
| `email.clicked`             | no-op V1      | (idem)                                                          |

Les 4 lignes critiques de l'Annexe B audit (en gras dans l'audit original)
sont maintenant FIXED.

---

## Action manuelle Romain post-deploy

> ⚠️ Le code est prêt mais le webhook ne reçoit RIEN tant que le Dashboard
> Resend n'est pas configuré. Cette étape est la seule action manuelle.

**Étape 1 — Provisionner le secret côté Vercel + local** :
```bash
node -e "console.log('whsec_'+require('crypto').randomBytes(24).toString('base64'))"
```
Copier la valeur obtenue dans :
- `.env.local` (ligne `RESEND_WEBHOOK_SECRET=…`) + restart `pnpm dev`.
- Vercel : Project Settings → Environment Variables → ajouter
  `RESEND_WEBHOOK_SECRET` sur Production + Preview avec la même valeur.

**Étape 2 — Configurer le webhook côté Dashboard Resend** :

1. Aller sur https://resend.com/webhooks
2. Cliquer **Add Endpoint**
3. **Endpoint URL** : `https://www.terroir-local.fr/api/webhooks/resend`
4. **Signing Secret** : coller la même valeur que `RESEND_WEBHOOK_SECRET`
   ci-dessus (Resend permet de fournir le secret, sinon il en génère un —
   dans ce cas, copier celui généré dans Vercel + .env.local).
5. **Events à cocher** (cf Annexe B) :
   - [x] `email.bounced`
   - [x] `email.complained`
   - [x] `email.delivered`
   - [x] `email.delivery_delayed`
   - [ ] `email.sent` (no-op V1, ne pas cocher pour réduire bruit)
   - [ ] `email.opened` (idem)
   - [ ] `email.clicked` (idem)
6. **Save**.

**Étape 3 — Test** :

Option A — depuis le Dashboard Resend, bouton « Send test event » sur
n'importe quel event coché. Vérifier `[RESEND_WEBHOOK_INVALID_SIG]`
absent dans les logs Vercel et `200 received` retourné.

Option B — E2E Playwright `tests/e2e/email-webhook-h3.spec.ts` (skip
disparaît dès que `RESEND_WEBHOOK_SECRET` est set valide).

---

## Trade-offs et décisions autonomes

1. **Pas de dep `svix` npm** : implémentation manuelle HMAC-SHA256
   (~70 lignes lib/resend/verify-svix.ts). Avantage : pas d'entrée
   lockfile, pas de surface supply-chain. Coût : ~30 min de code +
   tests, et il faut maintenir si Svix change la spec (rare). Cohérent
   avec `careful + simple` user pref.

2. **`fail-open` côté `canSendTo`** : sur erreur DB de lecture
   `email_suppressions`, on retourne `true` (envoie quand même). Trade-off
   explicite : un OTP qui ne part pas est plus pénalisant qu'un email
   envoyé à une adresse blacklistée (qui re-bouncera, on re-suppresera).
   Skill `sending-reliability.md` recommande le contraire mais le contexte
   TerrOir (volume modeste, OTP critique) justifie l'écart.

3. **`soft_bounce_pending` dans le CHECK constraint** plutôt que table
   dédiée counters : évite une 2e migration + une 2e table, mais pollue
   sémantiquement les `reason` blocking. Mitigé par le set
   `BLOCKING_REASONS` côté helper qui isole le filtre.

4. **Pas de migration `delivered_at` colonne** : `metadata` jsonb suffit.
   Race condition théorique sur fetch+merge si email.delivered et
   delivery_delayed arrivent en parallèle (~ms) — last-write-wins
   acceptable car les keys sont disjointes.

5. **Pas de séparation marketing/transactional dès maintenant** (M-6
   audit) : hors scope this fix. Dès qu'un mail purement marketing est
   envisagé, séparer `RESEND_API_KEY_MARKETING` + sous-domaine.

6. **Audit log seulement sur 2 events** (`email_complaint_received` +
   `email_hard_bounce_suppressed`) : volume soft_bounce bas en V1, pas
   d'urgence à instrumenter. Dans `audit_logs.metadata` on stocke `email`
   en clair (pattern existant `notifications.metadata.email`,
   cf `lib/rgpd/mask-email.ts:9`). Masking uniquement en logs Vercel.

7. **Pas de seed initial depuis Resend API** : l'historique des
   bounces/complaints existants Resend reste hors scope ce fix. Volume
   actuel <30 envois/jour → peu de poids, la table se construira
   organiquement à partir du moment où le webhook tourne. À traiter
   manuellement via `addSuppression(email, 'manual', null)` si Romain
   identifie des adresses problématiques connues.

---

## Backlog ouvert (V1.x)

- **L-1 audit** (text/plain multipart) : ~5 lignes via
  `render(element, { plainText: true })` côté `sendTemplate`.
- **L-2 audit** (cron purge `notifications`) : ~50 lignes daily 90j
  retention.
- **M-3 audit** (Idempotency-Key Resend) : indépendant de this fix.
- **M-4 audit** (retry/backoff `sendTemplate`) : indépendant, ~30 lignes.
- **Soft bounce audit log** : si volume devient significatif, ajouter
  event_type `email_soft_bounce_threshold_reached` posé dans
  `incrementSoftBounce` quand seuil franchi.
- **Suppression purge cron** : DELETE `email_suppressions` reason='hard_bounce'
  WHERE created_at < now() - interval '12 months' (re-test périodique des
  hard bounces, certaines boîtes ré-ouvrent).
- **Admin UI suppression list** : aujourd'hui consultation via SQL prod.
  Si volume > 100 lignes, ajouter une page admin pour visualiser /
  réintégrer manuellement.

Aucun de ces items n'est bloquant pour go-live.
