# Vue admin "Conformité CGU" — chantier 2026-05-06

## Use case

Suite au chantier checkboxes CGU/CGV (commit `806fc87`), tout nouveau user
accepte explicitement les CGU à l'inscription (col. `users.cgu_accepted_at`
+ `users.cgu_version` peuplées). Les **11 users existants pré-2026-05-06**
n'ont pas ces colonnes peuplées (acceptation rétroactive auto = NULL,
documenté dans la migration `20260506131551_add_legal_acceptance_columns.sql`).

Pré-launch, avant le 1er paiement réel, Romain a besoin de :

1. Connaître le nombre exact d'utilisateurs **non conformes** (CGU jamais
   acceptée) — pour décider du sort de ces comptes (relance email, popup
   réacceptation forcée, ou suppression).
2. Pouvoir **exporter** la liste pour audit manuel ou transmission avocat.
3. Préparer le terrain pour le **chantier 3 popup réacceptation** : si on
   bump CGU 1.0 → 2.0 plus tard, on aura besoin de la même logique côté
   backend.

## Architecture

### Helpers backend — `lib/legal/compliance.ts`

Trois fonctions exposées :

- `getUserCGUStatus(userId)` — `CGUComplianceStatus | null`. Lit les colonnes
  `cgu_accepted_at` / `cgu_version` d'un user et calcule son statut. **Sera
  réutilisée par le chantier popup réacceptation** (middleware ou page
  intermédiaire qui détecte `accepted_outdated | never_accepted` au login
  et force le passage par `/cgu/reaccepter`).
- `listUsersWithCGUStatus(filters)` — paginée, filtre `status` (whitelist
  4 valeurs) + `search` partial sur email (avec échappement `%` / `_` pour
  empêcher l'admin d'élargir involontairement le pattern `ILIKE`).
- `getCGUComplianceStats()` — counts globaux pour le dashboard, 4 head-only
  count queries en parallèle.

Helper pur exposé `computeCGUStatus(acceptedAt, acceptedVersion, now?)`
pour les tests et le re-mapping de rows DB.

### Page admin — `app/(admin)/legal-compliance/page.tsx`

Server component dynamique. Reads `searchParams` (status, search, page)
via parseur défensif (`_lib/parse-search-params.ts`), call les helpers en
parallèle (Promise.all stats + users). Default filter = **`never_accepted`**
(focus pré-launch sur les héritiers).

UI :

- `AdminPageHeader` (eyebrow "Conformité")
- 4 cards `MetricCard` : Total / À jour (v1.0) / Obsolète / Jamais acceptée
- `Filters` : tabs status + search input (form GET) + bouton Export CSV +
  Réinitialiser
- `UsersTable` : colonnes Email, Inscription, Statut, Acceptée le, Version,
  Action (bouton "Forcer réacceptation" désactivé en V1, prêt à câbler V2)
- `Pagination` : précédent/suivant via `Link`, indicateur "Page X sur Y"

### Routes API — `app/api/admin/legal-compliance/`

- `GET /users?status=&search=&page=` — JSON paginé pour usage potentiel
  hors-page (export programmatique, future vue mobile, etc.)
- `GET /stats` — JSON counts
- `GET /export?status=&search=` — CSV (UTF-8 BOM, `;` séparateur, RFC 4180,
  filename `legal-compliance_YYYY-MM-DD[_filtered].csv`). Audit log
  `admin_legal_compliance_exported` émis (cluster dédié
  `lib/audit-logs/log-legal-event.ts`, découplé du pipe auth).

### Sidebar admin

Ajout d'une entrée "Conformité légale" entre "Avis" et "Prix GMS" dans
`app/(admin)/_components/AdminSidebar.tsx` avec un icon shield-check.

## Décisions et trade-offs

- **Pas de migration DB** : les colonnes `users.cgu_accepted_at` et
  `users.cgu_version` créées au commit `806fc87` suffisent. Pas besoin de
  table `legal_acceptances` séparée — la 1:1 colonnes/users est plus simple
  et plus rapide à requêter pour V1.
- **Filtre `accepted_outdated` vide en V1** par construction (`LEGAL_VERSIONS.CGU
  = "1.0"` unique). On l'expose quand même dans les stats et les filtres
  pour valider la logique en preview du chantier 3 (popup réacceptation
  après bump 1.0 → 2.0).
- **Pas d'audit log à la lecture** (`/users`, `/stats`) : seules les actions
  destructives ou exportantes méritent un event. Le simple chargement de la
  page admin n'est pas sensible (déjà tracé indirectement via la session
  admin). Cohérent avec le pattern `audit-logs/page.tsx`.
- **Export CSV synchrone** : capé à 10 000 users. Pré-launch (~50 users),
  pas de risque de saturation. Pour > 5 000 users, prévoir un background
  job — TODO non urgent (pas avant scaling sérieux).
- **`computeCGUStatus` pur exposé** : permet de tester la logique de
  classification sans mocker Supabase, et de la réutiliser côté chantier 3
  sans toucher au helper qui frappe la DB.
- **Cluster audit log dédié** (`log-legal-event.ts` vs ajout à
  `AUTH_EVENT_TYPES`) : choisi pour rester non-conflictuel avec d'autres
  chantiers en parallèle (producer response touche `log-review-event.ts`).
  La table `audit_logs.event_type` étant TEXT libre, le cluster séparé n'a
  pas de coût opérationnel.
- **Bouton "Forcer réacceptation" désactivé** en V1 : signale le futur flow
  sans laisser de surface cliquable trompeuse. Sera câblé au chantier 3
  vers `POST /api/admin/legal-compliance/users/[id]/reset-cgu` (à créer).

## Préparation chantier 3 (popup réacceptation)

Quand le chantier 3 démarrera (suite à un bump CGU 1.0 → 2.0) :

1. `getUserCGUStatus(userId)` → utilisé côté middleware ou layout consumer
   pour détecter `status === "accepted_outdated"` et rediriger vers
   `/cgu/reaccepter`.
2. Page `/cgu/reaccepter` réutilise les composants checkbox du chantier
   `806fc87` (mêmes `CguAcceptanceField` et helpers). Au submit, server
   action met à jour `users.cgu_accepted_at = NOW()` et
   `users.cgu_version = LEGAL_VERSIONS.CGU`.
3. Bouton "Forcer réacceptation" admin → `POST /api/admin/legal-compliance/users/[id]/reset-cgu`
   qui set `cgu_accepted_at = NULL` + `cgu_version = NULL` (force le user à
   repasser le flow au prochain login).

## Fichiers livrés

### Créés
- `lib/legal/compliance.ts` — 4 helpers backend (`computeCGUStatus`,
  `getUserCGUStatus`, `listUsersWithCGUStatus`, `getCGUComplianceStats`)
- `lib/legal/compliance-csv.ts` — sérialiseur CSV
- `lib/audit-logs/log-legal-event.ts` — wrapper cluster legal_compliance
- `app/(admin)/legal-compliance/page.tsx` — server component
- `app/(admin)/legal-compliance/_lib/parse-search-params.ts`
- `app/(admin)/legal-compliance/_components/Filters.tsx`
- `app/(admin)/legal-compliance/_components/StatusBadge.tsx`
- `app/(admin)/legal-compliance/_components/UsersTable.tsx`
- `app/(admin)/legal-compliance/_components/Pagination.tsx`
- `app/api/admin/legal-compliance/users/route.ts`
- `app/api/admin/legal-compliance/stats/route.ts`
- `app/api/admin/legal-compliance/export/route.ts`
- `tests/lib/legal/compliance.test.ts` — 20 tests
- `tests/lib/legal/compliance-csv.test.ts` — 6 tests
- `tests/app/api/admin/legal-compliance/users.test.ts` — 10 tests
- `tests/app/api/admin/legal-compliance/stats.test.ts` — 4 tests
- `tests/app/api/admin/legal-compliance/export.test.ts` — 8 tests

### Modifiés
- `app/(admin)/_components/AdminSidebar.tsx` — ajout entrée
  "Conformité légale" + icon

## Vérifs

- `pnpm vitest run` : 1864 tests passent (+48 vs baseline 1816)
- `npx tsc --noEmit` : OK
- `npx next lint` : pas de nouvelles warnings (le seul warning préexistant
  reste sur `components/providers/user-provider.tsx`)
- Pas de migration DB
- Aucun fichier touché en dehors du scope admin (sidebar = seul fichier
  admin partagé, modification surgicale 1 entrée)
