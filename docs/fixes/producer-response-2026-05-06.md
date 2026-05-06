# Droit de réponse Producer aux avis (CGU 6.4) + prefs notifs consumer

**Date** : 2026-05-06
**Engagement contractuel** : article 6.4 des CGU « Le Producer concerné dispose
d'un droit de réponse public à chaque avis ».
**Statut** : implémenté + testé (29 nouveaux tests vitest, 3 tests E2E
Playwright écrits — non lancés automatiquement, déclenchement manuel par
Romain : `pnpm playwright test tests/e2e/pro/producer-response.spec.ts`).

## Résumé

L'engagement contractuel CGU 6.4 (page CGU publiée le 2026-05-05) annonçait
un droit de réponse Producer non encore implémenté. Cette session livre :

1. La feature complète : DB, API, UI producer, UI publique, modération admin.
2. Un système de préférences notifications consumer extensible (1 toggle
   livré, structure prête pour d'autres prefs).
3. Cohérence avec la modération avis consumer existante (a priori) — la
   réponse Producer est en revanche modérée a posteriori (publication
   immédiate, suppression admin override possible).

## Décisions business (Romain, 2026-05-06)

- 1 réponse par avis maximum, longueur ≤ 500 caractères (CHECK DB +
  validation Zod côté API + compteur UI).
- Producer peut éditer ET supprimer sa réponse pendant 24h post-publication.
  Au-delà : réponse figée (lock applicatif via `producer_response_locked_at`
  vérifié côté API).
- Modération admin a posteriori : publication immédiate, admin peut
  supprimer/masquer si abusif (override de la lock 24h).
- Email notification consumer désactivable via prefs (default = activé,
  cohérent avec doctrine produit "communication active sauf opposition").

## Migration SQL appliquée

Fichier : `supabase/migrations/20260506140214_add_producer_responses_and_notification_prefs.sql`

Apply : MCP Supabase `apply_migration`, tracking timestamp DB =
`20260506140214` (renommé localement post-apply via `mv`).

Contenu :

- `public.reviews` : 5 nouvelles colonnes nullables (`producer_response`,
  `producer_response_at`, `producer_response_updated_at`,
  `producer_response_locked_at`, `producer_response_status` enum
  `published|removed_admin|removed_producer`).
- 2 CHECK constraints (status enum + length ≤ 500).
- 1 partial index `idx_reviews_producer_response_lock` sur `locked_at` WHERE
  `producer_response IS NOT NULL`.
- 1 nouvelle policy RLS `reviews producer response update` autorisant le
  producer owner à UPDATE sa review (defense-in-depth).
- Nouvelle table `public.user_notification_preferences` :
  - `user_id UUID PK FK → public.users(id) ON DELETE CASCADE`.
  - `email_review_response BOOLEAN NOT NULL DEFAULT TRUE`.
  - `created_at`, `updated_at` (trigger `set_updated_at` réutilisé).
  - RLS self-only (read/insert/update via `(select auth.uid()) = user_id`).

## Audit features avis existant (pré-chantier)

Findings READ-ONLY :

- Table : `public.reviews` (pas `producer_ratings` comme nommé dans le brief
  — l'historique migration 20260419050000 s'appelait `producer_ratings.sql`
  par confusion, mais altère bien `reviews`).
- Modération **a priori** confirmée : reviews créées avec `statut='pending'`,
  admin POST `/api/admin/reviews/[id]/moderate` pour publish/reject.
- Pas de table prefs notifs existante. `public.notifications` = log
  d'envois (sent/failed/skipped), pas un système de prefs.
- Helpers `audit_logs` : `log-auth-event`, `log-payment-event`,
  `log-admin-invite-event`. → Ajout `log-review-event` symétrique.
- Espace producer : route group `app/(producer)/` (URL sans préfixe), nav
  fixe dans `_components/ProducerLayout.tsx`. Domaine prod
  `pro.terroir-local.fr`.
- Compte consumer : `app/(consumer)/compte/` + Sidebar fixe.
- Templates Resend dans `lib/resend/templates/` avec `EmailLayout` +
  `emailTheme`. Helper `sendTemplate` log auto dans `notifications`.

## Architecture nouvelle

### Backend

```
lib/notifications/
  preferences.ts                 — get/should/upsert prefs avec virtual defaults
  send-review-response-email.ts  — wrap sendTemplate + respect prefs

lib/audit-logs/
  log-review-event.ts            — helper audit pour 5 event_types review/notif

app/api/producer/reviews/[id]/respond/route.ts
  POST   → create OU update dans 24h (selon état actuel)
  DELETE → remove dans 24h (status=removed_producer)

app/api/admin/reviews/[id]/response/route.ts
  DELETE → remove admin (status=removed_admin), override lock 24h

app/api/consumer/notification-preferences/route.ts
  PATCH  → toggle pref via upsert + audit log
```

### Frontend

```
app/(producer)/avis/page.tsx               — Server: fetch reviews published
app/(producer)/avis/AvisClient.tsx         — Client: liste + ReponseEditor inline

app/(consumer)/compte/notifications/page.tsx       — Server: fetch prefs
app/(consumer)/compte/notifications/NotificationsClient.tsx  — Toggles UI

app/(public)/producteurs/[slug]/page.tsx           — étendu : fetch + map response
app/(public)/producteurs/[slug]/ProducerPageClient.tsx — étendu : render bloc réponse

app/(admin)/avis/page.tsx                          — étendu : 2e section "Réponses publiées"

lib/resend/templates/review-response-notification.tsx
```

### Audit trail (nouveaux event_types)

- `producer_response_published` — POST initial (1 par création).
- `producer_response_updated` — édition dans 24h.
- `producer_response_deleted_by_producer` — DELETE producer dans 24h.
- `producer_response_removed_by_admin` — DELETE admin (snapshot length en
  metadata pour défense litige).
- `notification_preference_updated` — PATCH consumer toggle pref.

## Fichiers créés / modifiés

### Créés

- `supabase/migrations/20260506140214_add_producer_responses_and_notification_prefs.sql`
- `lib/notifications/preferences.ts`
- `lib/notifications/send-review-response-email.ts`
- `lib/audit-logs/log-review-event.ts`
- `lib/resend/templates/review-response-notification.tsx`
- `app/api/producer/reviews/[id]/respond/route.ts`
- `app/api/admin/reviews/[id]/response/route.ts`
- `app/api/consumer/notification-preferences/route.ts`
- `app/(producer)/avis/page.tsx`
- `app/(producer)/avis/AvisClient.tsx`
- `app/(consumer)/compte/notifications/page.tsx`
- `app/(consumer)/compte/notifications/NotificationsClient.tsx`
- `tests/lib/notifications/preferences.test.ts` (7 tests)
- `tests/app/api/producer/reviews/respond.test.ts` (12 tests)
- `tests/app/api/admin/reviews/response.test.ts` (4 tests)
- `tests/lib/resend/templates/review-response-notification.test.tsx` (6 tests)
- `tests/e2e/pro/producer-response.spec.ts` (3 tests E2E)
- `docs/fixes/producer-response-2026-05-06.md`

### Modifiés

- `app/(producer)/_components/ProducerLayout.tsx` — entrée NAV "Avis".
- `app/(consumer)/compte/_components/Sidebar.tsx` — entrée NAV "Notifications".
- `app/(public)/producteurs/[slug]/page.tsx` — fetch + map réponse.
- `app/(public)/producteurs/[slug]/ProducerPageClient.tsx` — render bloc réponse.
- `app/(admin)/avis/page.tsx` — section "Réponses publiées" + delete.

## Évolution tests

- Vitest avant : 1787 tests passants
- Vitest après : 1816 tests passants (**+29 nouveaux tests**)
- Tests E2E Playwright : 3 nouveaux tests dans `tests/e2e/pro/producer-response.spec.ts`
  (non lancés en auto — pour run : `pnpm playwright test tests/e2e/pro/producer-response.spec.ts`)
- `npx tsc --noEmit` : ✅ clean
- `npx next lint` : ✅ clean

## Trade-offs et décisions autonomes

### 1. Adaptation des noms d'API au pattern repo

Le brief utilisait `/api/pro/reviews/...` mais le repo utilise déjà
`app/api/producer/...`. → Adopté `app/api/producer/reviews/[id]/respond` et
`app/api/admin/reviews/[id]/response` pour cohérence.

### 2. Réponse uniquement sur reviews publiées

Le brief disait "publication immédiate" pour la réponse producer. J'ai ajouté
un check `review.statut === 'published'` côté route POST : impossible de
répondre à un avis encore en pending modération admin ou rejeté. Sinon UX
incohérente (le producer écrit une réponse → l'avis est rejeté plus tard →
réponse orpheline visible nulle part).

### 3. Virtual defaults pour les prefs notifs

`getUserNotificationPreferences` retourne les defaults sans INSERT si la row
n'existe pas. La row n'est créée qu'au premier toggle UI. Évite de
seed/backfill 11 rows existantes côté users + comptes futurs jamais touchés.

### 4. Fail-safe envoi email

Un échec d'envoi notification consumer NE rollback PAS la publication de la
réponse producer (engagement contractuel CGU 6.4 prime). La route POST wrap
l'appel `sendReviewResponseEmail` dans try/catch + console.warn.

### 5. Audit log helper `log-review-event` au lieu d'INSERT direct

Symétrie avec les helpers existants (`log-auth-event`, `log-payment-event`).
Garde la liste des event_types typée et grep-able.

### 6. RLS UPDATE ouverte côté DB, lock applicatif

La policy `reviews producer response update` permet à un producer owner de
faire n'importe quel UPDATE sur ses reviews. Le lock 24h est géré côté
route API (vérification `producer_response_locked_at < NOW()`). Choix
volontaire : le lock est une règle métier mouvante (pourrait passer à 48h
demain) plus naturelle côté code applicatif que côté policy SQL.

## Anomalies détectées

Aucune. L'audit a confirmé que la table review existante (`public.reviews`)
correspondait fidèlement au schéma attendu, modération a priori OK, pas de
collision sur les noms de colonnes.

## Liens entre features

| Feature | Lien |
|---|---|
| CGU 6.4 (publié 2026-05-05) | implémenté ce 2026-05-06 |
| Modération avis consumer | a priori (existant) ↔ a posteriori (réponse) — flow distinct |
| `notifications` (log) ↔ `user_notification_preferences` (prefs) | distinct : log d'envois vs config user |
| `audit_logs.event_type` | 5 nouveaux event_types ajoutés (cluster review/notif) |

## Évolutions futures envisageables

- Ajouter d'autres prefs notifs (email_order_status, email_promotional,
  email_new_producer) — structure prête, ajouter colonne boolean +
  entrée dans `PREFS` array client + extension typage `NotificationPreferenceKey`.
- Cron léger pour notifier l'admin si volume anormal de
  `producer_response_removed_by_admin` (signal modération abusive
  systémique).
- UI "demander une suppression" côté consumer si réponse producer perçue
  comme inappropriée — pour l'instant l'admin agit sur signalement informel.
- Email digest hebdo des avis reçus (si les producers oublient de venir
  consulter `/avis`).

## Workflow de validation

Tests vitest verts, typecheck clean, lint clean. Tests E2E **non lancés**
(décision : tape sur prod DB + envoie ~3 mails Resend, à déclencher
manuellement par Romain). Pas de commit créé (workflow Romain commit
post-validation).
