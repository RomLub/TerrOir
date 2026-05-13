# AUDIT ADMIN — TerrOir

Date : 2026-05-13
Périmètre : sous-domaine `admin.terroir-local.fr` (route group `(admin)`,
API routes `/api/admin/*`, RLS publiques touchant le rôle admin, table
`audit_logs`).

Mode : lecture seule. Aucune correction n'a été appliquée. Tout point
identifié comme bug ou incohérence est noté en l'état et reste à
traiter dans un chantier dédié.

---

## 1. Inventaire des routes admin

### 1.1 Pages (Server Components et Client Components)

Le layout `app/(admin)/layout.tsx:24-33` impose deux gardes
defense-in-depth :
1. `getSessionUser()` puis `redirect('/connexion')` si `!session.isAdmin`.
2. En production uniquement, redirige vers `https://admin.terroir-local.fr/`
   si le host ne commence pas par `admin.`.

Le middleware est la 1re barrière, le layout couvre les régressions
matcher / header injection. Toutes les pages ci-dessous héritent de ce
check.

| Route                              | Fichier                                                                | Type | Rôle requis                | Données affichées                                                                              | Données mutées                                                              | Composants partagés                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------- | ---- | -------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `/tableau-de-bord`                 | `app/(admin)/tableau-de-bord/page.tsx`                                 | SSR  | admin (layout)             | **Aucune** — page vide, juste un `<h1>` (8 lignes total)                                       | —                                                                           | —                                                                                                                                    |
| `/gestion-producteurs`             | `app/(admin)/gestion-producteurs/page.tsx`                             | CSR  | admin (layout)             | `producers` (jointure `users.email`), pagination cursor 100, filtres statut + brouillons       | UPDATE `producers.statut` direct browser-client                             | `AdminPageHeader`, `FilterTabs`, `Button`, `AdminModal`, `ProducerStatusBadge`, `TableActionButton`, `TableStatus`, `ListingHeader`  |
| `/producer-interests`              | `app/(admin)/producer-interests/page.tsx`                              | CSR  | admin (layout)             | `producer_interests` (8 rows aujourd'hui) — leads avec source, espèces, message                | UPDATE `producer_interests.statut` ; DELETE via modal                       | `AdminPageHeader`, `FilterTabs`, `StatusPanel`, `LeadsTable`, `DeleteLeadModal`, `LeadStatusBadge`, `LeadSourceBadge`                |
| `/suivi-commandes`                 | `app/(admin)/suivi-commandes/page.tsx` + `SuiviCommandesClient.tsx`    | SSR  | admin (layout)             | 200 dernières `orders` (jointures consumer, producer, slots) + 3 KPI (jour, semaine, complét.) | Aucune — read-only + export CSV client-side                                 | `AdminPageHeader`, `MetricCard`, `StatusDotBadge`, `TableStatus`                                                                     |
| `/refunds/pending`                 | `app/(admin)/refunds/pending/page.tsx` + `PendingRefundsClient.tsx`    | SSR  | admin (layout)             | `pending_refunds` ≤200 (jointures order_code, producer name)                                   | Server actions `approvePendingRefund` / `denyPendingRefund` → exécute Stripe | Aucun composant partagé (styles inline locaux) ; utilise `_actions/decide.tsx`                                                       |
| `/audit-logs`                      | `app/(admin)/audit-logs/page.tsx`                                      | SSR  | admin (layout) + RLS       | `audit_logs` paginé cursor 50, 4 KPI cards, lookup email anti-énumération T-083                | Aucune — lecture pure                                                       | `AdminPageHeader`, `MetricCard`, `AuditLogsFilters`, `AuditLogsTable`                                                                |
| `/audit-logs/stats`                | `app/(admin)/audit-logs/stats/page.tsx`                                | SSR  | admin (layout)             | Stats conversion invitation→onboarding (30j) via service_role                                  | Aucune                                                                      | `AdminPageHeader`, `MetricCard`                                                                                                      |
| `/avis`                            | `app/(admin)/avis/page.tsx`                                            | CSR  | admin (layout) + RLS       | `reviews` pending + reviews publiées avec `producer_response_status='published'`               | POST `/api/admin/reviews/[id]/moderate` ; DELETE `.../response`             | `AdminPageHeader`, `MetricCard`, `StarRating`, `StatusPanel`, `TableActionButton`                                                    |
| `/legal-compliance`                | `app/(admin)/legal-compliance/page.tsx`                                | SSR  | admin (layout) + svc_role  | `users` + statut CGU (service_role bypass), stats globales, filtres status + search            | Aucune (page) — export CSV via `/api/admin/legal-compliance/export`         | `AdminPageHeader`, `MetricCard`, `Filters`, `UsersTable`, `Pagination`, `StatusBadge`                                                |
| `/gms-prices`                      | `app/(admin)/gms-prices/page.tsx`                                      | CSR  | admin (layout) + RLS       | `gms_prices` (10 rows) filtrable filière + archive toggle                                      | POST/PUT/POST archive/POST update-prices via API routes                     | `AdminPageHeader`, `Button`, `FilterTabs`, `StatusDotBadge`, `TableActionButton`, `TableStatus` + 3 modals (Create/Edit/Monthly)     |
| `/categorisation/categories`       | `app/(admin)/categorisation/categories/page.tsx`                       | CSR  | admin (layout) + RLS       | `product_categories` (7 rows) + comptage produits liés                                         | POST/PATCH/DELETE via `/api/admin/categories/*`                             | `AdminPageHeader`, `Button`, `TableActionButton`, `TableStatus`, `SimpleEntityFormModal`                                             |
| `/categorisation/animaux`          | `app/(admin)/categorisation/animaux/page.tsx`                          | CSR  | admin (layout) + RLS       | `animals` (6 rows) + comptage produits + cuts liés                                             | POST/PATCH/DELETE via `/api/admin/animals/*`                                | `AdminPageHeader`, `Button`, `TableActionButton`, `TableStatus`, `SimpleEntityFormModal`                                             |
| `/categorisation/morceaux`         | `app/(admin)/categorisation/morceaux/page.tsx`                         | CSR  | admin (layout) + RLS       | `cuts` (30 rows) + comptage produits, filtre `?animal=<slug>`                                  | POST/PATCH/DELETE via `/api/admin/cuts/*`                                   | `AdminPageHeader`, `Button`, `TableActionButton`, `TableStatus`, `CutFormModal`                                                      |

Note `SSR/CSR` :
- `SSR` = server component dynamique (`export const dynamic =
  'force-dynamic'`), fetch via `createSupabaseAdminClient()` ou
  `createSupabaseServerClient()` selon que RLS admin existe ou non.
- `CSR` = `'use client'` complet, fetch via
  `createSupabaseBrowserClient()` qui s'appuie sur la session admin +
  RLS pour autoriser les lectures/écritures.

### 1.2 API routes admin (`/api/admin/*`)

Toutes les routes ci-dessous gardent l'auth avec
`getSessionUser()` + `session.isAdmin` côté handler (jamais juste sur
la session, jamais sans check explicite).

| Route                                                       | Méthodes      | Tables touchées + opérations                                                                 | Audit log | Side-effects                                                                |
| ----------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------- |
| `/api/admin/animals`                                        | GET / POST    | `animals` SELECT, INSERT                                                                     | OUI       | —                                                                           |
| `/api/admin/animals/[id]`                                   | GET / PATCH / DELETE | `animals` SELECT / UPDATE / DELETE + count dependencies                               | OUI       | 409 si dépendances                                                          |
| `/api/admin/categories`                                     | GET / POST    | `product_categories` SELECT, INSERT                                                          | OUI       | —                                                                           |
| `/api/admin/categories/[id]`                                | GET / PATCH / DELETE | `product_categories` + count dependencies                                             | OUI       | 409 si dépendances                                                          |
| `/api/admin/cuts`                                           | GET / POST    | `cuts` SELECT (`?animal_id=`), INSERT                                                        | OUI       | —                                                                           |
| `/api/admin/cuts/[id]`                                      | GET / PATCH / DELETE | `cuts` + count dependencies                                                           | OUI       | 409 si dépendances                                                          |
| `/api/admin/audit-logs/export`                              | GET           | `audit_logs` SELECT ≤10001 + `producers` (badge), lookup email rate-limit                    | OUI (`admin_audit_logs_email_lookup`) | CSV export + header `X-Audit-Logs-Truncated`                |
| `/api/admin/audit-logs/stats`                               | GET           | `audit_logs` count agrégés                                                                   | —         | Cache-Control private max-age 60                                            |
| `/api/admin/gms-prices`                                     | POST          | `gms_prices` INSERT                                                                          | implicite (helper) | —                                                                |
| `/api/admin/gms-prices/[id]`                                | PUT           | `gms_prices` SELECT + UPDATE (métadonnées)                                                   | implicite (helper) | —                                                                |
| `/api/admin/gms-prices/[id]/archive`                        | POST          | `gms_prices` SELECT + UPDATE `active`                                                        | implicite (helper) | —                                                                |
| `/api/admin/gms-prices/[id]/update-prices`                  | POST          | `gms_prices` UPDATE + `gms_prices_history` INSERT                                            | implicite (helper) | Atomicité via helper                                              |
| `/api/admin/legal-compliance/export`                        | GET           | `users` SELECT ≤10000 via service_role                                                       | OUI (`admin_legal_compliance_exported`) | CSV export                                                  |
| `/api/admin/legal-compliance/stats`                         | GET           | `users` count agrégés via service_role                                                       | —         | —                                                                           |
| `/api/admin/legal-compliance/users`                         | GET           | `users` SELECT paginé via service_role                                                       | —         | —                                                                           |
| `/api/admin/producers/invite`                               | POST          | `admin_users`, `users`, `producers`, `producer_invitations`, `producer_interests` (5 tables) | OUI × N   | Resend email, opt-out token, rate-limit 10/min/admin                        |
| `/api/admin/reviews/[id]/moderate`                          | POST          | `reviews` UPDATE + `producers` UPDATE (note moyenne)                                         | —         | `revalidatePath` producer card + reviews                                    |
| `/api/admin/reviews/[id]/response`                          | DELETE        | `reviews` UPDATE `producer_response=null` (soft delete)                                      | OUI       | `revalidatePath` producer card                                              |

### 1.3 Server actions

- `app/(admin)/refunds/pending/_actions/decide.tsx` exporte
  `approvePendingRefund(formData)` et `denyPendingRefund(formData)`.
  Pattern atomic guard `.eq('status', 'pending')` race-safe, exécution
  du refund Stripe via `executeRefundFlow`, audit log
  `producer_refund_admin_approved` / `_denied`, notification email
  producer via Resend.

---

## 2. Composants admin

### 2.1 Composants partagés (`components/ui/*`)

Convention : il n'existe pas de dossier `components/admin/`. Tous les
composants spécifiques admin sont colocalisés dans
`app/(admin)/**/_components/`. La couche partagée se trouve dans
`components/ui/`.

| Composant                | Fichier                                  | Utilisé par (admin)                                                                                 |
| ------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `AdminPageHeader`        | `components/ui/admin-page-header.tsx`    | Toutes les pages admin sauf `/tableau-de-bord`, `/refunds/pending`, `/error.tsx`                    |
| `AdminModal`             | `components/ui/admin-modal.tsx`          | `gestion-producteurs` (InviteModal + ConfirmValidateModal), `producer-interests/DeleteLeadModal`    |
| `FilterTabs`             | `components/ui/filter-tabs.tsx`          | `gestion-producteurs`, `producer-interests`, `gms-prices`                                           |
| `MetricCard`             | `components/ui/metric-card.tsx`          | `suivi-commandes` (3 cards), `audit-logs` (4 cards), `audit-logs/stats` (3 cards), `legal-compliance` (4 cards), `avis` (1 small) |
| `StatusPanel`            | `components/ui/status-panel.tsx`         | `producer-interests`, `avis`, `LeadsTable`                                                          |
| `TableActionButton`      | `components/ui/table-action-button.tsx`  | `gestion-producteurs`, `gms-prices`, `categorisation/*`, `avis`, `LeadsTable`                       |
| `TableStatus`            | `components/ui/table-status.tsx`         | `gestion-producteurs`, `gms-prices`, `categorisation/*`, `suivi-commandes`                          |
| `StatusDotBadge`         | `components/ui/status-dot-badge.tsx`     | `suivi-commandes`, `gms-prices`, `AuditLogsTable`                                                   |
| `ProducerStatusBadge`    | `components/ui/producer-status-badge.tsx`| `gestion-producteurs`                                                                               |
| `Button`                 | `components/ui/button.tsx`               | `gestion-producteurs`, `gms-prices`, `categorisation/*`                                             |
| `StarRating`             | `components/ui/star-rating.tsx`          | `avis`                                                                                              |
| `Logo`                   | `components/ui/logo.tsx`                 | `AdminHeader`                                                                                       |
| `ListingHeader`          | `components/listings/ListingHeader.tsx`  | `gestion-producteurs` (banner displayed/total + pagination state)                                   |

### 2.2 Composants admin-only colocalisés (`app/(admin)/**/_components/`)

- `_components/AdminHeader.tsx`, `_components/AdminSidebar.tsx`
  — chrome du layout admin. Sidebar contient en dur 13 entrées navigation
  groupées « Catégorisation produits ». Badge dynamique
  `pendingRefundsCount` fetché côté layout (count head-only sur
  `pending_refunds.status='pending'`, fail-open).
- `audit-logs/_components/AuditLogsFilters.tsx`,
  `AuditLogsTable.tsx` — filtres event_type/user/email/date,
  rendu d'event avec catégorisation (`_lib/categorize-event-type.ts`),
  labels humains (`lib/audit-logs/labels.ts`), badge "Prod" si
  user_id ∈ `producers`.
- `audit-logs/_lib/*.ts` — `cursor.ts`, `event-types.ts`,
  `parse-search-params.ts`, `build-producer-href.ts`,
  `categorize-event-type.ts`. Layer admin-only.
- `categorisation/_components/CutFormModal.tsx`,
  `SimpleEntityFormModal.tsx` — modals create/edit factorisés ;
  `SimpleEntityFormModal` sert categories + animals
  (entités sans scoping), `CutFormModal` ajoute le picker `animal_id`.
- `categorisation/_lib/format-deps.ts` — formatage messages 409
  delete_blocked.
- `gms-prices/_components/CreateGmsPriceModal*.tsx`,
  `EditGmsPriceModal*.tsx`, `MonthlyUpdateModal*.tsx` — modals
  CRUD + workflow mensuel. Chaque modal a un wrapper `*Lazy`
  (dynamic import).
- `legal-compliance/_components/Filters.tsx`, `Pagination.tsx`,
  `StatusBadge.tsx`, `UsersTable.tsx` — composants spécifiques à la
  page conformité CGU. `Pagination` n'est pas réutilisé ailleurs.
- `producer-interests/_components/DeleteLeadModal.tsx`,
  `LeadSourceBadge.tsx`, `LeadStatusBadge.tsx`, `LeadsTable.tsx`,
  `types.ts` — composants leads.
- `refunds/pending/_components/PendingRefundsClient.tsx` — UI sub-
  client qui appelle les server actions `decide.tsx`.
- `suivi-commandes/SuiviCommandesClient.tsx` — sub-client filtres +
  search + export CSV.

---

## 3. Données accessibles côté DB mais non exposées dans l'UI admin

Inventaire des 33 tables `public.*` (issu de
`mcp__supabase__list_tables`) croisé avec ce qui est câblé en UI admin.

### 3.1 Tables CÂBLÉES en UI admin

`producers` (10 rows), `producer_interests` (8), `producer_invitations`
(22, partiel — envoi seulement), `orders` (20), `pending_refunds` (0),
`audit_logs` (298), `reviews` (0), `users` (11, partiel via
legal-compliance), `gms_prices` (10), `product_categories` (7),
`animals` (6), `cuts` (30). `admin_users` (1) est consultée par
le layout indirectement (`is_admin()` lookup).

### 3.2 Tables EN BASE MAIS NON EXPOSÉES — gaps fonctionnels

| Table                          | Volume       | Métier                                            | Capacité théorique admin                            | UI admin actuelle |
| ------------------------------ | ------------ | ------------------------------------------------- | --------------------------------------------------- | ----------------- |
| `products`                     | 16 rows      | Catalogue produits (par producer)                 | Voir, modérer, désactiver, supprimer, voir stock    | **AUCUNE**        |
| `slots`                        | 999 rows     | Créneaux retrait matérialisés                     | Voir disponibilité, débugger un slot en erreur      | **AUCUNE**        |
| `slot_rules`                   | 7 rows       | Règles génératrices de slots (policy admin ALL)   | CRUD admin sur règles                               | **AUCUNE**        |
| `order_items`                  | 20 rows      | Lignes de commande                                | Visible indirectement via `/suivi-commandes` (non détaillé)  | détaillé non câblé |
| `payouts`                      | 0 rows       | Versements Stripe Connect aux producteurs         | Suivre payouts, debug producer non payé             | **AUCUNE**        |
| `notifications`                | 111 rows     | Log envois email/SMS (delivery, opens)            | Tableau délivrabilité, debug "le mail n'est pas parti" | **AUCUNE**     |
| `producer_invitations`         | 22 rows      | Invitations sortantes (créées par /admin/producers/invite). **Pas de colonne `status`** — statut computed via `used_at` (consommée) + `expires_at < now()` (expirée). | Voir liste invitations envoyées, expirées, revoke explicit | partiel : émission seule, pas de listing                |
| `disputes`                     | 0 rows       | Chargebacks Stripe (`charge.dispute.*`)           | Voir litige carte bancaire en cours, gérer evidence  | **AUCUNE**       |
| `refund_incidents`             | 0 rows       | Refunds Stripe échoués (T-102)                    | Voir refunds bloqués, déclencher retry, marquer manuellement résolu | **AUCUNE** |
| `refund_incident_attempts`     | 0 rows       | Historique tentatives refund                      | Drill-down par incident                             | **AUCUNE**        |
| `product_stock_alerts`         | 0 rows       | Inscriptions « me prévenir si stock revient »     | Voir le volume / par produit                        | **AUCUNE**        |
| `email_suppressions`           | 1 row        | Bounces / complaints Resend (opt-out forcé)       | Voir qui est exclu des envois, debug deliverability | **AUCUNE**        |
| `deleted_users`                | 4 rows       | Tombstones RGPD post-suppression                  | Audit forensique post-suppression                   | **AUCUNE**        |
| `user_notification_preferences`| 0 rows       | Préférences notif par user                        | Inspecter (rare), pas forcément utile               | **AUCUNE**        |
| `gms_prices_history`           | 0 rows       | Historique MAJ mensuelles gms_prices              | Voir l'historique de mise à jour mensuelle d'une référence | **AUCUNE** (écrit seulement) |
| `users`                        | 11 rows      | Comptes utilisateurs (tous rôles)                 | Vue admin globale users (rechercher, voir détails)  | partiel — `/legal-compliance` focalisé CGU uniquement |
| `geocode_cache`                | 0 rows       | Cache CP→coords (infra)                           | Pas d'intérêt UI                                    | volontairement non câblée  |
| `webhook_events_processed`     | 48 rows      | Dédup webhooks Stripe (infra)                     | Debug webhooks, voir replays                        | volontairement non câblée  |
| `email_change_otp_codes`       | 0 rows       | OTP changement email (infra)                      | Pas d'intérêt UI                                    | volontairement non câblée  |
| `email_change_undo_tokens`     | 0 rows       | Undo changement email (infra)                     | Pas d'intérêt UI                                    | volontairement non câblée  |
| `role_snapshot_revocations`    | 0 rows       | Invalidation snapshots HMAC (F-026, infra)        | Voir révocations actives                            | volontairement non câblée  |
| `test_emails_captured`         | 8 rows       | E2E mailbox capture                               | Pas d'intérêt prod                                  | volontairement non câblée  |

### 3.3 Gaps non visibles dans les tables — RPC / vues

- `search_producers(...)` SECDEF — exposé côté consumer
  (`/producteurs`), pas dans l'admin.
- `update_producer_onboarding(...)` SECDEF — exposé côté producer
  onboarding, pas dans l'admin (admin ne peut pas remplir le profil
  d'un producteur à sa place).
- `generate_order_code()` SECDEF — interne, pas concerné.
- `record_refund_attempt(...)` SECDEF — interne refunds, exploité par
  cron mais pas exposé admin.
- `restore_stock_on_order_cancel(...)` / `revive_order_with_stock_check(...)`
  SECDEF — internes orders, pas exposés admin.
- `get_producer_dashboard(...)` SECDEF (F-045, P0 sweep) — exposé
  côté producer, pas l'admin (l'admin n'a pas de dashboard équivalent).

---

## 4. RLS et permissions admin

### 4.1 Helper canonique : `public.is_admin()`

Défini en `20260421100000_cumulative_roles_admin_users.sql:126-137` :

```sql
create or replace function public.is_admin()
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.admin_users where id = auth.uid());
$$;
```

- Lookup dans `public.admin_users` (table isolée, séparée de
  `public.users`). Un admin n'existe PAS dans `public.users` par
  invariant — exclusion mutuelle.
- ACL : `REVOKE PUBLIC`, `GRANT EXECUTE TO anon, authenticated,
  service_role`
  (`20260505100000_audit_rls_lot_1_2_harden_security_definer_acls.sql`).
  Le grant `anon` est nécessaire pour les policies RLS scopées
  `to public` (products/slots public read) ; la fonction retourne
  `false` si `auth.uid()` est NULL.

### 4.2 Helpers RLS complémentaires (lib SQL)

- `is_producer_public(uuid)` (`20260505100100`) — remplace EXISTS inline
  pour products/slots/slot_rules public read.
- `can_access_order(uuid)` × 2 signatures — accès orders pour
  consumer/producer parties, plus version completed-only.
- `owns_producer(uuid)` — owner check pour policies producteur.

### 4.3 Policies RLS ciblant explicitement l'admin

| Table                       | Policy                                       | Op       | Condition                  | Migration                                    |
| --------------------------- | -------------------------------------------- | -------- | -------------------------- | -------------------------------------------- |
| `admin_users`               | admin_users self read                        | SELECT   | `id = auth.uid()`          | `20260421100000:64-67`                       |
| `producers`                 | producers admin all                          | ALL      | `is_admin()`               | `20260505100400:98-101`                      |
| `producer_invitations`      | invitations admin all                        | ALL      | `is_admin()`               | `20260505100400:209-212`                     |
| `slot_rules`                | slot_rules admin all                         | ALL      | `is_admin()`               | `20260505100400:125-128`                     |
| `producer_interests`        | producer_interests admin read/update/delete  | SELECT, UPDATE, DELETE | `is_admin()`     | `20260505100100:264-271`                     |
| `audit_logs`                | audit_logs admin read                        | SELECT   | `(select is_admin())`      | `20260505100100:280-283`                     |
| `disputes`                  | disputes admin read                          | SELECT   | `is_admin()`               | `20260505100100:285-289`                     |
| `refund_incidents`          | refund_incidents admin read                  | SELECT   | `is_admin()`               | `20260505100100:291-295`                     |
| `refund_incident_attempts`  | refund_incident_attempts admin read          | SELECT   | `is_admin()`               | `20260505100100:297-301`                     |
| `pending_refunds`           | pending_refunds admin all                    | ALL      | `is_admin()`               | `20260511004000:98-103`                      |

### 4.4 Tables SANS policy admin — dépendance `service_role` bypass

Pour les opérations sur ces tables, l'admin DOIT passer par le
service_role (via `createSupabaseAdminClient()`). Aucune policy
explicite ne lui donne d'accès via le client navigateur. C'est
par design pour la plupart mais à connaître :

| Table          | Politique non-admin                                   | Conséquence côté admin                                    |
| -------------- | ----------------------------------------------------- | --------------------------------------------------------- |
| `users`        | self read/update only                                  | Toute lecture admin **doit** passer service_role          |
| `orders`       | parties read/insert/update                             | `/suivi-commandes` utilise bien `createSupabaseAdminClient()` ✅ |
| `order_items`  | via `can_access_order(uuid)`                           | Idem orders                                               |
| `products`     | public read when active / owner all                    | Pas de manipulation admin via RLS — pas de page admin produits anyway |
| `slots`        | public read / owner all                                | Pas de manipulation admin via RLS                         |
| `payouts`      | producer read only                                     | Pas d'accès admin RLS — pas de vue admin payouts          |
| `reviews`      | public read when published / author read+insert+update | **Voir 4.5 incohérence** |
| `notifications`| owner read                                             | Pas d'accès admin RLS — pas de vue admin                  |

### 4.5 Incohérences relevées

**Incohérence forte — `app/(admin)/avis/page.tsx`** :
La page utilise `createSupabaseBrowserClient()` (donc passe par les
policies RLS, pas service_role) et tente
`.from('reviews').select(...).eq('statut', 'pending')` puis
`.eq('statut', 'published').eq('producer_response_status', 'published')`.
La table `reviews` n'a aucune policy admin (cf. 4.4). Les seules
policies SELECT sont :
- public read quand `statut = 'published'`
- author read quand `consumer_id = auth.uid()`

Conséquence : la query reviews `pending` ne devrait remonter aucune
ligne pour l'admin tant qu'il n'a pas posté lui-même un avis. La table
contient 0 rows aujourd'hui (donc invisible) mais dès qu'un consumer
laissera un avis pending, l'admin **ne pourra pas le voir** via cette
page. La query `published + producer_response_status = 'published'`
passe (RLS public read couvre statut='published'), donc la modération a
posteriori des réponses producer fonctionnera, mais la modération
initiale des reviews pending est cassée par construction RLS.

Reproduction quand un avis arrivera : la liste `Avis à modérer` restera
vide en permanence côté admin alors que la DB contient des rows.

Causes possibles : soit il manque une policy `reviews admin read` (ALL
ou SELECT), soit la page devrait fetcher via une API route service_role
(comme `/legal-compliance`). Le pattern utilisé dans `/avis` pour
écrire passe d'ailleurs par `/api/admin/reviews/[id]/moderate` qui
utilise service_role — cohérent. Seule la lecture est incohérente.

**Incohérence faible — patterns READ admin** :
Trois modes coexistent pour les lectures admin et le choix est dicté
par la présence ou non d'une policy admin RLS, pas par un principe
clair :
- READ direct browser client + RLS admin : `gestion-producteurs`
  (producers), `gms-prices` (gms_prices RLS public_read), `producer-
  interests` (producer_interests admin read), `categorisation/*` (RLS
  public read).
- READ server component + service_role bypass : `suivi-commandes`
  (orders), `refunds/pending` (pending_refunds — pourtant policy admin
  all existe, le service_role est utilisé quand même), `legal-
  compliance` (users), `audit-logs/stats`.
- READ server component + RLS admin authentifié :
  `/audit-logs` (utilise `createSupabaseServerClient()` + policy
  audit_logs admin read).

Tant qu'un mode unique n'est pas défini, des régressions futures du
type 4.5 (page qui s'attend à voir des données qu'aucune policy ne lui
laisse voir) restent possibles.

---

## 5. État de `audit_logs`

### 5.1 Schéma

Source : `supabase/migrations/20260427100000_create_audit_logs.sql`,
augmenté par les policies de `20260505100100`.

Colonnes :
- `id uuid PK default gen_random_uuid()`
- `user_id uuid → auth.users(id) ON DELETE SET NULL, nullable`
- `event_type text NOT NULL` (pas d'enum, extensible)
- `metadata jsonb NOT NULL default '{}'`
- `ip_address inet, nullable` (IP masquée /24 IPv4, /64 IPv6 — doctrine T-200 r1)
- `user_agent text, nullable` (en clair)
- `created_at timestamptz NOT NULL default now()`

Indexes :
- `idx_audit_logs_user_id (user_id)`
- `idx_audit_logs_event_type (event_type)`
- `idx_audit_logs_created_at (created_at DESC)`

RLS :
- `audit_logs admin read` (SELECT, `is_admin()`).
- Aucune policy INSERT/UPDATE/DELETE. La table est append-only de
  fait : seul `service_role` (qui bypass RLS) peut écrire.

Volume prod actuel : 298 rows.

### 5.2 Triggers et écritures

Aucun trigger DB n'écrit dans `audit_logs` (grep `INSERT INTO audit_logs`
sur `supabase/migrations/` : 0 hit). Toutes les écritures passent par
les helpers applicatifs sous `lib/audit-logs/`, qui utilisent
`createSupabaseAdminClient()` (service_role).

Helpers déclarés (~95 event_types au total) :

| Helper                                        | Périmètre                                                              | Nb event_types |
| --------------------------------------------- | ---------------------------------------------------------------------- | -------------- |
| `log-auth-event.ts`                           | auth (login, signup, OTP, invitation, RGPD), magic-link, race-cond.   | 39             |
| `log-payment-event.ts`                        | orders create/confirm/cancel/payment/refund, Stripe webhooks          | 42             |
| `log-legal-event.ts`                          | export legal-compliance + lookup email audit-logs                      | 2              |
| `log-review-event.ts`                         | réponses producer + notif consumer                                     | 5              |
| `log-review-followup-event.ts`                | cron J+2/J+7                                                           | 4              |
| `log-pickup-event.ts`                         | validation pickup code TRR-XXXXX                                       | 5              |
| `log-producer-indicateurs-event.ts`           | rectification score carbone T-232                                      | 1              |
| `log-categorisation-event.ts`                 | admin CRUD catégories/animaux/morceaux                                 | 8              |
| `log-admin-invite-event.ts` (wrapper TS)      | union discriminée `admin_invite_*` → délègue à `logAuthEvent`          | (sous-ensemble)|

Tous les helpers swallow les erreurs (console.warn, pas de re-throw) —
fail-safe : aucun échec d'audit ne casse un flow principal.

**Écriture orpheline (à signaler)** :
`app/api/contact/route.tsx:208` écrit directement
`admin.from('audit_logs').insert({ event_type: 'contact_form_submitted', ... })`
sans passer par un helper. L'event_type n'est déclaré dans aucun
array `*_EVENT_TYPES` et n'a pas de label dans
`lib/audit-logs/labels.ts`. Conséquence : la page `/audit-logs`
l'affiche en label brut (technique), et il échappe à toute
catégorisation. Pas d'incidence forensique, déviation du pattern.

### 5.3 Lecture admin

Deux call sites uniquement :
- `app/(admin)/audit-logs/page.tsx` — pagination cursor 50,
  filtres event_type[], user_id, email (lookup rate-limité T-083),
  dates calendrier Paris ; 4 KPI cards via `getAuditLogStats()`.
- `app/api/admin/audit-logs/export/route.ts` — export CSV, cap
  10000 rows, header `X-Audit-Logs-Truncated`.

Aucun autre fichier ne SELECT `audit_logs` côté admin (vérifié par
grep).

### 5.4 Stats helpers

- `lib/audit-logs/stats.ts` (`getAuditLogStats`) : 4 KPIs
  (`todayCount`, `last7daysCount`, `topEventType7d`, `failed7dCount`).
  Lecture service_role bypass, agrégation in-memory JS, fenêtre 50k
  rows max. Pas de cache (temps réel).
- `lib/audit-logs/invitation-conversion-stats.ts`
  (`getInvitationConversionStats`) : funnel `admin_invite_sent` →
  `invitation_consumed_success` sur 30 jours glissants. Cohorte
  approximative (pas de jointure sur l'ID d'invitation).

### 5.5 Verdict

Utilité observée :
- **Debug forensique** : couvert (auth failures, OTP brute-force,
  Stripe disputes, refund failures, race conditions).
- **Reporting business** : partiellement couvert — funnel invitation
  + 4 KPI cards uniquement.
- **Legal/compliance** : couvert — RGPD art. 32, PCI DSS 10.x,
  `user_id ON DELETE SET NULL` préserve l'historique anonymisé après
  suppression compte.

Event_types pré-déclarés mais jamais émis :
- `invitation_revoked` dans `log-auth-event.ts:63` — commentaire
  explicit "Pas de call site actuel". Acceptable (slot réservé).

Rétention :
- **ABSENTE**. La table croît indéfiniment. Migration
  `20260511002000` documente une intention « 10 ans comptable » mais
  aucune politique n'est appliquée (pas de cron, pas de TTL Postgres).
  Pas critique court terme (298 rows / 6 mois ≈ 600/an).

Verdict global : **utilisable en l'état**, à compléter par :
- Une policy de rétention.
- Le câblage de `contact_form_submitted` via un helper standard
  (catégorie + label).
- Si /tableau-de-bord récupère des KPI un jour, les helpers
  existants couvrent déjà l'essentiel.

---

## 6. Gaps fonctionnels

Liste priorisée des fonctionnalités admin manquantes, croisée avec
le modèle de données existant. Priorité = impact métier × probabilité
d'usage pré-launch.

### P0 — bloquants à court terme

1. **Tableau de bord vide**. `app/(admin)/tableau-de-bord/page.tsx`
   contient 8 lignes (`<h1>Back-office</h1>`). Aucun KPI agrégé alors
   que tout est déjà disponible (orders, producers, audit_logs).
   Toutes les pages admin sont accessibles mais le point d'entrée
   ne donne aucune information de pilotage.

2. **Pas de page de gestion des chargebacks Stripe** (`disputes`).
   La table est alimentée par les webhooks `charge.dispute.{created,
   updated,closed}` (T-403). Volume actuel 0 mais en cas de chargeback
   réel l'admin n'a aucun moyen de le voir hors de l'interface
   Stripe — alors que la donnée est dupliquée en DB.

3. **Pas de page de gestion des refund_incidents**. Refunds Stripe
   échoués (`refund_incidents` + `refund_incident_attempts`).
   Le cron de retry existe (T-102) mais l'admin n'a aucune visibilité
   sur les incidents bloqués. En cas de refund manuel à exécuter,
   l'admin doit aller dans le Stripe Dashboard.

4. **Reviews `pending` invisibles côté admin** (cf. § 4.5). Bug
   construction RLS : la page `/avis` ne pourra pas afficher les
   reviews à modérer dès qu'un consumer en publiera. Modération a
   posteriori des réponses producer OK, modération initiale cassée.

### P1 — important avant scale producteur

5. **Pas de gestion catalogue produits** (`products`). 16 produits en
   base, l'admin ne peut pas voir le catalogue global, retirer un
   produit problématique, vérifier les stocks. Tout dépend du
   producer.

6. **Pas de listing des invitations sortantes** (`producer_invitations`,
   22 rows). L'admin peut envoyer une invitation depuis
   `/gestion-producteurs` mais ne peut pas voir la liste des
   invitations envoyées, distinguer les acceptées des expirées, ou
   en révoquer une explicitement (alors que l'event_type
   `invitation_revoked` est pré-déclaré). Note schéma : la table n'a
   **pas de colonne `status`** — les états (acceptée / expirée /
   révoquée) doivent être computed côté query par
   `used_at IS NOT NULL` / `used_at IS NULL AND expires_at < now()` /
   (révocation = action future, pas de col dédiée pour l'instant).

7. **Pas de vue payouts** (`payouts`). En cas de question producteur
   « je n'ai pas été payé », l'admin doit aller dans Stripe Connect.
   Donnée déjà en DB.

8. **Pas de vue notifications / delivery email** (`notifications`,
   111 rows). En cas de question « le mail n'est pas arrivé »,
   l'admin n'a pas de tableau de tracking, juste les audit logs
   indirects.

### P2 — utiles mais non bloquants

9. **Pas de vue users globale**. `/legal-compliance` est focalisée
   CGU, pas une vue détaillée par user (impossibilité de chercher un
   compte par email global, voir ses commandes, ses reviews, etc.).

10. **Pas de vue email_suppressions**. Une seule ligne actuellement
    (bounce/complaint Resend). À volume plus important, l'admin aura
    besoin de débugger qui est exclu des envois.

11. **Pas de vue deleted_users**. 4 tombstones RGPD. Forensique
    post-suppression difficile sans accès direct à la table.

12. **Pas de gestion `slot_rules` / `slots`**. Policy admin ALL
    existe sur `slot_rules` mais aucune UI. En cas de bug créneau
    producer (slot exception, slot adhoc), l'admin doit aller en SQL.

13. **Pas de vue historique `gms_prices_history`**. La page
    `/gms-prices` permet la MAJ mensuelle mais l'historique
    (toujours 0 rows aujourd'hui) ne sera pas consultable.

14. **Pas de vue `producer_invitations` expirées** (cf. 6) — couplé.

### P3 — confort

15. **Audit logs : pas de drill-down par event_type** depuis les
    stats cards (les cards affichent un count, sans lien).
16. **Audit logs : pas de toggle masquage/affichage IP/UA** (déjà
    masquées en DB mais zéro contrôle UI).
17. **Pas de filtre date sur la table principale `/suivi-commandes`**
    (limite hardcodée à 200 dernières).

---

## 7. Dette technique et incohérences

### 7.1 Patterns READ incohérents (cf. § 4.5)

Trois patterns lecture coexistent (browser RLS, server RLS, server
service_role) sans règle écrite. Risque : régressions silencieuses
quand l'auteur d'une nouvelle page admin choisit le mauvais.

### 7.2 Patterns WRITE incohérents

- `gestion-producteurs/page.tsx:258-275` fait des UPDATE directs
  `producers.statut` via le browser client (RLS admin all). Pas de
  `revalidatePath`, juste un `revalidatePublicStats` côté serveur.
- `producer-interests/page.tsx:68-83` fait des UPDATE directs
  `producer_interests.statut` via browser client.
- Toutes les autres pages WRITE passent par API routes.

Conséquence : duplication conceptuelle (auth check côté layout +
RLS) vs (auth check côté API route). Une régression future de la
policy `producers admin all` retire silencieusement la capacité
d'UPDATE depuis `gestion-producteurs` (alors qu'une API route aurait
levé un 500 explicite).

### 7.3 Layout fetchpath dupliqué

`app/(admin)/layout.tsx:38-42` fait un count `pending_refunds` sur
toutes les pages admin (badge sidebar). Coût ~1 query par navigation
admin. Acceptable mais pourrait être unifié avec le fetch principal
de `/refunds/pending` quand on est sur cette page (gain marginal).

### 7.4 `categorisation/*` — READ browser, WRITE API

Les 3 pages `/categorisation/*` font READ direct via browser client
(public RLS) et WRITE via API routes. Le READ direct fetch
`products` complet pour compter localement les dépendances. À volume
~16 produits OK, à 10k produits ça scanne tout. Commentaire de code
le note explicitement (RPC d'agrégation suggéré au-delà).

### 7.5 Composants admin non factorisés

- `PendingRefundsClient.tsx` n'utilise pas `AdminPageHeader` ni
  `TableActionButton` — styles inline locaux. Divergence par rapport
  à toutes les autres pages admin.
- `categorisation/*` n'utilise pas `FilterTabs` ni `StatusPanel`
  (recherche locale custom). Cohérent vu le besoin (search seul, pas
  de tabs), mais non explicité.

### 7.6 `audit_logs` — `contact_form_submitted` orphelin

`app/api/contact/route.tsx:208` écrit l'event sans passer par
`lib/audit-logs/log-*`. Pas catégorisé, pas labellisé. Aligner sur
le pattern.

### 7.7 Pas de retention `audit_logs`

Table append-only sans purge ni TTL (cf. § 5.5).

### 7.8 Sidebar codée en dur

`app/(admin)/_components/AdminSidebar.tsx:237-252` contient les 13
entrées en dur. Acceptable au volume actuel, mais quand la navigation
dépassera 20 entrées (P0+P1 ci-dessus = ~6 entrées à ajouter), une
structure groupée + collapsible deviendra utile (la sidebar supporte
déjà les groupes `kind: 'group'`).

### 7.9 Reviews — bug RLS lecture pending (cf. § 4.5)

À traiter comme bug, pas comme dette. Non visible aujourd'hui car
`reviews` est à 0 rows.

---

## 8. Synthèse exécutive

L'admin TerrOir couvre **8 domaines fonctionnels** (producteurs,
leads, commandes, refunds en attente, audit, avis, conformité CGU,
prix GMS, catégorisation produits) avec une qualité d'exécution
hétérogène : la couche `components/ui/Admin*` factorise correctement
le shell, et les helpers `lib/audit-logs/` sont solides. Mais le
**tableau de bord est littéralement vide** et **5 surfaces
fonctionnelles importantes ne sont pas câblées en UI** alors que
les données existent en DB (disputes, refund_incidents, products,
payouts, notifications).

**Top 3 forces** :
1. Layout + middleware defense-in-depth correctement implémentés,
   isolation host prod active.
2. Couverture audit_logs très large (~95 event_types, helpers
   factorisés, RLS append-only).
3. Pattern factorisation UI (`AdminPageHeader`, `FilterTabs`,
   `TableActionButton`, `TableStatus`, `MetricCard`) appliqué
   cohéremment sur 9 des 11 pages métier.

**Top 3 chantiers prioritaires** :
1. **Tableau de bord pilotage** — câbler les KPI déjà disponibles
   (orders du jour, CA semaine, refunds en attente, top events 7j,
   conversion invitations) sur `/tableau-de-bord` actuellement vide.
2. **Combler les angles morts critiques** — pages
   `/disputes`, `/refunds/incidents`, `/products` (catalogue).
   Tables alimentées par webhook/cron mais invisibles côté admin.
3. **Corriger le bug reviews pending** (§ 4.5) — ajouter une policy
   RLS `reviews admin read` OU faire passer la lecture par une
   API route service_role. Bug latent qui se révélera dès le premier
   avis consumer en prod.

À traiter en parallèle : harmoniser les patterns READ/WRITE admin
(brouiller browser-RLS vs server-service_role est un terrain à
régressions), normaliser l'écriture orpheline
`contact_form_submitted` dans `audit_logs`, et poser une politique
de rétention sur `audit_logs` avant que la table ne pose un
problème opérationnel.
