# /admin/audit-logs — finition T-080 + T-083 + T-084

> Date : 2026-05-06
> Branche : master
> Tickets : T-080 (UI complète), T-083 (anti-énumération email), T-084 (libellés humains)

---

## Contexte

La table `public.audit_logs` (créée par `supabase/migrations/20260427100000_create_audit_logs.sql`) accumule depuis avril 2026 des events sensibles (auth, paiements, refunds, invitations admin, réponses producteur, conformité légale, webhooks Resend / Stripe). En mai 2026, 13 `event_type` distincts en prod, 118 logs.

Une page admin `/audit-logs` (Phase 1) existait déjà avec :
- filtres par event_type pills, user_id (UUID), date range,
- pagination cursor-based (50/page, base64url),
- export CSV `/api/admin/audit-logs/export`.

**Gaps fermés ici** :
1. **T-084** — pills + colonne event affichaient les identifiants techniques bruts (`order_payment_succeeded`) au lieu de libellés humains (« Paiement réussi »).
2. **T-083** — pas de filtre email du tout, ce qui n'était pas un oracle énumération mais un manque ergonomique. L'ajout de ce filtre devait être fait sans réintroduire d'oracle.
3. La page n'incluait que les clusters AUTH + PAYMENT côté `ALL_EVENT_TYPES` — REVIEW (`producer_response_*`, `notification_*`) et LEGAL (`admin_legal_*`) étaient invisibles dans les pills (impossibles à filtrer).
4. Pas de stats agrégées en haut de page (4 metric cards demandés par le plan).

## Décisions

### T-083 — stratégie « variante b » server-side

L'admin tape l'email dans un input form. Côté serveur :

1. `consumeRateLimit(getAuditLogsEmailLookupRateLimit(), session.id)` — cap **30/min/admin** via Upstash. Si dépassé : on saute le lookup et utilise directement le sentinel.
2. `lookupUserIdByEmail(email)` — normalise (trim + lowercase) puis `from('users').select('id').eq('email', ...).maybeSingle()`.
3. **Trouvé** → renvoie `user_id` réel. **Inconnu / erreur** → renvoie `SENTINEL_NOT_FOUND_USER_ID = "00000000-0000-0000-0000-000000000000"`.
4. La query principale `audit_logs` filtre `WHERE user_id = <résolu>`. Sentinel = 0 résultats (gen_random_uuid ne le génère jamais), réponse uniforme côté UI.
5. Audit log meta `admin_audit_logs_email_lookup` posé à chaque lookup (succès ou rate-limited), avec `masked_email = "l***@gmail.com"`, `user_resolved: bool`, `rate_limited: bool`, `surface: "page" | "export"`.

**Pourquoi pas (a) — `users.email_hash` column** : exigerait migration DB + backfill + maintenance trigger sur INSERT/UPDATE. Pour V1 c'est sur-dimensionné — l'admin a déjà `/gestion-producteurs` comme oracle email-by-design, donc l'audit-logs n'est pas le seul angle d'attaque. La vraie défense est : (i) rate-limit, (ii) audit log meta de chaque lookup pour détection forensique d'admin abusif, (iii) réponse UI uniforme. Migration `email_hash` reste possible en V2 si T-083 remonte avec criticité plus élevée.

**Pourquoi pas client-side hash** : nice-to-have pour cacher l'email aux logs Vercel, mais ne change pas le modèle de menace côté admin. Le coût (5-10 lignes de JS client + lookup côté serveur via column hash) ne justifie pas le bénéfice marginal.

### T-084 — mapping séparé des helpers de log

Nouveau fichier `lib/audit-logs/labels.ts` avec `AUDIT_EVENT_LABELS: Record<string, string>` mappant chaque `event_type` connu à son libellé FR. `getEventLabel()` fallback sur l'event_type brut si pas de mapping (un nouvel event_type ne casse pas l'UI).

**Pourquoi pas inline dans chaque `log-*.ts`** : les helpers `lib/audit-logs/log-*.ts` sont importés par des server actions auth-sensitives — y câbler de la string UI alourdit le tree et complique les tests. Le mapping vit côté `lib/audit-logs/labels.ts` réutilisable par n'importe quelle UI future.

Test parité (`tests/lib/audit-logs/labels.test.ts`) qui itère sur `ALL_EVENT_TYPES` et garantit qu'aucun event_type connu n'a de libellé manquant. Si un développeur ajoute un nouveau cluster `log-*-event.ts` sans mapper le label, le test casse en CI.

### Catégorisation étendue

`categorizeEventType` était limité à 3 catégories (auth / order / stripe) avec un fallback `auth` qui aspirait incorrectement les events `admin_invite_*`, `admin_legal_*`, `producer_response_*`, `notification_*`, `email_complaint_*`, `email_hard_bounce_*`.

Refactor : 8 catégories désormais (auth, admin_invite, order, stripe, review, notification, legal, email). Préfixes spécifiques pour `email_complaint_` / `email_hard_bounce_` (et non `email_*` générique) pour éviter d'attraper `email_change` qui est un event auth.

### Stats — fetch DB direct

`lib/audit-logs/stats.ts` agrège 4 stats en 4 queries Supabase (3 count head:true + 1 fetch borné 50k pour le top type côté JS). Pas de RPC dédiée — le volume reste modéré (audit auth ~quelques centaines/jour mi-2026), une vraie GROUP BY DB n'est pas justifiée pour 4 metric cards. Calculs en jour calendaire Europe/Paris (cohérent avec le reste de l'app).

## Fichiers touchés

### Helpers `lib/audit-logs/`

- **`labels.ts`** (nouveau) — map FR + `getEventLabel()`.
- **`stats.ts`** (nouveau) — `getAuditLogStats()`.
- **`email-lookup.ts`** (nouveau) — `lookupUserIdByEmail()`, `normalizeEmail()`, `maskEmail()`, `SENTINEL_NOT_FOUND_USER_ID`.
- **`log-legal-event.ts`** — ajout `admin_audit_logs_email_lookup` à `LEGAL_COMPLIANCE_EVENT_TYPES`.

### Rate-limit

- **`lib/rate-limit.ts`** — `getAuditLogsEmailLookupRateLimit()` (30/60s, prefix `audit_logs_email_lookup`, key=session.id).

### Page admin

- **`app/(admin)/audit-logs/page.tsx`** — 4 stats cards + lookup email avec rate-limit + audit log meta + propagation filter email dans pagination.
- **`app/(admin)/audit-logs/_components/AuditLogsFilters.tsx`** — input email ajouté (1ʳᵉ position dans la grille de filtres), banner amber quand rate-limited, pills affichent le libellé FR (event_type technique reste en `title` HTML).
- **`app/(admin)/audit-logs/_components/AuditLogsTable.tsx`** — colonne event affiche libellé FR + event_type technique en monospace gris dessous.
- **`app/(admin)/audit-logs/_lib/event-types.ts`** — étendu pour inclure REVIEW + LEGAL clusters (4 helpers consolidés).
- **`app/(admin)/audit-logs/_lib/categorize-event-type.ts`** — 8 catégories.
- **`app/(admin)/audit-logs/_lib/parse-search-params.ts`** — accept `email` (max 320 chars, trimmé).

### Routes API

- **`app/api/admin/audit-logs/stats/route.ts`** (nouveau) — JSON endpoint pilotage dashboard, auth admin, no cache.
- **`app/api/admin/audit-logs/export/route.ts`** — symétrique page : lookup email avec rate-limit + audit log meta `surface: "export"`.

### Tests (vitest)

- `tests/lib/audit-logs/labels.test.ts` — parité ALL_EVENT_TYPES + `getEventLabel`.
- `tests/lib/audit-logs/email-lookup.test.ts` — `normalizeEmail`, `maskEmail`, `lookupUserIdByEmail` (4 cas dont user inconnu = sentinel).
- `tests/lib/audit-logs/stats.test.ts` — agrégation today/last7/failed7/topType.
- `tests/app/api/admin/audit-logs/stats.test.ts` — handler GET (auth, payload, error 500).
- `tests/app/(admin)/audit-logs/_lib/categorize-event-type.test.ts` — étendu pour les 8 catégories.
- `tests/app/(admin)/audit-logs/_lib/parse-search-params.test.ts` — étendu pour `email`.

## Vérifications

- `npx tsc --noEmit` → exit 0.
- `npx vitest run` → 1911 tests passés (vs 1868 baseline).

## Évolutions possibles

- **V2 — `users.email_hash`** : si on veut ne JAMAIS avoir l'email en clair côté request body de la page admin, on ajouterait une migration `users.email_hash text NOT NULL DEFAULT encode(sha256(lower(trim(email))::bytea), 'hex')` + trigger sur UPDATE/INSERT, et le client ferait le hash avant submit. Pas justifié tant que l'admin a déjà `/gestion-producteurs` comme oracle.
- **V2 — RPC `get_audit_log_stats()`** : si le volume audit_logs dépasse 100k/jour, remplacer le top-type fetch JS par une vraie GROUP BY côté Postgres (RPC dédiée ou vue matérialisée rafraîchie périodiquement).
- **V2 — drill-down `/admin/audit-logs/[id]`** : page detail dédiée par event. Aujourd'hui les metadata sont dépliables inline dans le `<details>` — suffisant pour le volume actuel.
