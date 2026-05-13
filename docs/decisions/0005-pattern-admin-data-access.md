# ADR-0005 — Pattern d'accès aux données admin : Server Component + service_role + API route + audit log

- **Statut** : Accepted
- **Date** : 2026-05-13 (chantier audit-driven admin, PR #128 / #129 / #130)
- **Décideurs** : Romain

## Contexte

L'admin TerrOir (sous-domaine `admin.terroir-local.fr`, route group
`(admin)`) couvre une dizaine de pages métier (gestion producteurs,
modération avis, suivi commandes, audit-logs, refunds, conformité CGU,
prix GMS, catégorisation produits, etc.). L'audit `docs/AUDIT_ADMIN.md`
(2026-05-13) a identifié 3 problèmes structurants côté accès aux
données :

1. **3 patterns READ coexistants** sans règle écrite :
   - READ direct browser client + RLS admin (ex : `/gestion-producteurs`,
     `/producer-interests`) ;
   - READ server component + service_role bypass (ex : `/suivi-commandes`,
     `/legal-compliance`) ;
   - READ server component + RLS admin authentifié (ex : `/audit-logs`).

   Le choix était dicté par la présence ou non d'une policy admin RLS sur
   la table cible, pas par un principe explicite. Conséquences :

   - **Bug latent `/avis`** (`AUDIT_ADMIN §4.5`) : la page lisait via
     browser client + RLS, mais la table `reviews` n'a aucune policy
     admin. Les reviews `pending` étaient invisibles côté admin par
     construction RLS, dès qu'un consumer en publierait un. Bug latent
     parce que la table était à 0 row, mais garantissait une régression
     prod au premier avis réel.
   - Risque général : tout dev créant une nouvelle page admin doit
     deviner le bon pattern selon la table — porte ouverte aux régressions
     silencieuses.

2. **2 patterns WRITE coexistants** :
   - UPDATE direct browser client (ex : `gestion-producteurs`,
     `producer-interests`) — pas d'audit log, pas de validation
     serveur, pas de revalidate explicite.
   - WRITE via API route + service_role + audit log (ex : `/avis`
     moderation, `/gms-prices`, `/categorisation/*`).

3. **Pas d'audit log uniforme** sur les mutations admin. Certaines
   actions (UPDATE statut producteur, suppression lead) ne laissaient
   aucune trace forensique.

## Décision

**Pattern Option 3 retenu pour toutes les pages admin (existantes et
futures)** :

- **READ admin** → Server Component avec `export const dynamic =
  'force-dynamic'` + `createSupabaseAdminClient()` (service_role).
- **WRITE admin** → API route `/api/admin/*` avec `getSessionUser()` +
  `session.isAdmin` (403 sinon) + `createSupabaseAdminClient()` +
  audit log obligatoire via un helper `lib/audit-logs/log-*-event.ts`.
- **Aucune nouvelle policy RLS admin n'est ajoutée**. Les policies
  existantes pour les autres rôles (`anon`, `authenticated` non-admin,
  `producer`, `consumer`) restent en place.

### Forme canonique

Trois fichiers de référence (PR1, branche `refactor/admin-pattern-uniform`) :

- **READ** : `lib/admin/<domain>/fetch.ts` — helpers service_role
  injectables (client passé en paramètre pour testabilité), pagination
  cursor, mapping raw→AdminRow, retour `{ rows, total, nextCursor,
  error }` fail-safe (pas de throw).
- **WRITE** : `app/api/admin/<domain>/[id]/<action>/route.ts` — auth
  check explicite, Zod sur le body, pre-SELECT pour 404 + snapshot
  metadata, transition guard si applicable (409), UPDATE service_role,
  audit log via helper, `revalidatePath` + tags publics impactés.
- **Audit helper** : `lib/audit-logs/log-<domain>-event.ts` — symétrique
  aux autres clusters, exporte `<DOMAIN>_EVENT_TYPES` (tuple readonly)
  + type union + fonction `log<Domain>Event(params)` fail-safe (try/catch +
  console.warn, jamais re-throw — un échec d'audit ne casse JAMAIS le
  flow principal).
- **Consolidation** : l'event_type est ajouté à
  `app/(admin)/audit-logs/_lib/event-types.ts` (`ALL_EVENT_TYPES` +
  union `AuditEventType`) + à `lib/audit-logs/labels.ts` (label FR) +
  à `app/(admin)/audit-logs/_lib/categorize-event-type.ts` (préfixe →
  catégorie + palette). Le test `labels.test.ts` garantit la parité.

### Surfaces couvertes au moment de la décision

- **PR1 #128** : refactor `/avis`, `/gestion-producteurs`,
  `/producer-interests` (lift les 3 patterns READ incohérents en
  Option 3, résout le bug `/avis` par construction).
- **PR2 #129** : nouvelle page `/tableau-de-bord` (Server Component +
  RPC `get_admin_dashboard()` SECDEF, `service_role` only).
- **PR3 #130** : nouvelles surfaces `/users`, `/refund-incidents`,
  `/invitations` (toutes Option 3).

Toute nouvelle page admin créée après cet ADR DOIT suivre Option 3.

## Alternatives considérées

### Alternative A — Tout via RLS admin (`policy admin all USING is_admin()`)

**Rejetée**. Avantages théoriques (un seul checkpoint sécurité côté DB,
moins de code applicatif). Inconvénients réels :
- Forte coupling entre l'UI admin et le schéma RLS — une régression de
  policy retire silencieusement l'accès admin sans erreur explicite côté
  application.
- Pas de point d'insertion naturel pour l'audit log (le browser client
  ne peut pas écrire `audit_logs` qui n'a aucune policy INSERT). Pour
  garder l'audit, il faudrait quand même passer par une API route
  serveur — donc le bénéfice principal de RLS disparaît.
- Le bug `/avis` § 4.5 vient précisément de ce pattern : "ah mais la
  table reviews n'a pas de policy admin", et c'est invisible à l'œil
  jusqu'au premier row réel.
- Mélanger UI admin (qui a besoin de voir tout, par définition) et
  policies RLS (conçues pour scoper par user authentifié) crée une
  tension permanente qui finit par diluer les deux.

### Alternative B — Mix selon table, sans règle écrite (status quo)

**Rejetée**. C'est ce qui existait avant ce chantier. Le coût de
maintenance dépasse le bénéfice : chaque nouvelle page admin demande
une décision case-by-case, et les régressions silencieuses (cf. bug
`/avis`) sont garanties à terme.

### Alternative C — Server actions au lieu d'API routes pour WRITE

**Considérée puis écartée pour cette itération**. Les server actions
offrent une ergonomie meilleure pour les formulaires simples
(`<form action={...}>`). Mais :
- Cohabitation avec API routes existantes serait un mix incohérent
  (régression du même problème qu'on résout).
- Les server actions Next 16 sont sensibles aux quirks `redirect()` /
  `return state` sur routes protégées (cf. `CLAUDE.md §8` Next 16/React
  19). API route + fetch côté client est plus robuste pour les flows
  admin actuels.
- Possible migration future si les server actions stabilisent leur
  pattern auth — pas dans le scope de ce chantier.

## Conséquences

### Positives

- **Sécurité homogène** : un seul point de check (`session.isAdmin`
  côté API route + dans le layout admin) avant chaque mutation. Plus
  besoin de raisonner sur "telle table a-t-elle une policy admin".
- **Forensique systématique** : toute mutation admin laisse une trace
  dans `audit_logs` via un helper standard. Couvre RGPD art. 32 + PCI
  DSS 10.x + débogage opérationnel.
- **Testabilité** : helpers fetch en `lib/admin/<domain>/` injectent
  le client Supabase en paramètre → tests unitaires sans monkey-patch.
  Les API routes sont testables comme handlers HTTP standard (mocks
  service_role + Zod + audit log).
- **Lecture facile pour un dev nouveau** : la convention est explicite
  (cf. cet ADR + 3 fichiers de référence). Pas d'ambiguïté sur le bon
  pattern à appliquer.
- **Bug `/avis` résolu par construction** : impossible de rater une
  policy RLS manquante, puisqu'on bypass toutes les RLS via
  service_role.

### Négatives assumées

- **Plus de code applicatif** par mutation (API route + helper audit
  log) qu'un simple UPDATE browser client. Coût acceptable vu le gain
  forensique + cohérence.
- **Pas d'optimistic update natif** sur les mutations (la page attend
  la réponse serveur puis `router.refresh()`). Acceptable pour un admin
  cliqué quelques fois par jour ; pas justifié de revenir à un pattern
  optimistic browser-side (double source de vérité + gestion rollback).
- **Service_role omniprésent côté SSR admin** : nécessite que
  `SUPABASE_SERVICE_ROLE_KEY` ne fuite jamais côté client. Le pattern
  `createSupabaseAdminClient()` est `import "server-only"` (build error
  si importé côté browser) — garde-fou suffisant.
- **Pas d'audit log sur les READ** : seule la mutation est tracée, pas
  la consultation. Acceptable pré-Live (volume faible, peu d'admins) —
  à revoir si compliance impose un journal des consultations
  sensibles (ex : export massif de données utilisateurs).

### Conséquences sur le futur

- **PR future créant une page admin** : applique le pattern sans
  question. Trois fichiers de référence à copier :
  `lib/admin/producers/fetch.ts`,
  `app/api/admin/producers/[id]/statut/route.ts`,
  `lib/audit-logs/log-producers-admin-event.ts`.
- **PR future ajoutant un nouveau type de mutation** : crée un nouveau
  helper `log-<domain>-event.ts` symétrique + ajoute le cluster à
  `event-types.ts` + ajoute le label dans `labels.ts` + ajoute la
  règle préfixe dans `categorize-event-type.ts`.
- **Si jamais on revient à un pattern RLS admin** (peu probable, mais
  envisageable si Supabase introduit un mécanisme d'audit RLS natif) :
  cet ADR sera marqué `Superseded` par le nouveau, jamais modifié
  in-place.

## Références

- `docs/AUDIT_ADMIN.md` (2026-05-13) — audit du sous-domaine admin qui
  a déclenché le chantier.
- PR #128 `refactor/admin-pattern-uniform` — application Option 3 aux
  3 pages historiques.
- PR #129 `feature/admin-dashboard` — première nouvelle surface en
  Option 3 + RPC SECDEF.
- PR #130 `feature/admin-new-surfaces` — `/users` (lecture seule),
  `/refund-incidents`, `/invitations`.
- `CLAUDE.md §6` (Conventions code) — pattern réutilisé dans toutes les
  PR.
