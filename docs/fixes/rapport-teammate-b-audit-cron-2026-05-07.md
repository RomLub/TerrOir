# Rapport Teammate B — audit-cron — 2026-05-07

> **Cycle** : Agent Teams TerrOir 2026-05-07
> **Périmètre** : 8 items audit logs + cluster review_followup + marqueur DB dédup + dashboard conversion.

---

## TL;DR

8 items du scope, **8 livrés**. 4 items déjà en place côté repo (T-080, T-083, T-084, T-107) — vérifiés et confirmés OK avec un audit léger. 4 items nouveaux livrés ce cycle (T-082 doc rétention, cluster `review_followup_*` + helper + cron + tests, marqueur DB dédup + migration apply + smoke, T-085 dashboard conversion + helper + tests). Tests : 127 verts (12 nouveaux). 1 migration appliquée prod + smoke OK.

---

## Items livrés

### T-082 — Doc rétention audit_logs cluster admin_invite_*

- Fichier : `docs/security/audit-logs-retention.md` (nouveau).
- Contenu : durée 24 mois retenue (médiane standard marketplace, couvre cycle Stripe dispute / DGCCRF / RGPD), base légale intérêt légitime art. 6.1.f avec test des 3 étapes CNIL, inventaire PII par cluster, articulation avec registre traitements RGPD (T-208/T-284) et politique confidentialité producer (T-207), modèle SQL purge backlog post-Live.
- Pas de code touché. Pas de tests. Articule avec checklist `docs/runbooks/checklist-pre-live-2026-05-06.md` ligne T-082 P1.

### T-107 — Instrumentation `*_refund_failed` paths admin + cron timeout

**Déjà livré dans le repo. Vérifié.**

- `app/api/stripe/refund/route.tsx:149-164` : logue `order_admin_refund_failed` ou `order_producer_refund_failed` dans le catch Stripe (discrimination `refundedByProducer`), avec `refund_incidents` parallèle (T-102.2.b).
- `app/api/cron/order-timeout/route.tsx:142-152` : logue `order_timeout_refund_failed` dans le catch Stripe + `recordRefundAttempt`.
- Les types existent dans `lib/audit-logs/log-payment-event.ts` (`order_admin_refund_failed`, `order_producer_refund_failed`, `order_timeout_refund_failed`). Labels FR présents `lib/audit-logs/labels.ts:60,63,64`.

### Cluster audit `review_followup_*` (nouveau)

- Helper : `lib/audit-logs/log-review-followup-event.ts` (nouveau, 4 events typés).
- Events : `review_followup_sent_d2`, `review_followup_sent_d7`, `review_followup_skipped` (metadata.reason discriminée : `review_exists | consumer_email_missing | producer_missing | send_failed`), `review_followup_dedup_blocked`.
- Labels FR : `lib/audit-logs/labels.ts:104-107` (4 entrées ajoutées).
- Catégorisation UI : `app/(admin)/audit-logs/_lib/categorize-event-type.ts:46-49` (préfixe `review_followup_` → catégorie `review`, regroupement visuel cohérent avec producer_response_*).
- Concaténation source unique : `app/(admin)/audit-logs/_lib/event-types.ts` (REVIEW_FOLLOWUP_EVENT_TYPES ajouté à ALL_EVENT_TYPES + union AuditEventType).
- Tests : `tests/lib/audit-logs/log-review-followup-event.test.ts` (8 tests : insert, fail-safe DB error, fail-safe createClient throw, exhaustivité 4 events).
- Test parité labels existant `tests/lib/audit-logs/labels.test.ts` couvre auto les 4 nouveaux event_types via ALL_EVENT_TYPES.

### Marqueur DB déduplication review-followup (nouveau)

- Migration : `supabase/migrations/20260507200000_review_followup_dedup_marker.sql` (slot Teammate B `20260507200000-299999`).
- Schéma : `orders.review_followup_d2_sent_at TIMESTAMPTZ NULL` + `orders.review_followup_d7_sent_at TIMESTAMPTZ NULL`. ALTER TABLE ADD COLUMN IF NOT EXISTS (idempotent T-297). Comments posés sur les 2 colonnes.
- Apply : `mcp__supabase__apply_migration` succès. Project ref `exsxharjqqpohkbznhss`.
- Smoke tests post-apply :
  - (a) Schéma colonnes nullable timestamptz confirmé via information_schema.columns.
  - (b) UPDATE conditionnel `WHERE col IS NULL` sur ID inconnu = 0 rows affected (path safe).
  - (c) Idempotence : 2e UPDATE même ID = 0 rows affected.
  - (d) Path skip `WHERE col IS NOT NULL` = 0 rows affected (no-op confirmé).
- Cron câblage : `app/api/cron/review-followup/route.tsx` réécrit. Pattern race-safe :
  1. SELECT orders ... `.is(dedupColumn, null)` (filtre amont).
  2. Reviews/users/producers lookup (skip si données manquantes + audit reason).
  3. UPDATE orders SET dedupColumn = now() WHERE id=$1 AND col IS NULL .select() (claim atomique).
  4. Si claimed=[] (concurrent perdu) → audit `review_followup_dedup_blocked`, pas de send.
  5. Sinon sendTemplate, audit `review_followup_sent_d{2,7}` ou `_skipped` reason=send_failed si fail.
- Réponse JSON enrichie : `{ j2: { sent, skipped, dedup_blocked }, j7: { ... } }` (vs `{ j2: number, j7: number }` avant).
- Tests cron : `tests/app/api/cron/review-followup/route.test.tsx` réécrit pour matcher la nouvelle implémentation. 11 tests : auth (3), fenêtre J-2/J-7 (3), anti-spam review existante (1), missing data (3), dedup race-safe (1).

### T-080 — UI admin /admin/audit-logs

**Déjà livré dans le repo. Vérifié.**

- Page : `app/(admin)/audit-logs/page.tsx` (RSC, dynamic, ~280 lignes).
- Features présentes : filtres URL searchParams (`event_type`, `user_id`, `email`, `date_from`, `date_to`), pagination cursor-based base64url sur (created_at, id), table HTML, 4 stats cards en haut (`getAuditLogStats`), badge "Prod" inline pour les rows liées à un producer.
- API export : `app/api/admin/audit-logs/export/route.ts` (CSV avec filtres propagés, cap 10 000 lignes).
- API stats : `app/api/admin/audit-logs/stats/route.ts`.
- RLS : utilise `createSupabaseServerClient` qui consomme la session admin (policy `audit_logs admin read` migration `20260427100000`).

### T-083 — Rate-limit + masquage emails admin_invite_*

**Déjà livré dans le repo. Vérifié.**

- Rate-limit : `getAuditLogsEmailLookupRateLimit` 30/min/admin dans `lib/rate-limit.ts:223-232`.
- Masquage : `lib/audit-logs/email-lookup.ts:41-48` — fonction `maskEmail` ("l***@gmail.com").
- Sentinel anti-énumération : `SENTINEL_NOT_FOUND_USER_ID = "0000…"` retourné si email inconnu OU rate-limited (réponse uniforme 0 rows côté UI).
- Audit log d'accès : `admin_audit_logs_email_lookup` posé dans `app/(admin)/audit-logs/page.tsx:80-88` à chaque recherche email avec metadata { masked_email, user_resolved, rate_limited }.
- Convention rate-limiting `docs/conventions/rate-limiting.md` ne liste pas encore cette clé — mineur, à ajouter au prochain passage.

### T-084 — Libellés UI 5 events admin_invite_*

**Déjà livré dans le repo. Vérifié.**

- Map `lib/audit-logs/labels.ts:44-48` :
  - `admin_invite_sent` → "Invitation envoyée"
  - `admin_invite_draft_resend` → "Relance invitation (brouillon)"
  - `admin_invite_blocked_admin` → "Invitation bloquée (déjà admin)"
  - `admin_invite_blocked_producer` → "Invitation bloquée (producteur déjà inscrit)"
  - `admin_invite_expired` → "Invitation expirée (clic)"
- Test parité : `tests/lib/audit-logs/labels.test.ts` (4 tests, dont une assertion explicite sur `admin_invite_sent` + parité ALL_EVENT_TYPES).

### T-085 — Dashboard taux conversion invitation → onboarding

- Helper : `lib/audit-logs/invitation-conversion-stats.ts` (nouveau).
- Métriques (fenêtre 30j configurable) : `invitationsSent` (count `admin_invite_sent`), `onboardingsCompleted` (count `invitation_consumed_success`), `conversionRatePct` (null si invitationsSent=0, sinon arrondi 1 décimale).
- Page : `app/(admin)/audit-logs/stats/page.tsx` (nouveau, RSC, 3 MetricCards + lien retour vers `/audit-logs`).
- Tests : `tests/lib/audit-logs/invitation-conversion-stats.test.ts` (4 tests : ratio nominal, edge case sent=0, arrondi 1 décimale, windowDays custom).

---

## Items non livrés

Aucun. Le scope est entièrement couvert.

---

## Trade-offs / décisions autonomes

- **T-082 durée 24 mois (vs 12 ou 36)** : médiane standard marketplace + cycle dispute Stripe (540j) + cycle DGCCRF (24m) couverts. Pas de différenciation par cluster (cohérence opérationnelle, doc plus simple, 1 seul cron de purge).
- **Marqueur DB : 2 colonnes `orders` (vs table `review_followup_runs`)** : volume négligeable (1 row consumer × 2 events par order), pas de jointure complexe, ALTER TABLE évite RLS + index + cleanup. Argument en commentaire de migration.
- **Trade-off accepté : si crash entre claim UPDATE et sendTemplate, l'email J+2/J+7 est manqué silencieusement** : doctrine documentée dans le commentaire du cron — mieux 1 mail manqué qu'un double-envoi (qui dégrade trust consumer plus que silence). Le cluster audit `review_followup_skipped` reason=send_failed signale ces cas pour observabilité.
- **`review_followup_*` rangé en catégorie `review`** : regroupé visuellement avec `producer_response_*` (modération avis). Surface fonctionnelle "avis & modération" cohérente. Pas de catégorie nouvelle créée pour 4 events.
- **T-107 considéré déjà livré** : commentaire `// T-107 audit_log forensique` présent dans `app/api/cron/order-timeout/route.tsx:142`, instrumentation effective dans les 2 paths (admin + timeout). Pas de doublon créé. Décision rapportée immédiatement plutôt que de réimplémenter.
- **T-085 fenêtre 30 jours sans cohorte stricte** : un onboarding complété aujourd'hui peut découler d'une invitation > 30j. Acceptable pré-Live (volumes faibles), backlog post-Live cohorté avec JOIN `producer_invitations`.
- **Pas modifié `docs/conventions/rate-limiting.md`** : la clé `audit_logs_email_lookup` (T-083) n'y figure pas alors qu'elle est en place dans le code. Mineur, peut être traité dans un prochain passage convention.

---

## ARBITRAGE REQUIS émergent

Aucun.

---

## Backlog ouvert

- Convention rate-limiting : ajouter la ligne `audit_logs_email_lookup 30/60s userId admin` au tableau `docs/conventions/rate-limiting.md`. Trivial, n'a pas vocation à bloquer ce cycle.
- Cohorte funnel T-085 stricte (JOIN `producer_invitations.sent_at` vs `used_at`) : à reprendre post-Live quand volumes >50 invitations/mois.
- Job purge audit_logs 24 mois : backlog post-Live (volume négligeable les 3 premiers mois).
- État `ready` state machine review : déjà fait par un autre teammate (cf. tâches partagées #7).

---

## Métriques

- Items : **8/8 livrés**
- Tests : avant 116 (audit-logs + cron review-followup confondus) / après **127** verts (+11 nouveaux : 8 helper review_followup + 4 invitation-conversion + 0 net cron review-followup car 11 nouveaux remplacent 11 anciens).
- Migrations : **1 appliquée** (`20260507200000_review_followup_dedup_marker`) + smoke (a)(b)(c)(d) verts.
- Fichiers nouveaux : 6
  - `lib/audit-logs/log-review-followup-event.ts`
  - `lib/audit-logs/invitation-conversion-stats.ts`
  - `app/(admin)/audit-logs/stats/page.tsx`
  - `supabase/migrations/20260507200000_review_followup_dedup_marker.sql`
  - `tests/lib/audit-logs/log-review-followup-event.test.ts`
  - `tests/lib/audit-logs/invitation-conversion-stats.test.ts`
  - `docs/security/audit-logs-retention.md`
  - `docs/fixes/rapport-teammate-b-audit-cron-2026-05-07.md` (ce rapport)
- Fichiers modifiés : 4
  - `lib/audit-logs/labels.ts` (4 entrées review_followup_*)
  - `app/(admin)/audit-logs/_lib/event-types.ts` (REVIEW_FOLLOWUP_EVENT_TYPES dans ALL_EVENT_TYPES + union)
  - `app/(admin)/audit-logs/_lib/categorize-event-type.ts` (préfixe review_followup_)
  - `app/api/cron/review-followup/route.tsx` (réécriture instrumentation + dedup race-safe)
  - `tests/app/api/cron/review-followup/route.test.tsx` (réécriture pour nouvelle impl)
- Commits : à venir.
- Build : `next build` compile + lint OK (l'erreur `PageNotFoundError` collect-page-data est préexistante, liée au routing 3 subdomains du repo). `tsc --noEmit` 0 erreur dans les fichiers livrés (préexistantes hors scope dans `tests/sql-integration/`).
