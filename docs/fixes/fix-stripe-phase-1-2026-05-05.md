# Fix Stripe phase 1 — 2026-05-05

> Source audit : [`docs/audits/audit-stripe-2026-05-05.md`](../audits/audit-stripe-2026-05-05.md).
> Périmètre phase 1 = "easy wins" faible risque + ROI immédiat. Les phases 2 (H-2 Connect v2, M-1 dynamic payment methods, M-3 webhook events) et 3 (H-1 + H-3 SDK + apiVersion) restent ouvertes.

## Synthèse

| Lot | Finding audit | Statut | Fichiers principaux | Tests |
|---|---|---|---|---|
| LOT 1 | M-2 Idempotency-key refund revival | ✅ FIXED | `lib/stripe/handle-payment-succeeded.ts` | `handle-payment-succeeded.test.ts` 14/14 |
| LOT 2 | M-4 Cron monitoring disputes deadline | ✅ FIXED (NEW) | `app/api/cron/disputes-deadline-check/route.tsx` + template + vercel.json | `route.test.tsx` 6/6 |
| LOT 3 | M-6 Guard pré-PI charges_enabled | ✅ FIXED | `app/api/stripe/create-payment-intent/route.ts` | `route.test.ts` 12/12 (+2 nouveaux) |
| LOT 4 | L-2 business_type prompt onboarding | ✅ FIXED | `app/api/stripe/connect/onboard/route.ts` | `route.test.ts` 8/8 |
| LOT 5 | L-4 Schedule cron order-timeout alignement | ✅ FIXED | `app/api/cron/order-timeout/route.tsx` (commentaire) | (pas de test impacté) |
| LOT 6 | L-5 Workflow refund producer | ✅ FIXED | `app/api/stripe/refund/route.tsx` (renommé .ts→.tsx) + template | `route.test.ts` 23/23 (+4 nouveaux) |
| LOT 7 | L-6 Documentation idempotency-key | ✅ FIXED | `docs/conventions/stripe-idempotency.md` | n/a |
| LOT 8 | M-5 Runbook go-live Stripe | ✅ FIXED (DRAFT) | `docs/runbooks/go-live-stripe.md` | n/a |

## Évolution vitest

| Avant | Après | Delta |
|---|---|---|
| 1650 tests / 141 fichiers | **1662 tests** / 141 fichiers | **+12 tests** |

Tous verts. Détail des +12 :
- LOT 2 : 6 tests (auth, no-disputes, J-2 soon, J-1 urgent +SMS, J-1 urgent sans SMS, deadline missed).
- LOT 3 : 2 tests (M-6-A charges_enabled false → 409, M-6-B producer introuvable → 409).
- LOT 6 : 4 tests (L-5-A producer < seuil sans email, L-5-B producer ≥ seuil avec email, L-5-C producer Stripe throw audit fail, L-5-D threshold env override).

## Détail par lot

### LOT 1 — M-2 Idempotency-key refund revival

**Diff principal** : `lib/stripe/handle-payment-succeeded.ts` ligne 211 — refund Stripe émis dans le path `revival_blocked_*` n'avait pas d'idempotency-key (les 2 autres paths admin/timeout en avaient un).

```diff
- await stripe.refunds.create({ payment_intent: paymentIntent.id });
+ await stripe.refunds.create(
+   { payment_intent: paymentIntent.id },
+   { idempotencyKey: `refund_${orderId}_revival` },
+ );
```

Defense-in-depth : la dédup `webhook_events_processed` (PK `event_id`) attrape déjà un rejouage `payment_intent.succeeded` AVANT le code revival, mais le suffixe `_revival` discrimine le path et protège contre une purge erronée de la table dédup.

### LOT 2 — M-4 Cron disputes-deadline-check (NEW)

**Nouveau fichier** : `app/api/cron/disputes-deadline-check/route.tsx`. Cron quotidien 8h UTC (`vercel.json` schedule `0 8 * * *`).

3 buckets selon `evidence_due_by` :
- **soon** (24h–72h) : email "Rappel" admin via SUPPORT_EMAIL.
- **urgent** (<24h) : email "URGENT 24h" + SMS Twilio si `TWILIO_ADMIN_PHONE` configuré.
- **missed** (déjà passée) : audit log forensique `stripe_dispute_deadline_missed` (Stripe va auto-perdre, on trace).

Read-only Stripe (pas de soumission auto d'evidence — sujet V1.x avec compelling evidence 3.0).

**Nouveaux event_types** : `stripe_dispute_deadline_warning`, `stripe_dispute_deadline_missed` ajoutés à `PAYMENT_EVENT_TYPES` (`lib/audit-logs/log-payment-event.ts`).

**Nouveau template** : `lib/resend/templates/admin-dispute-deadline-warning.tsx`.

### LOT 3 — M-6 Guard pré-PI charges_enabled

**Diff** : `app/api/stripe/create-payment-intent/route.ts` ajoute un SELECT `producers.stripe_charges_enabled` après auth check, retourne 409 `producer_not_ready` si false ou producer introuvable.

L'invariant `promoteProducerToPublicIfActive` empêche déjà un producer non-charges-enabled d'apparaître en `statut='public'` côté RLS, mais ce guard attrape le cas limite producer charges_enabled au moment de l'order qui perd la capability ENTRE order create et PI create (latence webhook `account.updated`, KYC re-flagged).

### LOT 4 — L-2 business_type prompt onboarding

**Diff** : `app/api/stripe/connect/onboard/route.ts` retire `business_type: "individual"` hardcodé. Stripe demande désormais le type via le accountLink natif (sélecteur Auto-entrepreneur / SARL / EURL / SAS / GAEC / Autre tenu à jour côté Stripe).

Décision retenue : **omettre** (vs prompt UI Zod custom). Plus simple, pas de friction UI nouvelle, prompt Stripe natif à jour automatiquement.

### LOT 5 — L-4 Schedule cron order-timeout

**Diff** : `app/api/cron/order-timeout/route.tsx` — commentaire ligne 20 réaligné sur le schedule daily 9h UTC réel (`vercel.json` `0 9 * * *`).

Décision retenue : **KEEP daily, aligner commentaire** (vs bumper hourly). Trade-off accepté : timeout effectif compris entre 24h et 48h en daily (vs 24-25h en hourly). Cron hourly = 24 invocations/jour pour quelques timeouts/jour = overkill.

### LOT 6 — L-5 Workflow refund producer

**Diffs** :
1. `app/api/stripe/refund/route.ts` → renommé `.tsx` (introduction de JSX template email).
2. Discrimination `refundedByProducer` flag basé sur l'auth (admin vs producer-owner).
3. Audit log success symétrique au failed historique : `order_admin_refund_succeeded` / `order_producer_refund_succeeded` selon path.
4. Email admin via `SUPPORT_EMAIL` si producer + `montant_total >= SUPPORT_REFUND_THRESHOLD_EUR` (default 100€).

**Nouveaux event_types** : `order_admin_refund_succeeded`, `order_producer_refund_succeeded`, `order_producer_refund_failed`.

**Nouveau template** : `lib/resend/templates/admin-producer-refund-alert.tsx`.

> Trade-off conscient : l'idempotencyKey reste `refund_${order.id}_admin` même quand l'émetteur est le producer (vs introduire `_producer`). Décision : éviter un risque de prod (idempotency miss sur retry post-deploy). Discrépance documentée dans `docs/conventions/stripe-idempotency.md` — V1.x peut introduire un suffixe `_producer` propre.

### LOT 7 — L-6 Documentation idempotency-key

**Nouveau fichier** : `docs/conventions/stripe-idempotency.md`. Inventaire des 7 conventions actuelles + règle générale (`<verb>_<entityId>[_<context>]`) + anti-patterns (UUID inline, timestamp, key réutilisée). Référencé depuis le runbook go-live + audit phase A.

### LOT 8 — M-5 Runbook go-live Stripe (DRAFT)

**Nouveau fichier** : `docs/runbooks/go-live-stripe.md`. Marqué WIP — phase B à compléter (3DS exhaustif, RGS payouts, communication producteurs).

Sections clés :
- **Étape 0** : préparer compte Stripe live (KYC, API version, Connect settings).
- **Étape 1** : bascule vars env Vercel test → live.
- **Étape 2** : créer webhook endpoint live (réplique stricte des 8 events test).
- **Étape 3** : SQL purge IDs Stripe DB (Option 1 audit M-5 retenue).
- **Étape 4** : 6 smoke tests post-cutover (ping, webhook, Connect onboard, checkout E2E, cron disputes, balance).
- **Étape 5** : communication producteurs (template email + SMS + bannière in-app).
- **Étape 6** : procédure rollback (24h max).

## Trade-offs assumés

1. **Idempotency key path producer reste `_admin`** (LOT 6) : éviter un risque prod sur retry. Discrépance documentée, V1.x peut introduire `_producer`.
2. **Cron disputes-deadline-check ne soumet pas d'evidence auto** : Stripe Compelling Evidence 3.0 nécessite des données métier (proof of delivery photos, exchange logs) — pas dans le scope phase 1. Le cron alerte, l'admin agit.
3. **Cron order-timeout reste daily** (LOT 5) : timeout effectif 24-48h vs 24-25h en hourly. ROI hourly négatif (24× invocations pour quelques timeouts/jour).
4. **business_type retiré complètement** (LOT 4) : pas de prompt UI Zod custom, on délègue au accountLink Stripe natif. Trade-off : si Stripe change le sélecteur (rare), TerrOir s'aligne automatiquement (pas de re-deploy).
5. **Runbook marqué WIP** (LOT 8) : 6 items phase B identifiés mais non détaillés (PCI DSS SAQ A, 3DS exhaustif, RGS payouts T+2 vs T+7, IP allowlist webhook, Apple Pay domain verification, observation thresholds cron disputes).

## Backlog ouvert

### Phase 2 — avant go-live (à arbitrer ROI)

- **H-2** Connect v2 + controller properties — refacto `accounts.create` legacy `type` → v2 API. ~6-12h.
- **M-1** Dynamic payment methods (Apple Pay + Google Pay + SEPA) — couplé domain verification Apple. ~2-4h, impact conversion mobile potentiellement +10-20%.
- **M-3** Subscribe `radar.early_fraud_warning.created` + `charge.refunded` (+ `account.application.deauthorized`). 2 handlers + audit logs + INSERT/UPDATE settled_at. ~2h.

### Phase 3 — IMPÉRATIF avant go-live

- **H-1** Bump `apiVersion: "2025-02-24.acacia"` → `2026-04-22.dahlia` (14 mois behind, 5 majors).
- **H-3** Bump `stripe@17.7.0` → `22.x` + `@stripe/stripe-js@4.10.0` → `9.x`. Breaking TS likely. ~4-8h en séquencé (PR1 SDK, PR2 apiVersion, manual Dashboard upgrade).

### Phase B — post-go-live (V1.x)

- **L-1** IP allowlist Stripe webhook (Vercel Edge Middleware ou Cloudflare WAF).
- **L-3** Apple Pay domain verification (couplé M-1).
- Audits conformité : PCI DSS SAQ A, 3DS exhaustif, RGS payouts arbitrage T+2 vs T+7.
- V1.x si abus observé : cap montant + approval admin sur refund producer (vs juste audit log + email phase 1).

## Fichiers créés / modifiés

### Créés (10)

- `app/api/cron/disputes-deadline-check/route.tsx`
- `tests/app/api/cron/disputes-deadline-check/route.test.tsx`
- `lib/resend/templates/admin-dispute-deadline-warning.tsx`
- `lib/resend/templates/admin-producer-refund-alert.tsx`
- `app/api/stripe/refund/route.tsx` (issu de `.ts`, supprimé)
- `docs/conventions/stripe-idempotency.md`
- `docs/runbooks/go-live-stripe.md`
- `docs/fixes/fix-stripe-phase-1-2026-05-05.md` (ce fichier)

### Modifiés (10)

- `app/api/cron/order-timeout/route.tsx` (commentaire L-4)
- `app/api/stripe/connect/onboard/route.ts` (L-2)
- `app/api/stripe/create-payment-intent/route.ts` (M-6)
- `lib/audit-logs/log-payment-event.ts` (event_types ajoutés)
- `lib/stripe/handle-payment-succeeded.ts` (M-2)
- `vercel.json` (schedule + maxDuration cron disputes)
- `tests/app/api/stripe/create-payment-intent/route.test.ts` (+2 tests M-6)
- `tests/app/api/stripe/refund/route.test.ts` (+4 tests L-5 + adaptations objectContaining)
- `tests/lib/stripe/handle-payment-succeeded.test.ts` (assertion idempotencyKey M-2)

### Supprimés (1)

- `app/api/stripe/refund/route.ts` (renommé `.tsx`)

## Migrations DB

**Aucune** dans cette phase 1. Les nouveaux event_types vont dans `audit_logs.event_type` (colonne `text` non-enum, pas besoin de migration). Le cron disputes lit `public.disputes` (table existante migration `20260429020000`).

## Variables d'environnement à ajouter

- `TWILIO_ADMIN_PHONE` (optionnel) — numéro admin pour SMS urgent <24h disputes. Si absent, le cron envoie email seul.
- `SUPPORT_REFUND_THRESHOLD_EUR` (optionnel) — seuil refund producer déclenchant email admin. Default 100.

## Questions / ambiguïtés rencontrées

Aucune bloquante. Décisions prises en autonomie :

1. **Path producer-owned idempotencyKey** : gardé `_admin` (cf. trade-off ci-dessus) pour ne pas casser un retry post-deploy.
2. **`order_admin_refund_succeeded`** : nouvel event_type ajouté en parallèle (audit demandait `order_producer_refund_*` seulement, mais sans le pendant admin l'instrumentation forensique reste asymétrique).
3. **Template email producer-refund-alert** : créé léger sans body riche (vs réutiliser admin-dispute) — un email distinct facilite le filtrage côté inbox admin.
4. **Cron disputes 8h UTC** : choix `0 8 * * *` (juste avant matin admin). Pas hourly (overkill), pas 6h (trop tôt côté France hiver). Aligne aussi sur le pattern existant `reminder-sms` daily 8h UTC.
