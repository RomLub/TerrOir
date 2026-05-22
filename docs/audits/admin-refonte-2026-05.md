# Audit — Refonte espace admin TerrOir

**Date** : 2026-05-21
**Branche** : `chore/admin-refonte-audit-2026-05` (depuis `master` @ `dd9cebc`)
**Périmètre** : tout `app/(admin)/` + middleware/auth + dashboard producteur,
schéma DB lu en SELECT via MCP Supabase. **Lecture seule, aucune
modification de code.**
**Méthode** : lecture intégrale des fichiers concernés + queries SELECT DB.
Les constats portent un numéro de ligne quand pertinent. Ce document est un
**constat de l'existant + voies d'attaque**, pas un plan d'action.

> Glose rapide : « RLS » = règles SQL Supabase qui décident qui lit/écrit
> quelle ligne. « RPC » = fonction SQL appelée depuis Next via
> `supabase.rpc()`. « SECDEF » = `SECURITY DEFINER`, fonction SQL qui
> s'exécute avec les droits de son créateur (bypass RLS contrôlé).
> « SSR » = HTML calculé côté serveur. « service_role » = clé serveur
> Supabase qui bypass la RLS.

---

## 1. Auth admin — cause de la double connexion

### 1.1 Verdict

**La double connexion n'est pas un bug : c'est une isolation volontaire des
cookies de session entre `admin.*` et `www/pro.*` (« Chantier 4 »).** Une
session ouverte sur `www.terroir-local.fr` est, par conception, **invisible**
sur `admin.terroir-local.fr`. L'écran de login admin est donc attendu — la
question de la refonte est de savoir si on **garde** cette isolation (et on
améliore juste l'ergonomie) ou si on l'**assouplit** (et on assume le
trade-off sécu).

### 1.2 La mécanique exacte

**Config cookies — `lib/supabase/cookie-domain.ts:25-38`** (`cookieConfigForHost`) :

| Host | Nom du cookie de session | `domain` | Portée effective |
|------|--------------------------|----------|------------------|
| `www.*` / `pro.*` / apex | `sb-<projectref>-auth-token` (défaut Supabase) | `.terroir-local.fr` | **partagé** www ↔ pro |
| `admin.*` | `sb-admin-auth-token` (nom distinct) | *(aucun)* | **scopé admin.* uniquement** |
| `localhost` / autres | défaut (sauf admin.* qui garde le nom distinct) | aucun | dev |

Deux leviers d'isolation cumulés sur `admin.*` (commentaire `cookie-domain.ts:10-15`) :
1. **Nom distinct** `sb-admin-auth-token` → le client Supabase admin **ignore**
   le cookie partagé posé par www/pro (même apex, sinon collision de nom).
2. **Pas de `domain`** → le cookie admin n'est ni lu ni écrit sur
   `.terroir-local.fr`, donc ne fuit jamais vers www/pro.

Cette config est appliquée partout : middleware (`middleware.ts:203`),
client serveur (`lib/supabase/server.ts:8`), client navigateur
(`lib/supabase/client.ts:10`). Le client Supabase n'a donc accès, sur
`admin.*`, qu'au cookie `sb-admin-auth-token` — qui n'existe que si on s'est
loggé **pendant qu'on était sur `admin.*`**.

**Le cookie « role snapshot » est isolé de la même façon** — `lib/auth/role-snapshot-cookie.ts:35-90`
(`cookieNameForHost` / `cookieOptionsForHost`) :

| Host (prod) | Nom du cookie snapshot | `domain` |
|-------------|------------------------|----------|
| www/pro | `__Secure-terroir_role_snapshot` | `.terroir-local.fr` |
| admin | `__Host-sb-admin-role-snapshot` | *(aucun — préfixe `__Host-` interdit le domain)* |

Commentaire explicite `role-snapshot-cookie.ts:12-14` : « nom distinct sur
admin.* pour ne pas leaker `isAdmin=true` vers www/pro via cookie partagé ».

### 1.3 Le flow de login pas-à-pas

1. **Login (`app/connexion/actions.ts:61-165`, `loginAction`)** :
   `signInWithPassword` (ligne 98) pose le cookie de session **pour le host
   courant** (via `createSupabaseServerClient` → `cookieConfigForHost`). Donc
   un login fait sur `www.*` pose `sb-<ref>-auth-token` (.terroir-local.fr) ;
   un login fait sur `admin.*` pose `sb-admin-auth-token` (admin.* only).
2. Le snapshot de rôle est pré-posé pour le même host
   (`setRoleSnapshotOnStore`, ligne 146).
3. **Redirection password = LOCALE, jamais cross-subdomain** :
   `resolvePostLoginPath` → `localPostLoginPath`
   (`lib/auth/post-login-redirect.ts:117-131`). Pour un admin, retourne
   toujours `/tableau-de-bord` **sur le host courant**. Conséquence latente :
   un admin qui se logge par mot de passe **sur `www.*`** est renvoyé vers
   `www.terroir-local.fr/tableau-de-bord` (page inexistante côté consumer)
   ET son cookie est le cookie partagé www, pas le cookie admin. Il devra de
   toute façon se re-loguer sur `admin.*`.
4. **Le magic link, lui, route cross-domain** : `requestMagicLinkAction`
   (`actions.ts:187-286`) détecte l'admin via `admin_users.email`
   (ligne 226-234) et fixe `emailRedirectTo = getAuthCallbackUrl(isAdmin)` →
   le callback tombe sur `admin.terroir-local.fr/auth/callback`, qui pose le
   cookie `sb-admin-auth-token` correct. C'est le **seul** chemin qui amène
   proprement une session admin sans saisie sur `admin.*`.

### 1.4 Ce que vérifie le middleware admin (`middleware.ts`)

- `getUser()` (ligne 237-239) lit la session via le cookie scopé au host.
  Sur `admin.*` sans cookie admin → `user = null`.
- **Bloc §0 (lignes 269-299)** : sur `admin.*` + path `/`, si `!user` →
  `rewrite` vers la landing admin (`/admin-accueil`). Si `user` admin →
  redirect `/tableau-de-bord` ; si `user` non-admin → `/connexion`.
- **Bloc §2 (lignes 379-384)** : route protégée admin sans session →
  redirect `/connexion?redirectTo=...`.
- **Bloc §3a (lignes 413-426)** : session présente mais `!isAdmin` sur
  `admin.*` → redirect `/connexion`.
- Le statut admin vient de `resolveRoleSnapshot` (`middleware.ts:116-181`) :
  lit le cookie snapshot signé HMAC ; si hit + bind `user_id` + non révoqué
  → utilise le snapshot ; sinon DB lookup `users.roles` + `admin_users`
  (ligne 174-177) et flag `needsRefresh`.

### 1.5 Rôle de `ROLE_SNAPSHOT_SECRET`

Secret HMAC-SHA256 (`role-snapshot-cookie.ts:59-67`) qui **signe** le cookie
snapshot de rôle. Ce cookie est un **cache** (TTL 15 min, `ROLE_SNAPSHOT_TTL_SECONDS`)
qui évite 2 queries DB (`users.roles` + `admin_users`) par requête
authentifiée. **Il ne crée PAS la session** et n'est **pas** la cause de la
double connexion : même invalide/absent, le middleware retombe sur le DB
lookup. Son isolation (nom `__Host-` distinct sur admin.*) renforce
seulement l'étanchéité `isAdmin` entre sous-domaines. La staleness est gérée
côté serveur via la RPC `get_role_snapshot_revocation` (`middleware.ts:137-140`)
et les triggers `on_admin_users_changed_revoke_snapshot` /
`on_users_roles_changed_revoke_snapshot`.

### 1.6 Checks de claim admin côté server components

Defense-in-depth au-delà du middleware : `app/(admin)/layout.tsx:24-33`
re-vérifie `isAdmin` (et le host `admin.` en prod) et redirige `/connexion`
sinon. Toutes les pages admin sont `service_role` + `force-dynamic`. La
session est lue via `getSessionUser()` / `isAdmin()` (`lib/auth/session.ts`).

### 1.7 Hypothèses, par probabilité

1. **(Certaine — c'est la cause) Isolation cookies Chantier 4.** Le cookie
   de session admin a un nom distinct ET pas de domain partagé → une session
   www n'est jamais reconnue sur admin. Distinctif : le 2e login se produit
   **systématiquement** au passage `www → admin`, jamais à l'intérieur d'un
   même sous-domaine.
2. **(Aggravant, secondaire) Redirection password locale.** Un admin qui
   tape ses identifiants sur `www.*` est renvoyé vers une route admin sur le
   host www (inexistante) + cookie www. Distinctif : se manifeste seulement
   si l'admin se logge ailleurs que sur `admin.*` ; via magic link, le
   routing cross-domain corrige (callback admin).
3. **(À écarter) Snapshot/SSO cassé.** Si le snapshot était la cause, on
   verrait des re-logins intra-domaine ou des `isAdmin` perdus aléatoirement.
   Ce n'est pas le cas : le fallback DB couvre l'absence de snapshot.

### 1.8 Voies d'attaque (refonte)

- **Garder l'isolation** (recommandé sécu) et améliorer l'ergonomie : quand
  un user déjà loggé sur www arrive sur `admin.*` sans session admin,
  proposer un « login admin en 1 clic » (ex. déclencher automatiquement le
  flow magic link admin, ou un bouton « Continuer en tant qu'admin » qui
  pré-remplit l'email). On ne partage pas le cookie, mais on supprime la
  re-saisie des identifiants.
- **Assouplir l'isolation** : partager le cookie sur `.terroir-local.fr`
  pour admin aussi. Gain ergonomique, mais on réintroduit le risque qu'une
  XSS sur le site consumer/producteur (surface bien plus large) puisse
  toucher la session admin. Trade-off sécu lourd.

**Question à Romain** : on garde l'isolation stricte admin (et on rend juste
le 2e login indolore via magic link auto / SSO interne) ou on accepte de
partager le cookie de session entre www/pro/admin pour ne plus jamais se
re-loguer ? (Mon avis : garder l'isolation, c'est une vraie barrière de
sécurité pour le back-office ; on attaque l'ergonomie, pas l'étanchéité.)

---

## 2. Dashboard admin actuel

**Fichiers** : `app/(admin)/tableau-de-bord/page.tsx` (Server Component,
`force-dynamic`), composants `_components/CockpitCard.tsx`,
`_components/RecentActivityTable.tsx`, plus `components/ui/metric-card.tsx`.
**Source unique** : une RPC SECDEF `get_admin_dashboard()` (aucun paramètre),
appelée via `fetchAdminDashboard()` (`lib/admin/dashboard/fetch.ts:16`),
définie dans `supabase/migrations/20260513124041_create_get_admin_dashboard.sql`.
Tout le dashboard = 1 query. Fail-safe si la RPC renvoie null
(`page.tsx:31-42`).

### 2.1 Zone « À traiter » — cartes cockpit (`CockpitCard`)

`CockpitCard` rend un `<Link>` cliquable, **sauf** si le flag `pending` est
posé (alors `<span>` désactivé, tooltip « Page à venir », `CockpitCard.tsx:46-65`).

| Carte (label exact) | Source (champ RPC → SQL) | Cliquable → URL |
|---------------------|--------------------------|-----------------|
| `Refunds en attente` | `cockpit.refunds_pending_count` → `pending_refunds` (status=pending) | **Oui** → `/refunds/pending` |
| `Litiges ouverts` | `cockpit.disputes_open_count` → `disputes` (closed_at null) | **Non** (`pending`, href `#`) |
| `Avis à modérer` | `cockpit.reviews_pending_count` → `reviews` (statut=pending) | **Oui** → `/avis` |
| `Producteurs à valider` | `cockpit.producers_pending_validation_count` → `producers` (statut=pending) | **Oui** → `/gestion-producteurs` |
| `Incidents refund` | `cockpit.refund_incidents_count` → `refund_incidents` (pending/retrying) | **Non** (`pending`, href `#`) |
| `Invitations expirées` | `cockpit.invitations_expired_count` → `producer_invitations` (used_at null & expires_at < now) | **Non** (`pending`, href `#`) |

> Incohérence à corriger : les cartes « Incidents refund » et « Invitations
> expirées » sont marquées `pending`/« Page à venir » alors que les pages
> existent ET sont déjà dans la sidebar (`/refund-incidents`, `/invitations`).
> Seul « Litiges ouverts » n'a aucune page (pas de route disputes).

### 2.2 Zone « Aujourd'hui » (`MetricCard` — non cliquables)

- `Commandes` ← `business.orders_today_count` (orders créées jour Paris)
- `Chiffre d'affaires` ← `business.revenue_today_cents` (orders completed)
- `Nouveaux comptes` ← `business.new_users_today_count` (users du jour)

### 2.3 Zone « 7 derniers jours » (`MetricCard` — non cliquables)

- `Commandes` ← `business.orders_7d_count`
- `Chiffre d'affaires` ← `business.revenue_7d_cents`
- `Taux de complétion` ← `business.completion_rate_7d`
- `Producteurs actifs` ← `business.active_producers_7d` (distinct producer_id)
- `Producteurs visibles` ← `business.total_producers` (statut active/public)

### 2.4 Zone « Conversion invitations (30 derniers jours) » (`MetricCard`)

- `Invitations envoyées` ← `conv.invitations_sent` (`audit_logs` event
  `admin_invite_sent`)
- `Onboardings complétés` ← `conv.onboardings_completed` (`audit_logs` event
  `invitation_consumed_success`)
- `Taux de conversion` ← `conv.rate_pct` (null si 0 envoi → « — »)

### 2.5 Zone « Activité récente » (`RecentActivityTable`)

15 derniers `audit_logs` whitelistés. Colonnes : `Quand`, `Type` (badge
catégorie), `Événement`, `Détail`. **Chaque ligne est cliquable** →
`/audit-logs?event_type=<type>` (`RecentActivityTable.tsx:95`).

### 2.6 Sélecteur de période

**Absent.** Aucun sélecteur aujourd'hui/semaine/mois/année. Les fenêtres
(jour Paris, 7 j glissants, 30 j) sont **hardcodées dans la RPC SQL** et la
RPC ne prend aucun paramètre. La page est un Server Component sans `useState`
ni query param. Pour introduire un sélecteur, il faudra paramétrer
`get_admin_dashboard()` (passer des bornes) **ou** créer des RPC par période.

### 2.7 Langue des libellés

**Français majoritaire, mais incohérent** — anglicismes résiduels :
`Refunds en attente`, `Incidents refund` (« refund »), `Back-office`,
hints « Inscriptions **consumer** + producteur », « Avis **consumer**… », et
des labels de catégorie `Stripe` / `Refund` / `Auth` / `Leads`. Cible
refonte : tout passer en FR (« Remboursements », « Comptes consommateurs »,
etc.).

---

## 3. Sidebar admin actuelle

**Fichier** : `app/(admin)/_components/AdminSidebar.tsx` (tableau `NAV`
lignes 291-309). Plus `AdminHeader.tsx` (top bar : logo →
`/tableau-de-bord`, label « Back-office », email user, bouton
« Déconnexion » — **pas** de nav dedans).

### 3.1 Structure actuelle (ordre exact)

Liste plate (un seul `kind:"group"` en fin de liste — pas de nesting
collapsible, commentaire `AdminSidebar.tsx:7-11`) :

1. `Tableau de bord` → `/tableau-de-bord`
2. `Leads producteurs` → `/producer-interests`
3. `Gestion producteurs` → `/gestion-producteurs`
4. `Invitations` → `/invitations`
5. `Utilisateurs` → `/users`
6. `Suivi commandes` → `/suivi-commandes`
7. `Refunds en attente` → `/refunds/pending` *(badge count `pendingRefundsCount`)*
8. `Incidents refund` → `/refund-incidents`
9. `Journal d'audit` → `/audit-logs`
10. `Avis` → `/avis`
11. `Conformité légale` → `/legal-compliance`
12. `Prix GMS` → `/gms-prices`
13. **GROUPE : `Catégorisation produits`**
    - `Catégories` → `/categorisation/categories`
    - `Espèces animales` → `/categorisation/animaux`
    - `Morceaux` → `/categorisation/morceaux`

Aucun gating par rôle dans la sidebar (tous les admins voient tout ; l'accès
est gaté en amont par le layout). Seul conditionnel : le badge de l'item 7
(affiché si `count > 0`, source `pending_refunds` via `layout.tsx:39-42`).

### 3.2 Comparaison avec la cible

| Cible | Item(s) actuel(s) | Mouvement |
|-------|-------------------|-----------|
| **Tableau de bord** | 1. Tableau de bord | inchangé |
| **Producteurs › Leads** (+ bouton « inviter » rapatrié) | 2. Leads producteurs | regroupé sous « Producteurs » ; le bouton inviter vit déjà côté gestion (cf. §4.6) |
| **Producteurs › Gestion producteurs** | 3. Gestion producteurs | regroupé |
| *(la page 4. Invitations)* | 4. Invitations | **disparaît** → absorbée dans Leads en onglet « invitations en cours » (cf. §5) |
| **Consommateurs › Suivi commandes** | 6. Suivi commandes | regroupé sous « Consommateurs » |
| **Consommateurs › Remboursements** | 7. Refunds en attente + 8. Incidents refund | **fusionnés** en « Remboursements » (cf. §8) |
| **Consommateurs › Comptes consommateurs** | *(éclaté de 5. Utilisateurs)* | **nouveau** — vue consumer de l'ex-Utilisateurs (cf. §7) |
| **Gouvernance › Admins** | *(éclaté de 5. Utilisateurs)* | **nouveau** — vue admin de l'ex-Utilisateurs (cf. §7) |
| **Gouvernance › Journal d'audit** | 9. Journal d'audit | regroupé sous « Gouvernance » |
| **Gouvernance › Avis** | 10. Avis | regroupé |
| **Gouvernance › Conformité légale** | 11. Conformité légale | regroupé |
| **Référentiels › Données GMS** | 12. Prix GMS | regroupé/renommé sous « Référentiels » |
| **Référentiels › Catégorisation** | groupe Catégorisation (3 items) | regroupé sous « Référentiels » |
| **Mails** (split producteurs/consommateurs) | *(rien)* | **nouveau** — n'existe pas (cf. §9) |
| **Paramètres** | *(rien)* | **nouveau** — pas de page Paramètres admin aujourd'hui |

**Items actuels qui disparaissent / se déplacent / fusionnent** :
- **Disparaît** : `Utilisateurs` (éclaté en « Comptes consommateurs » +
  « Admins » ; la partie producteurs est déjà couverte par Gestion
  producteurs). `Invitations` (absorbée dans Leads).
- **Fusionnent** : `Refunds en attente` + `Incidents refund` →
  « Remboursements ».
- **Se déplacent (regroupement sous sections)** : tout le reste passe sous
  des entêtes Producteurs / Consommateurs / Gouvernance / Référentiels.
- **Limite technique** : la sidebar actuelle ne supporte **pas** le nesting
  collapsible (juste des group headers plats). La cible (sous-menus
  Producteurs › Leads/Gestion, etc.) nécessitera d'étendre `AdminSidebar`
  pour gérer des groupes avec enfants (et idéalement collapse/expand).

---

## 4. Page Leads producteurs

**Fichiers** : `app/(admin)/producer-interests/page.tsx` (+ `_components/`
`ProducerInterestsClient.tsx`, `LeadsTable.tsx`, `LeadStatusBadge.tsx`,
`LeadSourceBadge.tsx`, `DeleteLeadModal.tsx`, `types.ts`).
Fetcher SSR service_role : `lib/admin/producer-interests/fetch.ts:18-34`.

### 4.1 Modèle de données — table `producer_interests`

| col | type | null | défaut |
|-----|------|------|--------|
| `id` | uuid | NO | gen_random_uuid() |
| `nom` | text | NO | — |
| `email` | text | NO | — |
| `telephone` | text | YES | — |
| `nom_exploitation` | text | YES | — |
| `commune` | text | YES | — |
| `especes` | text[] | YES | — |
| `message` | text | YES | — |
| `statut` | text | YES | `'new'` |
| `created_at` | timestamptz | YES | now() |
| `source` | text | NO | `'formulaire_public'` |
| `prenom` | text | YES | — |

CHECK : `statut ∈ {new, contacted, onboarded}` ; `source ∈ {formulaire_public,
invitation_directe}`. Pas d'enum Postgres (text + CHECK).

### 4.2 Distinction prospectés / spontanés

**Présente**, portée par la colonne **`source`** :
- `formulaire_public` = **spontané** (inbound via `/devenir-producteur`),
  badge « Public » (`LeadSourceBadge.tsx:9`).
- `invitation_directe` = **prospecté** (l'admin a invité un email jamais
  passé par le formulaire), badge « Invité » (`LeadSourceBadge.tsx:15`). Créé
  a posteriori par la route d'invitation (`app/api/admin/producers/invite/route.tsx:402-428`).

Données prod : 9 leads, tous `formulaire_public` (3 new / 3 contacted / 3
onboarded), 0 `invitation_directe`.

### 4.3 Champs « suivi commercial » : présents vs MANQUANTS

| Champ cible | Colonne | Verdict |
|-------------|---------|---------|
| Premier contact (date) | — | **MANQUANT** (seul `created_at` = date réception du lead) |
| Dernier contact (date) | — | **MANQUANT** |
| Type de contact (email/tél/RDV) | — | **MANQUANT** |
| Prochaine relance (date) | — | **MANQUANT** |
| Contact — nom | `nom` | présent |
| Contact — prénom | `prenom` | présent |
| Contact — email | `email` | présent |
| Contact — téléphone | `telephone` | présent |
| Nom d'exploitation | `nom_exploitation` | présent |
| Suiveur (Romain/Chloé/Julien) | — | **MANQUANT** (aucune notion d'owner/assignee) |

Champs en plus : `commune`, `especes`, `message`. **Tout le volet CRM (dates
de contact, canal, relances, owner) est absent du schéma.** C'est un simple
journal d'acquisition.

### 4.4 États du funnel

`statut` ∈ `{new, contacted, onboarded}`. Labels badges : « Nouveau » /
« Contacté » / « Onboardé » (`LeadStatusBadge.tsx`). Transitions UI
(`LeadsTable.tsx`) : new → « Marquer contacté » + « Inviter » ;
contacted → « Marquer onboardé » + « Réouvrir » ; tout statut → « Supprimer ».
Mutations via `PATCH /api/admin/producer-interests/[id]/statut`.

### 4.5 Mécanisme de relance

**Aucun** — ni auto, ni manuel, ni mixte. Aucune colonne de relance, aucune
logique. Seul effet « contact » : envoyer une invitation bumpe le lead `new`
→ `contacted` côté serveur (`invite/route.tsx:366-387`), one-shot, pas une
relance planifiée. Un lead spontané reste `new` indéfiniment tant qu'un admin
ne le traite pas. **Voie d'attaque refonte** : tout le suivi de relance
(dates, owner, prochaine action) est à construire de zéro (nouvelles colonnes
ou table satellite `producer_interest_followups`).

### 4.6 Bouton « Inviter producteur »

Deux points d'entrée aujourd'hui :
1. Bouton « Inviter » dans la table Leads, **seulement sur statut `new`**
   (`LeadsTable.tsx:103-109`). Il **ne crée pas** l'invitation : il
   **redirige** vers `/gestion-producteurs?invite=<email>` (`LeadsTable.tsx:30-31`)
   qui ouvre l'`InviteModal` pré-rempli.
2. Bouton « + Inviter un producteur » dans le header de Gestion producteurs
   (`GestionProducteursClient.tsx:211`).

L'envoi réel passe par `POST /api/admin/producers/invite`, qui écrit dans
`producer_invitations` ET met à jour `producer_interests` (bump statut ou
création lead `invitation_directe`). Le pont leads ↔ invitations se fait **au
niveau de l'email**, pas par FK. La cible (« rapatrier le bouton inviter dans
Leads ») est donc surtout un déplacement d'UI : la logique existe déjà.

---

## 5. Page Invitations

**Fichiers** : `app/(admin)/invitations/page.tsx` (+ `_components/`
`InvitationsListClient.tsx`, `RevokeInvitationModal.tsx`,
`RevokeInvitationTrigger.tsx`). Fetcher : `lib/admin/invitations/fetch.ts`.

### 5.1 Ce qu'elle affiche / permet

Titre « Invitations producteurs ». Colonnes : `Email`, `Statut`,
`Envoyée le`, `Expire le`, `Consommée le`, `Révoquée le`, `Créée par`,
`Actions`. Filtres : tabs (Toutes / Envoyées / Consommées / Expirées /
Révoquées) + plage de dates sur `created_at` + pagination cursor (50/page).
**Seule action de mutation : Révocation** (`POST /api/admin/invitations/[id]/revoke`),
affichée seulement si statut = `sent`. Pas de création d'invitation ici.

### 5.2 Schéma `producer_invitations`

| col | type | null | défaut |
|-----|------|------|--------|
| `id` | uuid | NO | gen_random_uuid() |
| `email` | text | NO | — |
| `token` | text | NO | — |
| `expires_at` | timestamptz | NO | now()+7j |
| `used_at` | timestamptz | YES | — |
| `created_by` | uuid | YES | — (FK `auth.users(id)`) |
| `created_at` | timestamptz | YES | now() |
| `revoked_at` | timestamptz | YES | — |

**Confirmé : pas de colonne `status`** (doctrine respectée). CHECK
`producer_invitations_revoke_consume_exclusive` : une invitation ne peut être
à la fois consommée et révoquée. Volume prod : 23 (3 consommées, 0 révoquées,
19 expirées, 1 « sent »).

### 5.3 Calcul des états (computed)

`mapRowStatus` (`lib/admin/invitations/fetch.ts:83-91`), précédence
**consumed > revoked > expired > sent** :
- consumed = `used_at IS NOT NULL`
- revoked = `revoked_at IS NOT NULL`
- expired = `expires_at < now()`
- sent = sinon
Conforme à la doctrine (consommée / expirée / en attente), **plus** la
dimension `revoked` (colonne `revoked_at`, déjà présente — la doctrine
prévoyait justement `revoked_at` plutôt qu'un enum).

### 5.4 Verdict : absorber Invitations dans Leads ?

**Faisable mais ce n'est pas une fusion gratuite — c'est un re-design du
modèle de liste.** Obstacles :
1. **Deux tables distinctes liées seulement par l'email** (pas de FK). Un
   onglet « invitations en cours » dans Leads devrait faire un 2e fetch sur
   `producer_invitations` + join applicatif par email. Matching imparfait :
   un lead peut avoir 0/1/N invitations (re-invitations → tokens orphelins),
   une invitation peut n'avoir aucun lead.
2. **Paradigmes de filtrage divergents** : Leads = statut stocké, filtré
   **côté client** sur tout le dataset chargé (pas de pagination).
   Invitations = statut **computed en SQL** + pagination cursor server (50).
3. **Câblage revoke** : s'applique à une `invitation_id`, pas un `lead_id`.
   En vue lead, il faudrait résoudre quelle(s) invitation(s) révoquer.
4. **Jointure `auth.users` (PostgREST)** : `created_by` → `auth.users(id)` ne
   peut pas être joint en embarqué (PostgREST ne traverse pas `auth.*`). La
   colonne « Créée par » exige déjà un fetch séparé sur `admin_users` + lookup
   Map (`fetch.ts:171-198`). À reporter dans le fetcher Leads si on garde la
   colonne.
5. **Pagination** : Leads n'en a pas, Invitations oui. À unifier.
6. « Invitations en cours » = exactement le statut computed `sent` — vit
   entièrement dans `producer_invitations`, donc l'onglet **doit** lire cette
   table (pas un simple filtre sur les colonnes Leads).

**Voie d'attaque** : oui à l'absorption, mais en assumant un fetcher Leads
qui lit aussi `producer_invitations` et un modèle de liste unifié
(pagination + résolution lead↔invitation par email). Pas de blocage dur.

---

## 6. Page Gestion producteurs

**Fichiers** : `app/(admin)/gestion-producteurs/page.tsx` +
`_components/GestionProducteursClient.tsx`. Fetcher :
`lib/admin/producers/fetch.ts`.

### 6.1 Colonnes actuelles

| # | En-tête | Donnée | Source |
|---|---------|--------|--------|
| 1 | `Exploitation` | `nom_exploitation` + email (gris dessous) | `producers.nom_exploitation` + join `user:user_id(email)` |
| 2 | `Commune` | `commune (XX)` (XX = 2 chiffres CP) | `producers.commune` + `code_postal` |
| 3 | `Statut` | badge `ProducerStatusBadge` | `producers.statut` |
| 4 | `Abonnement` | Découverte/Pro/Premium | `producers.abonnement_niveau` |
| 5 | `Inscription` | date FR | `producers.created_at` |
| 6 | `Actions` | boutons selon statut | dérivé |

### 6.2 Comparaison avec la cible

| Cible | État | Détail |
|-------|------|--------|
| Exploitation (clic → page publique) | **PARTIEL** | nom affiché mais **non cliquable** ; lien `Voir page publique ↗` séparé, **seulement si statut=public** |
| Contact (nom/prénom) | **MANQUANT** | la query ne récupère pas `users.prenom`/`users.nom` ; seul `nom_exploitation` (raison sociale) |
| Email (clic → messagerie) | **PARTIEL** | email affiché mais **non cliquable** ; **aucune messagerie n'existe** dans l'app (ni `mailto:`) |
| Téléphone | **MANQUANT** | pas récupéré (le tel vit sur `users.telephone`, non joint) |
| Abonnement | **EXISTE** | colonne 4 |
| Date d'inscription | **EXISTE** | colonne 5 |
| Actions suspendre/réactiver | **EXISTE** | déjà implémentées (cf. 6.4) |

### 6.3 Filtres existants

Tabs `BASE_FILTERS` (`GestionProducteursClient.tsx:37-42`) : `Tous` /
`À valider` (pending) / `Actifs` (active **+** public) / `Suspendus`
(suspended). `EXTRA_FILTERS` si checkbox « Inclure brouillons et supprimés » :
`Brouillons` (draft) / `Supprimés` (deleted).

**Le filtre statut est local (`useState`, défaut `'all'`, ligne 88), PAS
synchronisé à l'URL.** Query params lus : `invite` (préremplit modal),
`user_id` (deep-link depuis audit-logs), `show_all`, `before`/`before_id`
(pagination). **Pas de `?status=`.** Le filtrage est appliqué en mémoire sur
la page courante (≤100 lignes), donc les counts de tabs sont des counts de
page, pas globaux. (Lié au bug §12.)

### 6.4 Action « suspendre » — déjà existante

Boutons : `pending` → `Valider` (→ active) ; `active`|`public` → `Suspendre`
(→ suspended) ; `suspended` → `Réactiver` (→ active). Mutation via
`PATCH /api/admin/producers/[id]/statut`.

**Valeurs réelles de `producers.statut`** (CHECK `producers_statut_check`) :
`{draft, pending, active, public, suspended, deleted}` — défaut `pending`.
Labels FR : Brouillon / En attente / Validé / Public / Suspendu / Supprimé.
Distribution prod : active=1, public=5, pending=3, deleted=2 (aucun draft ni
suspended actuellement). **L'état `suspended` existe déjà nativement dans
l'enum** — rien à ajouter côté schéma. Cycle : `active|public` → `suspended`
→ (réactiver) → `active` (note : repasse en `active`, pas directement
`public` — re-promotion nécessaire pour re-publier).

**Trigger `producers_block_owner_admin_columns`** : il bloque bien la colonne
`statut` (premier check, erreur `producers.statut is admin-only (T-218)`),
MAIS il a deux bypass en tête : `auth.role()='service_role'` **et**
`is_admin()`. La route PATCH utilise `createSupabaseAdminClient()`
(service_role) → bypass automatique. **Donc la doctrine
`set local request.jwt.claim.role='service_role'` ne s'applique PAS au flux
applicatif** (elle ne sert que pour un UPDATE manuel via SQL Studio/MCP). La
route fait aussi : pré-SELECT (404 + capture `before`), no-op si statut
identique, **audit log obligatoire** `admin_producer_statut_changed`, puis
revalidation des caches publics.

### 6.5 Effets de la non-publication (déjà implémentés)

Une suspension sort immédiatement le producteur du filtre `statut='public'`,
défendu en plusieurs couches :
1. **Page publique** (`lib/producers/fetch-public.ts:74-76`) : filtre strict
   `statut='public' AND deleted_at IS NULL` → sinon `notFound()` (404).
2. **Validation panier** (`app/api/cart/validate/route.ts`) : client
   user-scope RLS → les producteurs non-public ne reviennent pas, items
   marqués indisponibles (defense-in-depth admin suspend pendant checkout).
3. **Création PaymentIntent** (`app/api/stripe/create-payment-intent/route.ts:85-103`) :
   guard `stripe_charges_enabled` → 409 `producer_not_ready`.
4. **Promotion → public** (`lib/producers/promote-to-public.ts`) : gardée
   `.eq('statut','active')`.
5. **Cron weekly-badges** : ne calcule que `statut='active'`.

**Voie d'attaque** : l'action suspendre/réactiver est déjà complète et propre
(audit log + revalidation + bypass natif). Le travail refonte sur cette page
est surtout **UI/colonnes** (rendre l'exploitation cliquable, ajouter contact
nom/prénom + téléphone via join `users`, brancher l'email sur la future
messagerie/`mailto:`).

---

## 7. Page Utilisateurs (à éclater)

**Fichiers** : `app/(admin)/users/page.tsx`, `_components/UsersListFilters.tsx`,
`[id]/page.tsx`, `[id]/_components/UserDetailTabs.tsx`. Fetcher :
`lib/admin/users/fetch.ts`. **Surface = visualisation seule (aucune
mutation, aucun audit).**

### 7.1 Filtrage par rôle (existant)

Tabs : `Tous` / `Consumers` / `Producteurs` / `Admins`
(`UsersListFilters.tsx:9-14`), via `<Link href="?role=...">` (param `role`
parsé serveur). Logique SQL (`fetch.ts:84-109`) :
- **admin** : sens inversé — récupère `admin_users.id` puis `.in("id", ids)`.
- **producer** : `.contains("roles", ["producer"])` sur `users.roles`.
- **consumer** : `.not("roles","cs","{producer}")` (strict = pas producer).
- **all** : aucun filtre.
Dérivation affichée (`deriveRole`) : précédence admin > producer > consumer.

### 7.2 Source de données par rôle

| Rôle | Table source | Détail |
|------|--------------|--------|
| Consumers | `public.users` | users dont `roles[]` ne contient pas `producer` |
| Producers | `public.users` | présence de `producer` dans `users.roles` (PAS la table `producers`) |
| Admins | `public.admin_users` | whitelist séparée ; `admin_users.id` = PK = FK `auth.users(id)` (pas de colonne `user_id`) |

Enrichissements (parallèles, fail-safe) : `auth.users.last_sign_in_at` via
`.schema("auth")`, count `orders` par `consumer_id`. **Tout en service_role**
(pas de policy admin RLS sur `public.users`).

`public.users` : `id, email, prenom, nom, telephone, sms_optin, created_at,
roles[], stripe_customer_id, cgu_accepted_at, cgu_version`.
`public.admin_users` : `id, email, prenom, nom, created_at` (5 colonnes, pas
de statut, pas de niveau de privilège).

### 7.3 Action « Voir »

Bouton `Voir` → `/users/[id]`. Page détail = 4 onglets : **Profil** (email,
nom, téléphone, sms_optin, roles, inscription, dernière connexion, email/tel
confirmés), **Commandes** (orders du consumer), **Reviews**, **Notifications**.
Orientés **consumer**. Utile à conserver pour la future page « Comptes
consommateurs ». Pour la future page Admins, ces onglets sont peu pertinents
(il faudrait plutôt : actions admin auditées, dernière connexion, statut).

### 7.4 Pour la future page Admins — ce qui existe

- **Table `admin_users`** : 5 colonnes (cf. ci-dessus). **Pas** de colonne
  statut/suspended, **pas** de niveau de privilège (tous égaux).
- **Triggers** : `admin_users_exclusive_with_users` (un `auth.users.id` ne
  peut être à la fois dans `users` ET `admin_users`) ;
  `admin_users_revoke_role_snapshot` (AFTER INSERT/DELETE → invalide le cache
  rôle middleware).
- **RLS** : une seule policy `admin_users self read` (SELECT `id=auth.uid()`).
  Aucune policy write → création/suppression uniquement en service_role.
- **Flux de création d'admin : AUCUN flux applicatif.** Pas de route API, pas
  de script, pas d'UI. La création se fait **manuellement en DB** (INSERT
  direct après création du compte `auth.users`).
- **Suspension d'admin : AUCUNE.** Pas de colonne, pas de flux. La seule
  « désactivation » = DELETE de la row (déclenche révocation snapshot).
- **Audit du cycle de vie admin : ABSENT.** Il existe des events admin par
  action (`admin_login`, `admin_producer_statut_changed`, etc.) mais **aucun**
  `admin_created` / `admin_suspended` / `admin_deleted`. Les créations/
  suppressions manuelles ne sont pas auditées.

**Voie d'attaque** : la page Admins est le plus gros chantier « from
scratch » de la refonte. Il faut concevoir : table (ajout `suspended_at` ?
ou colonne statut ?), routes API create/suspend, UI, audit events, et
gérer le trigger d'exclusion mutuelle + la révocation snapshot à la
création/suspension.

**Question à Romain** : pour suspendre un admin, on ajoute une colonne
`suspended_at` à `admin_users` (l'admin reste dans la whitelist mais le
middleware le rejette si suspendu) ou on se contente de DELETE/re-INSERT ?
La 1ère option est plus propre (traçable, réversible, auditable) mais
demande de modifier la logique `isAdmin()` partout où elle est lue.

---

## 8. Section Consommateurs

### 8.1 Suivi commandes (`/suivi-commandes`)

**Fichiers** : `app/(admin)/suivi-commandes/page.tsx` (query **inline**, pas
de lib) + `SuiviCommandesClient.tsx`. Source : SELECT direct service_role sur
`orders` (200 dernières, `page.tsx:23-32`), filtrage/recherche/export **en
local côté client**.
- KPIs : `Commandes aujourd'hui`, `CA semaine en cours`, `Taux de complétion`.
- Colonnes : N° / Client / Producteur / Créneau / Statut / Total.
- Filtres : Toutes / À confirmer / Confirmées / Terminées / Annulées +
  pseudo-statuts (Tentatives échouées, Bloquées stock, Bloquées créneau,
  dérivés de `cancelled` + `closure_reason`).
- Actions : recherche texte, export CSV. **Aucune mutation.**

### 8.2 Refunds en attente (`/refunds/pending`)

**Fichiers** : `page.tsx` (query inline) + `_components/PendingRefundsClient.tsx`
+ `_actions/decide.tsx`. Source : SELECT direct sur `pending_refunds`.
- Affichage en 2 sections de cartes : **En attente** + **Historique**. Champs
  par carte : code commande, montant (`amount_eur` €), producteur, date,
  motif producteur (`reason`) / motif décision.
- Statuts : `En attente` / `Approuvé` / `Refusé` / `Expiré (7j)`.
- **Actions (mutations réelles)** : Refuser / Approuver+refund (server
  actions `denyPendingRefund` / `approvePendingRefund`). L'approbation
  déclenche `executeRefundFlow` (refund Stripe immédiat) + email producteur +
  audit log `producer_refund_admin_approved/denied`.
- Badge sidebar = count `pending`.

### 8.3 Incidents refund (`/refund-incidents` + `[id]`)

**Fichiers** : `page.tsx` + `_components/RefundIncidentsListClient.tsx` ;
détail `[id]/page.tsx` + `_components/ResolveIncidentModal.tsx`. **Lib
dédiée** : `lib/admin/refund-incidents/fetch.ts`. Mutation :
`POST /api/admin/refund-incidents/[id]/resolve`.
- Liste : Code commande / Montant (dérivé `orders.montant_total`) / Statut /
  Tentatives (retry/max) / Dernière erreur / Créé le / lien Détails.
- Filtres : En attente / Retry en cours / Échec / Résolus (auto) / Résolus
  (admin) / Tous (défaut = pending).
- Détail : kind, statut, PaymentIntent, tentatives, premier échec, erreurs,
  blocked_reason, résolution + table `refund_incident_attempts`.
- Action : « Marquer comme résolu manuellement » (note ≥5 car.), si statut
  `pending`/`retrying`.

### 8.4 Schémas DB

`pending_refunds` : `id, order_id, producer_id, amount_eur, reason, status
(enum pending_refund_status: pending/approved/denied/expired), requested_at,
decided_at, decided_by, decision_reason, created_at, updated_at`.
FK : order_id→orders, producer_id→producers, decided_by→auth.users.

`refund_incidents` : `id, order_id, kind (revival/admin/timeout/manual_cancel),
payment_intent_id, consumer_id, status (text: pending/retrying/succeeded/
exhausted/manually_resolved/aborted), retry_count, max_retries,
last_error_code, last_error_message, blocked_reason, resolution_note,
first_failed_event_at, resolved_at, created_at, updated_at`. UNIQUE
`(order_id, kind)`.

### 8.5 Faisabilité fusion « Remboursements »

Ce ne sont **pas deux vues de la même chose** mais deux étapes/sources du
domaine refund :
- `pending_refunds` = **file d'arbitrage admin** (demande producteur > cap,
  alimentée par le producteur, décidée par l'admin).
- `refund_incidents` = **file technique d'échec/retry Stripe** (alimentée par
  le webhook Stripe + cron retry, pas par une demande).

| Concept | pending_refunds | refund_incidents | Partagé ? |
|---------|-----------------|------------------|-----------|
| Commande | `order_id`→orders | `order_id`→orders | **Oui (même FK)** |
| Producteur | `producer_id` | *(via order_id→orders.producer_id)* | Non direct |
| Consommateur | *(via order)* | `consumer_id` | Non direct |
| Montant | `amount_eur` (propre) | dérivé `orders.montant_total` | concept commun, repr. différentes |
| Statut | enum (4 valeurs) | text (6 valeurs) | concept commun, **valeurs disjointes** |
| Décision/résolution | `decision_reason` | `resolution_note`+`blocked_reason` | concept commun |
| Horodatage résolution | `decided_at` | `resolved_at` | concept commun |

**Modèle d'unification réaliste** : page « Remboursements » à **deux onglets
sous une nav commune** (« Demandes à arbitrer » = pending_refunds, garde
Approuver/Refuser ; « Incidents techniques » = refund_incidents, garde
résolution manuelle), reliés sur `order_id`. Vue liste unifiée optionnelle
via projection `{id, order_id, order_code, amount, status_label,
source:'request'|'incident', created_at, action_url}`. Le badge sidebar
pourrait agréger `pending_refunds.pending + refund_incidents.{pending,retrying}`.
**Ne PAS fusionner les colonnes `status`** (espaces de valeurs incompatibles
+ déclencheurs distincts → on créerait des états illégaux). Unifier en
**présentation/route**, pas en schéma. Bonus refonte : factoriser les deux
queries inline (suivi-commandes + refunds/pending) dans `lib/admin/`.

### 8.6 Base pour « Comptes consommateurs »

**Oui, exploitable directement.** `public.users` a une colonne `roles[]`.
Comptage : 12 consumers, 10 producers. Le listing existe déjà via
`fetchAdminUsersList(roleFilter:"consumer")`, et le détail `/users/[id]`
(onglets commandes/reviews/notifications) est déjà orienté consumer. Source :
`public.users` filtrée consumer en service_role. **Arbitrage** : définition de
« consommateur » — le filtre actuel = « non-producteur » (`NOT contains
producer`), alors que `'consumer' = ANY(roles)` = « porte explicitement le
tag consumer ». Un user `{consumer, producer}` est rangé producer par le
listing. À trancher.

---

## 9. Mails

### 9.1 État actuel : rien côté admin

**Aucune page « Mails » n'existe dans l'admin.** Le mot n'apparaît pas dans la
sidebar. C'est un chantier 100% nouveau.

### 9.2 Infrastructure email existante (à réutiliser)

**Sortant (outbound)** — via Resend :
- From : `RESEND_FROM_EMAIL` (= `no-reply@terroir-local.fr`,
  `lib/resend/client.ts`). Auth (magic link, reset) part de
  `auth@send.terroir-local.fr` (sous-domaine DKIM authentifié — ne pas
  régresser, cf. CLAUDE.md).
- ~30 templates dans `lib/resend/templates/`.
- **Chaque envoi est loggé dans `public.notifications`** (`lib/resend/send.ts`).
  Schéma `notifications` : `id, user_id, type, template, statut, metadata
  (jsonb), created_at`. RLS = owner read (l'admin lit en service_role : déjà
  exposé par onglet dans `/users/[id]`).
- **Webhook Resend entrant branché** : `app/api/webhooks/resend/route.ts`
  (signature Svix). Gère les events **de délivrabilité sortante** :
  `email.delivered` (→ `metadata.delivered_at`), `email.bounced` (→
  `email_suppressions` hard/soft + audit `email_hard_bounce_suppressed`),
  `email.complained` (→ suppression + audit `email_complaint_received`),
  `email.delivery_delayed`. Pas de tracking open/click (V1).
- Table `email_suppressions` : `email, reason, soft_bounce_count,
  source_resend_id, created_at, updated_at`.

**Entrant (inbound)** — partiel, hors Resend :
- Le formulaire de contact public (`app/api/contact/route.tsx`) envoie vers
  **`contact@terroir-local.fr`**, décrit en commentaire (`route.tsx:29`) comme
  une **mailbox Zimbra OVH** (Reply-To = email du visiteur). Donc il existe
  **une vraie boîte mail OVH/Zimbra** pour ce domaine (IMAP-capable).
- `SUPPORT_EMAIL` (ex. `admin@terroir-local.fr`) et `OPS_EMAIL` reçoivent les
  alertes business/techniques. Ce sont des inboxes destinataires.

### 9.3 Études préliminaires (rapport seulement)

**Boîtes IMAP des adresses concernées** : `contact@terroir-local.fr` est une
mailbox OVH/Zimbra → **IMAP disponible** (OVH/Zimbra expose IMAP/SMTP
standard). Faisabilité d'une vue admin « inbox » via IMAP : techniquement
possible (lib IMAP Node côté serveur, identifiants en env), mais lourd (état
de lecture, pagination, sécurité des credentials, pas de webhook → polling).
`auth@send.terroir-local.fr` est un **sous-domaine d'envoi Resend**, pas une
mailbox de réception : les réponses qui y arriveraient n'ont pas de boîte
dédiée (à vérifier côté config DNS/Resend).

**Logs des emails sortants** : déjà disponibles **sans rien construire** côté
DB via `public.notifications` (template, statut, metadata.delivered_at/
delayed_at, resend_id) + `email_suppressions` + events `audit_logs`. Une vue
admin « emails envoyés » se branche directement dessus en service_role. C'est
la voie la plus simple pour la moitié « consommateurs/producteurs » d'un
écran Mails côté **sortant**.

**Vue inbox Resend** : le dashboard Resend offre déjà une vue « Logs/Emails »
des envois (recherchable) — mais c'est le dashboard Resend, pas une vue
in-app. Resend propose aussi désormais une fonctionnalité **inbound email
(réception)**, mais elle nécessite de pointer les **MX du domaine vers
Resend**, ce qui **entrerait en conflit avec les MX OVH/Zimbra existants**
(`contact@`). Donc inbound-via-Resend = décision DNS structurante,
incompatible avec la mailbox OVH actuelle sans migration.

**Emails entrants (réponses producteurs/consommateurs)** : aujourd'hui, une
réponse à un email transactionnel part vers le `From`/`Reply-To` configuré.
Il n'existe **aucune capture/stockage in-app des emails entrants**. Pour les
capter, deux pistes : (a) IMAP polling sur la/les mailbox(es) OVH, parsing +
INSERT dans une nouvelle table `inbound_emails` ; (b) bascule MX vers un
service inbound (Resend inbound, ou un webhook type Postmark/Mailgun) qui POST
les emails reçus → INSERT. Les deux demandent une nouvelle table de stockage
et une décision sur le rattachement (par email → user/lead).

**Question à Romain** : la vision « Mails » dans l'admin, c'est plutôt (a)
une **vue lecture des emails sortants** (faisable vite sur `notifications`), ou
(b) une **vraie messagerie bidirectionnelle** (lire les réponses entrantes,
voire répondre depuis l'admin) ? La (b) implique une décision DNS/MX
structurante et une table de stockage entrant — gros chantier. Savoir lequel
des deux cadre le sous-chantier.

---

## 10. Données variables / Référentiels

### 10.1 Prix GMS (`/gms-prices`)

« GMS » = Grande et Moyenne Surface (prix supermarché de comparaison,
affichés publiquement sur `/notre-demarche`). **Fichiers** : `page.tsx`
(`use client`, READ direct browser client sur `gms_prices`, WRITE via
`/api/admin/gms-prices/*`) + modals Create/Edit/MonthlyUpdate. Fetcher public :
`lib/gms-prices/fetch-active.ts`.

Affiche : Référence (libellé+slug) / Filière (bovin/porcin/ovin) / Prix GMS
(€/kg) / Prix TerrOir (min-max-moyen) / Mois ref. / Statut (Active/Archivée) /
Actions. Permet : **Créer**, **Éditer** (champs structurants verrouillés :
slug, filière, prix GMS, mois), **Mise à jour mensuelle** (workflow dédié →
UPDATE live + INSERT snapshot dans `gms_prices_history`), **Archiver/Restaurer**
(soft delete).

Schéma `gms_prices` : `id, slug, filiere, libelle, description_courte,
prix_gms_kg, prix_terroir_kg_min/max/moyen, mois_reference, source,
source_url, ordre_affichage, notes_admin, active, created_at, updated_at,
updated_by`.
Schéma `gms_prices_history` : `id, reference_id (FK), mois_reference,
prix_gms_kg, prix_terroir_kg_moyen, source, source_url, created_at`.

### 10.2 Catégorisation — la division existe DÉJÀ

**Confirmé : catégories / espèces animales / morceaux existent déjà comme
trois pages séparées** (chantier T-130) :

1. **Catégories produits** (`/categorisation/categories`) : table
   `product_categories` (`id, slug, name, sort_order, created_at`). DELETE
   bloqué si `products.category_id` référencés.
2. **Espèces animales** (`/categorisation/animaux`) : table `animals` (même
   structure). DELETE bloqué si `products.animal_id` OU `cuts.animal_id`
   référencés (garde-fou bidimensionnel).
3. **Morceaux** (`/categorisation/morceaux`) : table `cuts` (`id, animal_id,
   slug, name, sort_order, created_at`). Select `animal_id` obligatoire,
   UNIQUE `(animal_id, slug)`. Deep-link `?animal=<slug>`.

Composants partagés : `SimpleEntityFormModal` (catégories + animaux),
`CutFormModal` (morceaux + select animal), `_lib/format-deps.ts`.

**Relations FK** : `cuts.animal_id`→`animals.id` ; `products.category_id`→
`product_categories.id` ; `products.animal_id`→`animals.id` ;
`products.cut_id`→`cuts.id`. Arbre : catégories et espèces = deux axes
orthogonaux taggant `products` ; morceaux = sous-axe de l'espèce.

**Voie d'attaque** : la cible « Référentiels › Catégorisation
(catégories/espèces/morceaux) » est déjà entièrement en place
fonctionnellement. Le travail refonte est de **regroupement de nav**
(passer les 3 pages + Prix GMS sous une section « Référentiels ») et de
nommage, pas de création de modèle.

---

## 11. Dashboard producteur (côté pro.)

**Fichiers** : `app/(producer)/dashboard/page.tsx` (Server Component) +
`DashboardClient.tsx`. (Détail exhaustif dans
`docs/audits/producer-dashboard-2026-05.md`.)

**Source** : une **RPC SECDEF unique** `get_producer_dashboard` (F-045,
remplace 11 queries Promise.all), `page.tsx:76-93`. Toutes les bornes
temporelles sont calculées côté serveur à partir de `now = new Date()` et
passées en paramètres (today, yesterday, week_start/end, last_week, plage
slots).

**Vue actuelle** : c'est un **snapshot de la semaine en cours**, pas une vue
paginée navigable :
- KPIs « aujourd'hui » : `orders_today` vs `orders_yesterday`.
- KPIs « semaine » : `revenueWeek` (semaine en cours) vs `revenueLastWeek`
  (semaine précédente) — un **delta figé**, pas une navigation.
- Planning visuel 7 jours (`weekPlanning`, `page.tsx:210-224`) calé sur
  `startOfWeek(now)` — **toujours la semaine courante**.

**Navigation entre périodes (semaine précédente/suivante) : ABSENTE.**
`weekStart = startOfWeek(now)` est figé sur l'instant courant ; la page ne lit
aucun query param d'offset de semaine, la RPC reçoit des dates calculées une
seule fois. Pas de pagination par semaine ni par mois. (Côté revenus, la page
`/revenus` affiche un graphe 8 semaines en barres, mais non navigable non
plus.)

**Voie d'attaque** (si la refonte veut une navigation par période côté pro) :
ajouter un offset de semaine en query param, le propager à la RPC (déjà
paramétrée par dates → faible coût), et un sélecteur prev/next dans
`DashboardClient`.

---

## 12. Journal d'audit — bug du filtre « à valider »

**Fichiers** : `app/(admin)/audit-logs/page.tsx` + `_lib/build-producer-href.ts`,
`parse-search-params.ts`, `categorize-event-type.ts` + `_components/`.

### 12.1 Ce qu'affiche le journal + liens cliquables

4 cartes stats + filtres (email, user_id, dates, event_type, export CSV) +
table (Date / Event / User / IP / User-Agent / Metadata) + pagination cursor.

**Seul drill-down vers une autre page admin** : dans la colonne « User », un
badge **« Prod »** cliquable apparaît uniquement si le `user_id` a une ligne
dans `producers` (`AuditLogsTable.tsx:76-77, 106-113`), via
`buildProducerHref(userId)`. Contenu verbatim :

```ts
export function buildProducerHref(userId: string): string {
  return `/gestion-producteurs?user_id=${encodeURIComponent(userId)}`;
}
```

→ produit `/gestion-producteurs?user_id=<UUID>` : un deep-link qui pré-filtre
la liste producteurs sur **un user_id précis** (et **non** sur un statut).

### 12.2 Le lien « producteurs à valider »

La carte cockpit « Producteurs à valider » du dashboard
(`tableau-de-bord/page.tsx:84`) pointe vers `/gestion-producteurs`
**nu, sans aucun query param**. Inventaire complet des hrefs vers
`gestion-producteurs` : aucun ne passe `?status=` / `?filter=`. Les seuls
params jamais transmis sont `user_id` (audit-logs), `invite` (leads),
`show_all`/`before`/`before_id` (pagination interne).

### 12.3 Comment Gestion producteurs consomme les query params

Côté serveur (`gestion-producteurs/page.tsx`), le type `SearchParams` ne
déclare que `before, before_id, show_all, invite, user_id` — **pas de
`status`**. Côté client, les seuls `searchParams.get(...)` sont :
- `searchParams.get('invite')` (`GestionProducteursClient.tsx:133`)
- `searchParams.get('user_id')` (`GestionProducteursClient.tsx:145`)

Le filtre statut est un `useState` local : `useState<ProducerStatusFilter>('all')`
(ligne 88). Le tab « À valider » existe (`value:'pending'`, label « À
valider », lignes 37-42) mais n'est changé **que par clic** (`onChange={setFilter}`).

### 12.4 Diagnostic du bug

**Le param de présélection du filtre n'existe pas et n'est pas lu ; le filtre
démarre toujours sur « Tous ».** Concrètement :
- Cliquer la carte dashboard « Producteurs à valider » ouvre
  `/gestion-producteurs` sur l'onglet **« Tous »**, pas « À valider ».
  L'admin doit re-cliquer manuellement le tab.
- Même si un lien passait `?status=pending`, **le param serait ignoré** (non
  consommé côté client, non déclaré côté serveur).
- Le param qu'il faudrait = `?status=pending` (ou `?filter=pending`), lu pour
  initialiser le `useState`.

**Limite annexe (indépendante du param)** : le filtrage s'applique sur
`initialProducers` = la page courante (~100 lignes max). Le count « à valider »
du dashboard et la liste filtrée peuvent diverger si les producteurs en
attente débordent de la première page.

**Voie d'attaque** (cohérente avec le code existant) : faire lire au client un
param `?status=` validé contre `ProducerStatusFilter` pour initialiser le
`useState`, l'ajouter au type `SearchParams` serveur, et faire pointer la
carte dashboard vers `/gestion-producteurs?status=pending`. Le pattern de
lecture URL réactive existe déjà juste à côté (`user_id`, lignes 145-147).

---

## Annexe — Points qui sentent mauvais (flag direct)

- **Dashboard ↔ sidebar incohérents** (§2.1) : cartes « Incidents refund » et
  « Invitations expirées » marquées « Page à venir » (href `#`) alors que les
  pages existent et sont dans la sidebar. Cosmétique mais trompeur.
- **Comptes admin non audit?** (§7.4) : création/suppression d'admin = INSERT/
  DELETE manuels en DB, **non audités**, **non auditables** via l'app. Pour un
  back-office, l'absence totale de traçabilité du cycle de vie des comptes
  admin est un trou de gouvernance. À combler dans le chantier « page Admins ».
- **Deux queries inline non factorisées** (§8.5) : suivi-commandes et
  refunds/pending chargent leurs données en SELECT inline dans la page (pas de
  lib). À factoriser pendant la fusion Remboursements.
- **Mails entrants = angle mort** (§9.3) : aucune capture in-app des réponses ;
  toute « messagerie » suppose une décision DNS/MX structurante.

---

*Fin de l'audit. Aucune modification de code effectuée. Toutes les requêtes
DB étaient des SELECT en lecture seule via MCP Supabase.*
