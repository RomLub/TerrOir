# CHANGELOG — TerrOir

Historique des chantiers et commits structurants. Ordre antichronologique (plus récent en haut).

Pour la doctrine d'exécution (règles d'or + workflow), voir [`CLAUDE.md`](../CLAUDE.md) à la racine.
Pour les actions conditionnées en attente, voir [`post-launch-checklist.md`](./post-launch-checklist.md).
Pour les leçons apprises transversales, voir [`LESSONS.md`](./LESSONS.md).
Pour les décisions structurantes (ADRs), voir [`decisions/`](./decisions/).

---

## 2026-05-25 (Perf — navigation instantanée : cadre persistant, fin de l'écran intermédiaire)

> PR `perf/instant-navigation`. Supprime l'écran de chargement plein écran affiché à chaque clic dans les espaces connectés (acheteur/compte, producteur, admin). Approche standard « comme Amazon/Gmail » — voir [ADR-0013](./decisions/0013-latence-navigation-streaming-suspense.md) (mise à jour 2026-05-25).
>
> 🟢 **Cadre persistant** : suppression des `loading.tsx` de groupe (producer/admin/compte) → le layout (navbar/sidebar) reste affiché en permanence, au clic **seul le contenu se rafraîchit** (Suspense + pattern Gate : page synchrone, session/searchParams/fetch lus dans le flux). 29 pages acheteur + admin converties ; le producteur (déjà Gate via #184) profite de la suppression de son `loading.tsx`.
>
> 🟡 **cacheComponents (PPR Next 16) ÉVALUÉ puis ÉCARTÉ** : conflit avec la CSP nonce par requête (incompatible avec un shell statique) + nécessiterait de revoir la fondation d'auth (flash d'état connecté) + les pages connectées ne doivent PAS être mises en cache (vie privée, fuite inter-utilisateur). On garde l'approche standard. Détail dans ADR-0013.
>
> 🟢 **Vie privée / sécurité** : aucune page connectée mise en cache. Auth (getClaims) + CSP inchangés.
>
> 🟢 **Méthode** : Agent Teams (équipiers acheteur / admin + corrections de tests) coordonnés par le lead.
>
> 🟢 Tests : 7 fichiers de tests pages adaptés au pattern Gate (résolution Gate→Content, assertions métier inchangées). lint / type-check / build OK, `npm test` vert (3109).

---

## 2026-05-24 (Perf — latence navigation : streaming Suspense + getClaims)

> PR `perf/latence-navigation`. Supprime le skeleton plein écran qui clignotait de façon furtive entre deux clics + réduit la latence de navigation perçue. Voir [ADR-0013](./decisions/0013-latence-navigation-streaming-suspense.md). Constat audit : la base répond en 20-30 ms ; le coût était dans la vérification de session (appel réseau par requête) et le rendu dynamique sans préfetch, pas dans les données.
>
> 🟢 **Lot A — getClaims** : `middleware.ts` + `getSessionUser` / `getInitialUserPayload` passent de `getUser()` (aller-retour réseau vers l'Auth server à chaque requête) à `getClaims()` (validation cryptographique **locale** du JWT, clés asymétriques ES256). Zéro appel réseau de session par clic. Comportement, types de retour et lookups rôles/admin inchangés ; fail-closed conservé.
>
> 🟢 **Lot B — streaming Suspense** : les pages retournent leur chrome instantanément et streament les données lourdes derrière des `<Suspense>` (au lieu d'un skeleton plein écran à chaque clic). Les `loading.tsx` de groupe réduits à la zone `<main>` → sidebar/header fixes entre clics. Espaces producteur/consumer/admin + pages publiques. Accueil rendu préfetchable (bannière `compte-supprime` déportée en Client Component sous Suspense).
>
> 🟢 **Lot C — cache pages publiques** : `producteurs/[slug]` revalidate=30, `notre-demarche` revalidate=300 (staleness ≤ 5 min acceptée, page éducative). Fiche produit reste dynamique (stock live) mais shell streamé.
>
> 🟡 **Lot D (cacheComponents / PPR Next 16) — DIFFÉRÉ** en chantier dédié (cf. ADR-0013). Migration globale ~50 fichiers (toute la couche auth) + risque de **fuite inter-utilisateur** si une donnée privée est marquée `'use cache'` partagée (build vert, fuite runtime). Décision Romain après pushback CC : on livre A+B+C, D fera l'objet d'une revue de portée de cache + test de chaque parcours de connexion. Les frontières Suspense posées par B/C en sont le prérequis.
>
> 🟢 **Méthode** : Agent Teams (`terroir-perf`) — 3 équipiers en parallèle à fichiers disjoints (auth / public / espaces privés) + lead pour l'intégration et la validation.
>
> 🟢 Tests : lint / type-check / build OK, `npm test` vert (3109).

---

## 2026-05-24 (Auth — SSO admin : une seule saisie de mot de passe)

> PR `feat/admin-sso-handoff`. Corrige le double-login admin : un admin qui se connecte sur l'écran classique (www/pro) devait re-saisir son mot de passe sur admin.\* (cookie isolé par design).
>
> 🟢 **Handoff jeton** : après vérif du mot de passe, si l'utilisateur est admin et se connecte sur un host PROD www/pro, `loginAction` génère un **jeton magic-link à usage unique** pour sa propre adresse (`supabase.auth.admin.generateLink`) et redirige vers le callback admin.\* (qui pose le cookie isolé). **Une seule saisie**, pas d'email. Réutilise le mécanisme chantier 1 sans l'email.
>
> 🟢 **Sécu — aucune régression** : niveau identique à un login mot-de-passe direct sur admin.\* (jeton usage unique + courte durée + adresse de la session) ; isolation cookie préservée (admin.\* garde son cookie isolé). **Fail-safe** : si la génération échoue → redirect normal (comportement actuel, 2 logins). Gate sur hosts PROD www/pro uniquement (dev/preview = login unique natif, pas d'isolation).
>
> 🟢 Tests : handoff admin www/pro, pas de handoff sur admin.\*/non-admin, fail-safe. lint/type-check/build OK, `npm test` vert (2971).

---

## 2026-05-24 (Refonte admin — Chantier 9 : boîte Mails admin)

> PR `feature/chantier-9-mails`. Réception + réponse aux emails entrants `contact@`. Voir [ADR-0010](./decisions/0010-emails-entrants-boite-admin.md) (option A : MX OVH + polling IMAP, arbitrée par Romain).
>
> 🟢 **Ingestion IMAP** (`lib/admin/inbound/imap-fetch`, imapflow + mailparser) : cron `/api/cron/fetch-inbound`, **désactivé par défaut** (`INBOUND_EMAIL_CRON_ENABLED=false` — Romain l'active après config IMAP + test). Lecture seule, **checkpoint UID** (reprise, pas de réimport ; premier run cale sur `uidNext-1`), **dédup Message-ID**, cap 50/run, gestion UIDVALIDITY. ⚠️ Cadence calée sur **quotidien** (`0 7 * * *`) : Vercel **Hobby** limite les crons à 1×/jour ; le 10 min arbitré nécessite Vercel Pro ou un scheduler externe (décision cadence à trancher).
>
> 🟢 **Tables** : `inbound_email_accounts` (config + checkpoint par adresse — **multi-adresses ready**, seed `contact@`) + `inbound_emails` (Message-ID unique, tag, lookups, read/replied). RLS admin-read.
>
> 🟢 **Tag automatique** : expéditeur → `producteur` (rôle producer ou lead), `consommateur`, ou `public` (inconnu).
>
> 🟢 **UI « Mails »** (top niveau sidebar, usage haute fréquence) : onglets Producteurs / Consommateurs / **Public** (+ badges non-lus), détail (marqué lu à l'ouverture), **réponse depuis contact@** (Resend, threading In-Reply-To/References, préremplissage To + « Re: » + message cité).
>
> 🟢 **Envoi `from: contact@`** : vérifié — domaine racine Resend déjà vérifié (DKIM+SPF), aucun DNS à modifier. Audit `inbound_email_replied`.
>
> 🟢 Deps : `imapflow` + `mailparser`. Env : `IMAP_HOST/PORT/USER/PASSWORD` + `INBOUND_EMAIL_CRON_ENABLED` (cf. `.env.example`).
>
> 🟢 Tests : tag, imap-fetch (clean start + fetch + dédup + UIDVALIDITY), reply (envoi + threading + audit), fetch (mapping + non-lus), routes (cron gate désactivé/auth + reply gate), sidebar. Migration appliquée (tables + seed). lint/type-check/build OK, `npm test` vert (2953).

---

## 2026-05-24 (Refonte admin — Chantier 8 : Litiges Stripe)

> PR `feature/chantier-8-litiges`. Surface admin de gestion des litiges (chargebacks). Le backend existait déjà (table `disputes`, webhook `charge.dispute.*` + early-fraud, emails d'alerte, cron deadline) — ce chantier ajoute l'UI + la soumission de preuves.
>
> 🟢 **Page Litiges** (`/litiges`, section Gouvernance) : liste depuis la table `disputes` (commande, statut FR, motif, montant, échéance, ouvert le), ouverts en premier.
>
> 🟢 **Détail** (`/litiges/[id]`) : fiche DB + **état live Stripe** (`stripe.disputes.retrieve` — échéance, nb de soumissions, preuves préremplies). Fail-safe si l'API échoue.
>
> 🟢 **Soumission de preuves** : formulaire (description produit, nom/email client, date de retrait, texte libre). « Enregistrer le brouillon » (`submit:false`) vs « Soumettre définitivement » (`submit:true`, confirmation, irréversible) via `stripe.disputes.update`. Garde : seuls les litiges `needs_response`/`warning_needs_response` acceptent des preuves ; soumission vide refusée. MAJ optimiste du statut (le webhook confirme). Audit `stripe_dispute_evidence_saved`/`submitted`.
>
> 🟢 **Carte dashboard « Litiges ouverts »** branchée sur `/litiges` (plus « Page à venir »).
>
> 🟢 Tests : fetch (liste + live Stripe), submit-evidence (gardes + brouillon/soumission + statut optimiste + échec Stripe), route (gate admin + normalisation), sidebar. **Pas de migration** (table + RPC + webhook préexistants ; events texte). lint/type-check/build OK, `npm test` vert (2931).

---

## 2026-05-23 (Refonte admin — Chantier 6 : page Administrateurs, sécu critique)

> PR `feature/chantier-6-admins`. Gestion du cycle de vie des comptes admins. Voir [ADR-0009](./decisions/0009-modele-comptes-admins.md). **Migration appliquée + smoke-testée en prod.**
>
> 🟢 **Deux niveaux** (`admin_privilege` enum) : `super_admin` (gère les autres admins) / `standard` (opérationnel, mais lecture seule sur les comptes admins). Bootstrap : admins existants → super_admin.
>
> 🟢 **Suspension** (`suspended_at`) : `isAdmin` = présent dans admin_users ET non suspendu, dérivé aux 4 points (getSessionUser, isAdmin, getInitialUserPayload, middleware). Le trigger de révocation du snapshot de rôle est étendu à `UPDATE OF suspended_at` (sinon accès résiduel via snapshot caché). `isSuperAdmin` toujours lu en live.
>
> 🟢 **Promotion / retrait = MOVE atomique** entre `public.users` et `admin_users` (exclusivité mutuelle) via RPC SECURITY DEFINER (`admin_promote_user`, `admin_revoke`, `admin_suspend`, `admin_reactivate`, `admin_set_privilege`) — atomicité obligatoire. Identité de connexion (`auth.users`) préservée. « Retirer » garde le compte client.
>
> 🟢 **Gardes sécu** : pas d'auto-action (suspend/retrait/rétrograder soi-même — garde RPC + boutons désactivés UI + tooltip) ; le **dernier super_admin actif** ne peut être ni suspendu, ni retiré, ni rétrogradé ; toutes les actions auditées (cluster `admin_accounts`).
>
> 🟢 **Mur FK promotion** : un compte avec activité client (commandes/avis/producteur) ne peut être promu (DELETE users bloqué) → refus `has_client_activity` + message clair. Adresses admin dédiées (cf. ADR).
>
> 🟢 **5 emails** de notification (template `admin-lifecycle` paramétré) : promotion / suspension / retrait / changement de niveau / réactivation.
>
> 🟢 **`/users` LIST supprimé** (consumers → Comptes consommateurs ch.5, admins → Administrateurs). Détail partagé `/users/[id]` conservé.
>
> 🟢 Tests : RPC (smoke prod gardes + move), operations (mapping + email/audit), routes (gate super_admin + erreurs), AdminsClient (lecture seule standard + self-row désactivée), session (suspendu/super), fetch, template email. lint/type-check/build OK, `npm test` vert (2910).

---

## 2026-05-23 (Refonte admin — Chantier 5 : Consommateurs)

> PR `feature/chantier-5-consommateurs`. Réorganisation de la section Consommateurs : fusion des remboursements, page comptes consommateurs, factorisation des queries.
>
> 🟢 **Remboursements fusionnés** : une seule section à deux onglets (`RefundsTabNav`) — « Demandes à arbitrer » (`/refunds/pending`) + « Incidents techniques » (`/refund-incidents`). Onglets implémentés comme deux routes (deep-linkables, back-button natif) plutôt qu'un état JS. Sidebar : une seule entrée « Remboursements » avec **badge agrégé** (demandes en attente + incidents actifs pending/retrying), calculé par `fetchRefundsBadgeCount`.
>
> 🟢 **Comptes consommateurs** (nouvelle page `/comptes-consommateurs`) : set `consumer_inclusive` = tout compte ayant le rôle consommateur, **double-rôle producteur+conso inclus** (présents ici ET dans /gestion-producteurs). Vérifié en prod : 10/12 comptes sont double-rôle — le filtre strict « non-producteur » n'en aurait montré que 2. Réutilise le détail partagé `/users/[id]` (pas de split de la route détail → zéro ré-câblage des liens). Badge « Aussi producteur » pour signaler le double-rôle.
>
> 🟢 **Factorisation queries** : `lib/admin/orders/fetch.ts` (suivi commandes) + `lib/admin/refunds/fetch.ts` (demandes), extraites des pages inline (testabilité, cohérence lib/admin/*).
>
> 🟢 **Utilisateurs → Gouvernance** : l'entrée `/users` (vue toutes-rôles, défaut `?role=admin`) passe sous Gouvernance. **Bridge transitoire** : la suppression effective de `/users` est reportée au chantier 6 (Page Admins) pour la coupler atomiquement à sa page de remplacement « Administrateurs » — évite un split de la route détail partagée + une fenêtre sans vue admin.
>
> 🟢 `AdminPageHeader.eyebrow` rendu optionnel (la section fournit son contexte via la barre d'onglets).
>
> 🟢 Tests : helpers refunds/orders (mapping + agrégation badge), `consumer_inclusive` (contains, pas de négation OR), page comptes consommateurs, `RefundsTabNav` (onglets + actif), sidebar (nav chantier 5). Pas de migration. lint/type-check/build OK, `npm test` vert (2879).

---

## 2026-05-23 (Refonte admin — Chantier 4 : gestion producteurs UI)

> PR `feature/chantier-4-gestion-producteurs`. Refonte du tableau de la page admin /gestion-producteurs (orientation contact + fix deep-link).
>
> 🟢 **Nouvelles colonnes** : Exploitation (nom, **cliquable vers la page publique www** quand `statut = public`, commune en sous-titre), Contact (prénom nom via jointure `public.users`), Email (lien `mailto:`), Téléphone (lien `tel:` via jointure users), Abonnement, Inscription, Actions. Colonne Statut conservée (badge + signaux « Publication demandée » / « Bio à valider » du chantier 3 — pas de régression).
>
> 🟢 **Jointure users étendue** : `fetchAdminProducersList` remonte désormais `email, prenom, nom, telephone` (toujours sur `public.users`, jointure embarquée PostgREST). Mapping → `contactName` (« — » si vide) + `phone` (null si absent).
>
> 🟢 **Filtre statut lu depuis l'URL** : `?status=` parsé côté server (`parseProducerStatusFilter`, fail-safe → `all`) et passé en filtre initial du client. **Fix du deep-link** cockpit dashboard « Producteurs à valider » → `/gestion-producteurs?status=pending` (le param était ignoré auparavant) et journal d'audit.
>
> 🟢 **Fix lien page publique** : le lien « Voir page publique » utilisait une URL relative (`/producteurs/[slug]`) qui résolvait sur le sous-domaine `admin.*` — désormais absolu vers `www` (`NEXT_PUBLIC_APP_URL`).
>
> 🟢 Tests : `parseProducerStatusFilter` (fail-safe), fetch (mapping contact email/prenom/nom/telephone + cas vides), page (`?status` → filtre initial), client (colonnes contact, mailto/tel, lien nom public absolu, filtre initial). Pas de migration (UI + extension query). lint/type-check/build OK, `npm test` vert (2858).

---

## 2026-05-23 (Refonte admin — Chantier 2 : dashboard refonte)

> PR `feature/chantier-2-dashboard`. Refonte du tableau de bord admin.
>
> 🟢 **Bandeau temporel** : sélecteur Aujourd'hui / Cette semaine / Ce mois-ci / Cette année (query param `?period=`), avec 4 KPIs sur la période : commandes, chiffre d'affaires, consommateurs actifs, producteurs actifs.
>
> 🟢 **RPC `get_admin_dashboard` paramétrée** : signature `(p_period text default 'today')` ; bornes calculées en Europe/Paris (date_trunc). Bloc `period` (4 KPIs) ajouté ; bloc `business` today/7d supprimé (remplacé par le bandeau) ; conversion promue top-level `conversion_30d`. Migration appliquée + smoke test (today/week/month/year). ⚠️ changement de shape → coordonné avec le déploiement du code.
>
> 🟢 **Ordre des zones** : Période → À traiter (cockpit) → Conversion → Activité récente.
>
> 🟢 **Cockpit : toutes les cartes cliquables** — fix « Incidents de remboursement » (→ /refund-incidents) et « Invitations expirées » (→ /invitations) qui pointaient vers `#` ; « Producteurs à valider » → /gestion-producteurs?status=pending. « Litiges ouverts » reste en attente (branché au chantier 8).
>
> 🟢 **Mise au français** : Refunds en attente → Remboursements en attente, Incidents refund → Incidents de remboursement, etc. Carte « Publications à valider » (chantier 3) conservée sans duplication.
>
> 🟢 Tests : lib period (parsing fail-safe) + page (bandeau, KPIs, cockpit cliquable, conversion, activité). lint/type-check/build OK, `npm test` vert.

---

## 2026-05-23 (Refonte admin — Chantier 0 : fondations sidebar/nav par sections)

> PR `feature/chantier-0-sidebar`. Structuration de la nav admin en sections métier (aucun code fonctionnel modifié — réorganisation + libellés).
>
> 🟢 Sections (group headers plats, mécanisme T-130/chantier-7, sans collapsible JS) : **Tableau de bord** · **Producteurs** (Leads / Gestion producteurs / Invitations) · **Consommateurs** (Suivi commandes / Remboursements / Incidents de remboursement / Utilisateurs) · **Gouvernance** (Journal d'audit / Avis / Conformité légale) · **Référentiels** (Données GMS / Catégorisation).
>
> 🟢 **Mise au français** : « Refunds en attente » → « Remboursements », « Incidents refund » → « Incidents de remboursement ». « Leads producteurs » → « Leads » (sous Producteurs).
>
> 🟢 Entrées à venir slottées par leurs chantiers : « Comptes consommateurs » (chantier 5), « Admins » (chantier 6), section « Mails » (chantier 9). `/users` transitoire jusqu'au chantier 5.
>
> 🟢 Tests : +4 cas (group headers, ordre des sections, rattachement, libellés FR). lint/type-check/build OK, `npm test` vert.

---

## 2026-05-23 (Refonte admin — Chantier 7 : regroupement nav Référentiels)

> PR `feature/chantier-7-referentiels`. Réorganisation nav de la sidebar admin (aucun code fonctionnel modifié — pages GMS/catégorisation existantes inchangées).
>
> 🟢 Nouvelle section **« Référentiels »** regroupant **Données GMS** (ex-« Prix GMS ») + un sous-en-tête imbriqué **Catégorisation produits** (catégories / espèces animales / morceaux).
>
> 🟢 Ajout d'un variant `subgroup` (sous-en-tête indenté, non cliquable, `role="presentation"`) — extension minimale du mécanisme de groupes plats existant, **sans collapsible JS** (cohérent avec la décision T-130 : sur-ingénierie pour si peu d'entrées). « nesting préservé » au sens du mécanisme existant.
>
> 🟢 Tests : +6 cas sidebar (group header, rattachement, nesting, ordre, active state). lint/type-check/build OK, `npm test` vert.

---

## 2026-05-23 (Chantier 10 — Navigation par semaine dashboard + revenus)

> PR `feature/chantier-10-dashboard-producteur`. Le producteur peut désormais naviguer dans le temps (semaines précédentes/suivantes) sur son tableau de bord et sa page revenus, via un offset de semaine en query param (`?week=-1`, `?week=2`, …) et un sélecteur prev/next.
>
> 🟢 **Lib partagée `lib/dates/week-navigation.ts`.** Helpers purs testés : `parseWeekOffset` (clamp ±52 semaines, fail-safe sur valeur malformée), `computeDashboardBounds` (bornes ISO-week pour la RPC `get_producer_dashboard`), `computeRevenueWeekWindow` (fenêtre glissante de 8 semaines), `formatWeekRangeLabel`. Consolide les helpers `startOfWeek`/`addDays`/`startOfDay` jusque-là dupliqués inline dans les deux pages.
>
> 🟢 **Décision design.** Sur le dashboard, seules les données **scopées semaine** (planning + revenus semaine + comparaison semaine précédente) suivent l'offset. Les indicateurs « live » (commandes du jour, prochain retrait, alertes stock) restent ancrés sur le vrai jour — « commandes aujourd'hui » n'a pas de sens pour une semaine passée.
>
> 🟢 **Aucune migration.** La RPC `get_producer_dashboard` est déjà entièrement paramétrée par dates (F-045) ; on lui passe simplement les bornes décalées. La page revenus agrège côté query, fenêtre bornée haut + bas pour la navigation passée.
>
> 🟢 **Composant `WeekNavigator`** (producteur, partagé dashboard + revenus). Sélecteur prev/next SSR-friendly (`<Link>` qui pilotent `?week=`, préservent les autres params, désactivent les flèches aux bornes), avec lien « Revenir à cette semaine ».
>
> 🟢 **Tests** : 31 cas unitaires sur la lib de bornes + 9 cas sur le `WeekNavigator`. `npm test` vert (lint + type-check OK).

---

## 2026-05-23 (Refonte admin — Chantier 1 : accès admin magic link auto)

> PR `feature/chantier-1-magic-link-admin`. Premier chantier de la refonte admin.
>
> 🟢 **Bouton « Espace admin »** dans la navbar www, affiché UNIQUEMENT aux admins (gardé par `isAdmin`). Remplace l'ancien lien relatif `/tableau-de-bord` (qui pointait une route admin sur www).
>
> 🟢 **Action `requestAdminMagicLinkAction`** (session-based) : un admin connecté sur www déclenche en un clic un magic link envoyé à SA propre adresse, dont le callback tombe sur `admin.*` et y pose le cookie isolé `sb-admin-auth-token`. Réutilise `signInWithOtp` + le callback existant ; aucune migration, **aucun partage de cookie cross-subdomain** (isolation Chantier 4 préservée). Réservé aux admins (vérif serveur), rate-limité, audité (`account_login_magic_link` source=admin_button).
>
> 🟢 Tests : 4 cas unitaires (non connecté / non admin / admin OK / rate-limit) + anti-régression sur le magic link existant. `npm test` vert (2797), lint/type-check/build OK.
>
> ⚠️ **Incident infra (documenté CLAUDE.md § Pièges connus)** : la tentative initiale d'orchestration parallèle via agents en worktrees isolés a échoué sur ce setup Windows (tangle worktrees + reset cwd shell + `git worktree remove --force` qui a vidé le `node_modules` du main via une jonction). Aucune perte de code (restauré via `npm install`). Bascule actée vers le modèle séquentiel team-lead.

---

## 2026-05-22 (Fix — isolation rôles/sous-domaine middleware)

> PR `fix/middleware-subdomain-isolation`. Bug d'isolation surfacé post-merge chantier 3 (pré-existant) : un utilisateur **non-producteur** connecté pouvait charger des routes consumer (ex. `/compte`) sur `pro.terroir-local.fr` — le contenu consumer était servi sur le sous-domaine producteur. **Pas de fuite de données** (RLS intacte, données propres à l'utilisateur, identiques à `www`) mais violation de la doctrine d'isolation des rôles par sous-domaine.
>
> 🟢 **Cause** : une seule app Next sert les 3 sous-domaines ; les route-groups n'isolent pas par host. Le middleware bloquait la **racine** `pro.*` pour les non-producteurs (→ `/connexion`) mais **pas les autres chemins** (le garde-fou rôle ne se déclenchait que pour les users *avec* le rôle producer).
>
> 🟢 **Fix `middleware.ts`** : (1) `/compte/*` sur `pro.*` → redirect absolu vers `www.*/compte…` pour **tous** (consumer, producteur, non-connecté — `/compte` est consumer par nature) ; (2) utilisateur connecté sans rôle `producer` (non-admin) sur `pro.*` (hors racine + hors `/compte`) → redirect absolu vers `www.*`. Redirects **absolus** (anti-boucle). Producteurs et admins inchangés.
>
> 🟢 **Vérifs pré-fix** : signup producteur (Phase 2bis) attache le rôle `producer` **synchrone** avant redirect → pas renvoyé vers www ; liens `/compte` relatifs/absolus-www audités → pas de boucle.
>
> 🟢 **Tests** : 7 cas unitaires `tests/middleware.test.ts` (host PROD forcé, car non testable en E2E localhost). Doctrine documentée dans `CLAUDE.md` § Pièges connus. `npm test` vert, lint/type-check/build OK.

---

## 2026-05-22 (Chantier 3 — Refonte Leads producteurs, PR #152)

> PR `feature/leads-refonte-2026-05`. Refonte complète du funnel d'acquisition producteurs (prospection CRM + inscription self-service), suppression du score-carbone, ajout d'un flag bio validé admin.
>
> 🟢 **Phase 1 — Schéma + suppressions.** Colonnes CRM sur `producer_interests` (`assigned_to`, `current_step` 1-6, `first/last_contact_at`, `next_follow_up_at`, `abandoned_at/reason`, `prefill_token`). Table `producer_interest_followups` (interactions, RLS admin). Flag bio (`bio`, `bio_certificate_number` producer-writable ; `bio_validated_at` admin-only via trigger). Colonne `publication_requested_at` + RPC `request_publication` (6 critères serveur). **Suppression** du score-carbone (3 indicateurs + véracité DGCCRF), des 3 filtres de recherche associés, et de la **publication automatique** (`promote-to-public.ts`). ADR-0008 (supersede 0002). Widget distance « ~1500 km » préservé.
>
> 🟢 **Phase 2 — Backend Leads.** Lien prefill HMAC 30j (`lib/leads/prefill-token`). 7 routes admin `/api/admin/leads/*` (prospects, step, send-form, followup, assign, abandon, liste) + route producteur `request-publication`. Cron `leads-followups` (relances R1 J+3 / R2 J+10 / R3 J+20, abandon auto J+40, idempotent, un seul mail final pour les leads backlog). 4 templates email (3 relances + envoi formulaire).
>
> 🟢 **Phase 2bis — `/devenir-producteur` self-service.** Le formulaire crée le compte (auth + users consumer+producer + producers draft, accès immédiat via cookie partagé `.terroir-local.fr`) au lieu d'une candidature. Email existant → message clair + lien connexion (oracle B2B assumé). Convergence prospect (prefill → update lead étape 4). Email de bienvenue. **Politique mot de passe 12 caractères** progressive (`strongPasswordSchema` 8→12, sans invalidation de session).
>
> 🟢 **Phase 3 — UI Admin Leads.** Frises funnel 6 étapes distinctes prospecté/spontané. Page détail `/producer-interests/[id]` (frise + actions + timeline interactions). Filtre par parcours + bouton « Nouveau prospect ».
>
> 🟢 **Phase 4 — UI pro + bio public.** `/ma-page` : panneau « Demander la publication » (critères manquants) + section « Certification bio ». Exposition publique gated (`producers_public.bio = bio AND bio_validated_at NOT NULL`, `search_producers` filtre + colonne bio, anti-fuite `bio_validated_at`). Badge « Agriculture Biologique » fiche + carte, filtre Bio recherche.
>
> 🟢 **Phase 5 — Validation admin.** `/gestion-producteurs` : signaux + actions Publier / Valider-Refuser-Révoquer bio. Route `bio-validation` + audit `admin_producer_bio_validated`.
>
> 🟢 **Phase 6 — Finalisation.** Cockpit dashboard : compteurs « Publications à valider » + « Certifications bio à valider » (RPC `get_admin_dashboard` étendue). Nettoyage checklist post-launch (items véracité/score-carbone obsolètes, clause CGU bio). Suivi env `LEAD_PREFILL_TOKEN_SECRET` (Vercel avant déploiement).
>
> Toutes les migrations appliquées en prod + smoke tests MCP. `npm test` vert (~2800 tests), lint/type-check/build OK à chaque phase. 6 leads de test (mailinator) purgés de la prod.

---

## 2026-05-13 (PR3 admin-new-surfaces — users, refund-incidents, invitations)

> PR `feature/admin-new-surfaces`. Troisième et dernière des 3 PR du chantier audit-driven admin (`docs/AUDIT_ADMIN.md`).
>
> 🟢 **3 nouvelles surfaces admin** câblées en UI alors que les données existaient déjà en DB (`AUDIT_ADMIN §6 P0 #3`, `§6 P1 #6`, `§6 P2 #9`) :
>
> - **`/users`** — vue globale users (recherche email, filtres rôle consumer/producer/admin, pagination cursor 50). Page détail `/users/[id]` avec 4 onglets : **Profil** (jointure `auth.users` pour `last_sign_in_at` + `email_confirmed_at`) / **Commandes** (filtré `consumer_id`) / **Reviews** (filtré `consumer_id`) / **Notifications** (filtré `user_id`, tri `created_at DESC` — traite le gap P1 deliverability). Visualisation seule, pas de mutation.
>
> - **`/refund-incidents`** — liste filtrée + drill-down `[id]` avec table `refund_incident_attempts`. Action "Marquer comme résolu manuellement" avec note obligatoire (min 5 chars). API route `/api/admin/refund-incidents/[id]/resolve` (POST) → trigger 409 si statut non-actionnable, UPDATE service_role + audit log `refund_incident_resolved_manually` (nouveau event_type) + `revalidatePath`.
>
> - **`/invitations`** — listing complet des `producer_invitations` avec statuts **computed côté query** (la table n'a pas de col `status`) : `sent` / `consumed` / `expired` / `revoked`. Action "Révoquer" via POST `/api/admin/invitations/[id]/revoke` → 409 si déjà consumed, 200 noop si déjà revoked (idempotent), succès UPDATE `revoked_at=now()` + audit log `invitation_revoked` (event pré-déclaré dans `log-auth-event.ts`, jamais émis avant).
>
> 🟢 **Migration `add_producer_invitations_revoked_at`** : `ALTER TABLE producer_invitations ADD COLUMN revoked_at TIMESTAMPTZ NULL` + **CHECK constraint exclusive** `NOT (used_at IS NOT NULL AND revoked_at IS NOT NULL)` (défense en profondeur DB, complète le 409 applicatif) + index partiel `WHERE revoked_at IS NOT NULL`. Appliquée via MCP, smoke tests OK (colonne, contrainte, index, tentative INSERT incohérent bloquée par CHECK).
>
> 🟢 **AdminSidebar étendue** : 3 nouvelles entrées (`Invitations`, `Utilisateurs`, `Incidents refund`) positionnées proches de leurs surfaces métier respectives. Test smoke check étendu (4 nouveaux tests : rendu + active state pour chaque entrée).
>
> 🟢 **Nouvelle catégorie audit-logs `refund`** (palette `red`, signal incident plus fort que `rose` email bounces) : règle préfixe `refund_incident_*`. Justification : cycle de vie technique refund (Stripe Refunds API + backoff retry cron T-102 + résolution manuelle) distinct du flow commande nominal — mérite sa propre couleur côté `/audit-logs` pour repérage forensique rapide. À terme, candidat pour migration des `order_refund_*` / `producer_refund_*` (12 events existants) vers cette catégorie.
>
> 🟢 **Précédence computed statuts invitations (defensive)** : si une row corrompue historique a `used_at` ET `revoked_at` malgré le CHECK, le helper `mapRowStatus` retourne `consumed` (état métier dominant). Test fetch dédié couvre ce cas.
>
> 🟢 **Nettoyage** : `tree.txt` parasite supprimé (jamais tracked, hors scope toutes PR mais polluait `git status`).
>
> Tests : **2678/2678 verts** (140 nouveaux : 46 users + 55 refund-incidents + 39 invitations). Lint, type-check, build : propres.

---

## 2026-05-13 (PR2 admin-dashboard — RPC + page tableau de bord)

> PR `feature/admin-dashboard`. Deuxième des 3 PR du chantier audit-driven admin (`docs/AUDIT_ADMIN.md`).
>
> 🟢 **Tableau de bord admin opérationnel** — `app/(admin)/tableau-de-bord/page.tsx` passait de 8 lignes vides (juste `<h1>Back-office</h1>`) à une vue 3-zones consommée par 1 Server Component + 1 RPC SECDEF. Résout `AUDIT_ADMIN §6 P0 #1`.
>
> 🟢 **RPC `get_admin_dashboard()`** — migration `20260513124041_create_get_admin_dashboard.sql`. SECDEF / STABLE / `search_path = public, pg_temp`. ACL strictement `service_role` (pattern aligné `get_producer_dashboard` F-045). Retourne JSONB 3-zones :
> - **cockpit** : 6 compteurs d'attention (refunds_pending, disputes_open, reviews_pending, producers_pending_validation, refund_incidents, invitations_expired).
> - **business** : 8 KPI (orders/revenue/new_users today + orders/revenue/completion_rate/active_producers/total_producers 7j + invitation_conversion 30j).
> - **recent_events** : 15 derniers `audit_logs` filtrés sur whitelist business (order_created, pickup_validated, order_cancelled, order_payment_succeeded, account_signup, account_login_magic_link, admin_invite_sent, invitation_consumed_success, producer_response_published).
>
> 🟢 **UI** — 3 zones rendues via `CockpitCard` (Zone 1, opacity-50 à 0, href vers page domaine), `MetricCard` (Zone 2, formats € via `centsToEuro` + Intl), `RecentActivityTable` (Zone 3, chaque ligne clickable vers `/audit-logs?event_type=...`). Cartes des pages PR3 à venir (disputes / refund-incidents / invitations) rendues avec `title="Page à venir"` + opacity, prêtes à recevoir un `href` quand la PR3 livrera ces pages.
>
> 🟢 **Décisions enum dans la RPC** : `producers_pending_validation_count` = `statut='pending' AND deleted_at IS NULL` (draft = onboarding en cours, pas une décision admin). `disputes_open_count` = `closed_at IS NULL` (vérifié robuste : `handle-dispute-closed.tsx:69` pose toujours `closed_at` sur won/lost/warning_closed ; `handle-dispute-updated.ts` ne mappe jamais ces statuts terminaux). `refund_incidents_count` = `status IN ('pending','retrying')`. `invitations_expired_count` = `used_at IS NULL AND expires_at < now()` (table sans col `status`).
>
> 🟢 **Whitelist Zone 3 — corrections vs brief initial** : `order_completed` → `pickup_validated` (seul "completed event" du registre, posé quand le producteur scanne TRR-XXXXX). `signup_success` → `account_signup`. `magic_link_consumed_success` → `account_login_magic_link`. `review_submitted` retiré (event_type inexistant — à ouvrir post-PR2). `order_payment_succeeded` ajouté (signal business high-value à chaque paiement validé Stripe).
>
> 🟢 **Patches docs** : `docs/AUDIT_ADMIN.md` corrigé (mentions implicites d'un statut `producer_invitations` levées — la table n'a pas de col status, états computed via `used_at`+`expires_at`). `CLAUDE.md §8` ajoute 2 pièges : (1) `producer_invitations` sans col status ; (2) apostrophe courbe U+2019 interdite ESLint aussi dans les valeurs d'attribut JSX `"..."` (pas seulement le texte).
>
> Tests : 2550/2550 verts (17 nouveaux : 3 types + 3 fetch + 11 page). Lint, type-check, build : propres.

---

## 2026-05-13 (PR1 admin-pattern-uniform — refactor 3 pages admin)

> PR #128 `refactor/admin-pattern-uniform`. Première des 3 PR du chantier audit-driven admin (`docs/AUDIT_ADMIN.md`).
>
> 🟢 **`/avis`, `/gestion-producteurs`, `/producer-interests`** refactor en Server Component + `createSupabaseAdminClient()` (service_role) pour le READ + API routes `/api/admin/*` + audit log obligatoire pour le WRITE. Pattern uniformisé, plus de divergence browser-RLS vs server-service_role.
>
> 🟢 **Bug `AUDIT_ADMIN` §4.5 résolu par construction** : la page `/avis` lisait via browser-client + RLS, mais la table `reviews` n'a aucune policy admin. Conséquence : reviews `pending` invisibles côté admin dès qu'un consumer en publierait. Le passage en service_role les rend visibles. Validé en live via MCP Supabase (insertion review pending factice → fetch service_role OK → cleanup).
>
> 🟢 **5 nouveaux event_types `audit_logs`** (avec labels FR + catégories visuelles) : `admin_review_published`, `admin_review_rejected` (catégorie `review`), `admin_producer_statut_changed` (nouvelle catégorie `producers`, palette sky), `admin_producer_interest_statut_changed`, `admin_producer_interest_deleted` (nouvelle catégorie `producer_interests`, palette fuchsia). 3 nouveaux helpers `lib/audit-logs/log-*-event.ts` symétriques aux clusters existants.
>
> 🟢 **`lib/admin/{reviews,producers,producer-interests}/`** créés pour factoriser les helpers fetch + types + mappers (instruction lead PR1 : zéro duplication entre l'ancienne page CSR et la nouvelle SSR).
>
> Tests : 2616/2616 verts. Lint, type-check, build : propres.

---

## 2026-05-13 (refonte doctrine + tri TODO/backlog + ADRs + EOL normalisation)

> Refonte structurelle session 2026-05-12/13. PR #122 (EOL) mergée + chantier `chore/cleanup-post-t300-and-doctrine-refresh` en cours.
>
> 🟢 **`CLAUDE.md` réécrit from scratch** (1036 lignes diff). 5 règles d'or en tête (fainéantise maximale Romain, propreté seul critère, zéro backlog, langage non technique, pas de fenêtres de questions) + 10 sections opérationnelles. Section pièges connus inclut désormais une liste « actions UI-only confirmées » (Stripe Connect KYC, Supabase SMTP custom + templates Auth, HIBP toggle, Stripe Connect branding, création comptes services tiers).
>
> 🟢 **Tri `TODO.md` + `backlog/post-live.md`** (482 lignes supprimées) selon critère règle d'or 3 : (i) faisable maintenant → fait, (ii) conditionné à événement externe → déplacé dans `post-launch-checklist.md` avec condition explicite, (iii) aspirationnel sans condition → suppression, (iv) rationale produit réutilisable → ADR. Le mot « backlog » disparaît du repo (`docs/backlog/` supprimé). Plus de roadmap aspirationnelle T-200/T-221/T-223/T-240/T-241/T-242.
>
> 🟢 **`docs/decisions/` créé** (4 fichiers, format ADR standard) : ADR-0001 Position consumer persistance (Deferred), ADR-0002 Pattern déclarations engageantes producteur (Accepted, livré T-241 + T-243), ADR-0003 Mode de livraison retrait ferme uniquement (Accepted, décision Romain 2026-05-07).
>
> 🟢 **`docs/post-launch-checklist.md` créé** (413 lignes) — items conservés triés par condition de déblocage : bloquants Live initial, audit externe pré-launch, actions UI tierces Romain, conditionné T-003, conditionné passage Live, conditionné PostHog/Sentry provisionnés, conditionné évolution wording véracité, conditionné élargissement géo, conditionné mesures télémétrie atteignant un seuil, bug latent C-CHECKOUT-IDEMPO, conformité a11y française marchand grand public.
>
> 🟢 **`.gitattributes` enforce LF** (PR #122 mergée, commit `e5d7f70`). 46 lignes : `* text=auto eol=lf` par défaut + binaires explicites (`.png`/`.jpg`/`.pdf`/fonts/archives/audio/vidéo marqués `binary`) + scripts Windows préventifs (`.bat`/`.cmd`/`.ps1` en `eol=crlf`). Effet : élimine la divergence silencieuse Windows CRLF ↔ outils Node LF, déverrouille `tests/scripts/codegen-enums.test.ts` qui failait localement. Index git n'a pas bougé (déjà en LF), seul le working tree Windows est renormalisé au checkout. `CONTRIBUTING.md` complété section « Configuration git locale (action requise sur Windows) » documentant `core.autocrlf=false` + procédure de re-checkout forcé.
>
> 🟢 **Cleanup post-T-300 commentaires** : 2 commentaires `lib/producers/` (`fetch-public.ts`, `get-display-name.ts`) référençaient le ticket T-300 (DROP COLUMN `prenom_affichage`, livré 2026-05-07). Reformulés pour expliquer le design fonctionnel (`users.prenom` source unique, pas de duplication sur la table producers) sans pollution ticket-référence.
>
> 🟢 **`docs/METHODOLOGY.md` supprimé** (571 lignes obsolètes). Le contenu utile est consolidé dans `CLAUDE.md` règles d'or + sections.
>
> 🟢 **`docs/README.md` et `docs/HANDOFF.md`** mis à jour pour pointer vers les nouveaux artefacts (`post-launch-checklist.md`, `decisions/`) et `CLAUDE.md` racine. Références cassées vers `TODO.md` / `METHODOLOGY.md` / `backlog/post-live.md` corrigées.

---

## 2026-05-12 (chantier P1 régression sweep — fix trigger producers + filet anti-régression doctrine)

> Session `/plan-ceo-review` 2026-05-12. PR origine #121 (branche `feature/p1-regression-sweep-axes-1-5`) — 10 commits atomiques, 5 axes structurés. Cherry-pick chirurgical sur master après que la PR #121 ait divergé suite aux 5 PRs CC #2 mergées entre-temps (PRs #122-#126). 8 commits cherry-pickés + 2 partiels (CLAUDE.md + ce CHANGELOG), 1 abandonné (`04ae538` codegen-enums EOL fix rendu redondant par `.gitattributes` PR #122).
>
> 🔴 **Détecté + fixé en prod** : régression silencieuse trigger `producers_block_owner_admin_columns` introduite par migration P0_F008 (commit `5fcf720` du 2026-05-11). 2 régressions latentes ~36h :
> 1. Référence `prenom_affichage` colonne droppée par T-300 (latent — bug 1)
> 2. Pertes checks `latitude`/`longitude` admin-only T-218-bis (exploitable sur le papier mais bloqué de fait par bug 1)
>
> Migration corrective `20260512100000_p1_fix_t300_t218bis_regression_trigger` apply prod via MCP. Smoke tests post-apply 5/5 OK. Diagnostic dérive data : 8 producers prod, toutes coords dans bounds Sarthe, 0 dérive détectée.
>
> 🟢 **Filet anti-régression livré** :
> - F-008 : 7 tests SQL-integ producers trigger (incl. 2 lat/lng T-218-bis bonus = proof of value du filet, sans ces tests la régression aurait pu revenir)
> - F-004 grep statique : `tests/lib/stripe/refund-clawback-coverage.test.ts` qui scanne `app/+lib/+scripts/` pour `stripe.refunds.create` (count=7, 6 sites obligatoires + 1 exemption whitelist documentée `retry-incident.ts`)
> - Audit batch coverage : F-001/F-003/F-009/F-014/F-026 confirmés déjà couverts via PR #119 + commits P0 sweep 10-11 mai (4-6h CC d'écriture redondante évitée par grep préalable systématique)
>
> 🟢 **CI workflow** : `.github/workflows/test-sql-integration.yml` — Supabase CLI v2.92.1 + Docker + Node 20 LTS. Premier run vert en 2m40s. Step validation explicite des keys avant tests pour éviter fallback hardcoded silencieux. Complémentaire au workflow `ci.yml` (lint + type-check + build + test, livré PR #126) qui couvre la suite Vitest standard hors SQL-integration.
>
> 🟢 **Doctrine** : `docs/conventions/regression-tests-security.md` (~301 lignes, sections 0-7) + `docs/audits/audit-batch-axe1-coverage-2026-05-12.md` (méthode reproductible audit batch, ROI 10-20x). Pattern E2E sentinel `playwright-test-*@mailinator.com` + cleanup auto Playwright lifecycle + cleanup manuel via `npx tsx scripts/cleanup-test-residuals-e2e.ts`.
>
> 🟢 **Cron Vercel weekly cleanup** : nouvelle route `/api/cron/cleanup-test-residuals` (dimanche 2h UTC, `0 2 * * 0`) + refactor `sweepE2EResiduals` de `tests/e2e/helpers/db-cleanup.ts` vers `lib/maintenance/sweep-e2e-residuals.ts` (découplage tests/prod, 3 imports updated atomiquement).
>
> Commits effectivement appliqués sur master (cherry-pick) :
> - `3f37c0d` fix(db): retirer prenom_affichage + restaurer lat/lng admin-only trigger producers + doctrine anti-pattern
> - `26e3411` docs(audit): batch coverage F-003/F-014/F-026/F-004 axe 1 P1 sweep
> - `2837c3b` test(stripe): F-004 grep statique strict refund clawback coverage
> - `a53a9f3` docs(conventions): doctrine regression-tests-security complète (sections 0-7)
> - `9b0b634` ci(workflow): add test-sql-integration GitHub Action workflow
> - `f2f8f77` feat(scripts): cleanup-test-residuals-e2e CLI standalone (sweep sentinel playwright-test-*)
> - `d2b1bf2` docs(claude-md): pattern E2E sentinel + cleanup + cross-ref doctrine (appliqué partiel — section 5 Tests + pré-push obligatoire dans la nouvelle structure CLAUDE.md règles d'or)
> - `60959a6` feat(cron): cleanup-test-residuals weekly + refactor sweep helper to lib/maintenance
> - `432d642` doc(changelog): chantier P1 régression sweep 2026-05-12 (appliqué partiel — cette entrée elle-même)
>
> Commit abandonné :
> - `04ae538` fix(test): normalize EOL in codegen-enums parity check — confirmé redondant après livraison `.gitattributes` (PR #122) qui résout la cause racine globalement.

---

## 2026-05-11 (audit pré-launch sweep phase 3 — Basse + Info)

> Sweep des findings Basse + Info restants après PR #112-#116 (phase 1 et 2). Voir PR finale pour les finding traités code.
>
> 🟢 **3 findings Info-only fermés sans code** (audit explicitement classés "info, no action") :
> - **F-057** replyTo user-controlled : risque très faible (regex Zod email rejette `\r\n` + SDK Resend HTTPS JSON). Pas d'action immédiate.
> - **F-061** Hiérarchie super-admin / admin pour invitation : hors scope V1, à reconsidérer V1.x si volume admin > 3.
> - **F-065** Absence `expand` sur certains lookups Stripe : pas d'action immédiate. Déclencheur = latence webhook handler > 5 s (instrumentation observée post-Live).

---

## 2026-05-06 (chantier pickup-validation — flow remise commande producer + boucle feedback avis)

> Chantier hors numérotation T-XXX selon directive. Doc complète : [`docs/fixes/pickup-validation-2026-05-06.md`](./fixes/pickup-validation-2026-05-06.md). Sessions 2 enchaînées sur terminal TC, 8 LOTs séquentiels (commits `4c8e2e1` → ce commit).
>
> 🟢 **Audit LOT 0 a corrigé le brief initial** : le brief postulait un workflow 4 états (`pending → confirmed → ready → completed`) à construire from-scratch. L'audit a montré que la feature pickup existait déjà à ~80% (code `TRR-XXXXX` généré par trigger Postgres, route `/complete`, email J0, cron `review-followup` J+2/J+7). MAIS l'état `ready` était dormant en pratique (aucune route ne le set), donc la section "Validation du retrait" sur la page détail producer n'était jamais atteignable. Décision Romain : **modèle 3 états réel** `pending → confirmed → completed`, état `ready` conservé en state machine pour rétro-compat mais réaffectation/nettoyage en backlog.
>
> 🟢 **Architecture finale — single source of truth pour 2 entrées UX** :
> - **Route id-based** `POST /api/orders/[id]/complete` (page détail commande producer, 1-clic conservé selon arbitrage Q3 — la fiche sert de preview).
> - **Route code-based** `GET/POST /api/producer/orders/validate-pickup` (saisie haut-de-page `/producer/commandes` + modale preview obligatoire avant confirm — mode "caisse rapide marché").
> - Les 2 routes partagent : helper `lib/orders/pickup-validation.ts` (Zod TRR-XXXXX + UPDATE atomic `WHERE statut='confirmed'` race-safe), rate-limit Upstash `getPickupValidationRateLimit` (10/min/`producer:<id>`), cluster audit log `pickup_*` (5 events), helper email `lib/orders/send-pickup-review-email.tsx` (J0 review_request).
> - `metadata.route='complete_id_based'` discrimine en admin /audit-logs les events de chaque route.
>
> 🟢 **UI `PickupValidationCard`** (LOT 4) — composant client `app/(producer)/commandes/_components/`. 3 états visuels (idle / preview AdminModal / success). 8 variants d'erreurs typés via `<ErrorBanner>`. Callback `onValidated(orderId)` met à jour le statut local en `completed` sans recharger.
>
> 🟢 **Anti-info-leakage 404 unifié** (arbitrage Q5) — `code_unknown` ET `wrong_producer` retournent la même réponse `pickup_code_unknown` côté API. Distinction préservée seulement en audit log interne (`metadata.reason`). Un producer A ne peut pas déduire qu'un code "exists but isn't mine".
>
> 🟢 **409 explicite avec `detail_url`** pour `order_not_confirmed` (cas pending fréquent — producer a oublié de confirmer la commande). Message UI : "Cette commande n'a pas encore été confirmée. Validez-la d'abord dans votre espace commandes." + lien "Voir la fiche commande" cliquable.
>
> 🟢 **Échéances rappels avis J+2 / J+7 conservées** (arbitrage Q4). Cron `/api/cron/review-followup` `0 10 * * *` UTC daily inchangé. Calibration agressive volontaire pour capter la mémoire fraîche du retrait. LOT 6 NO-OP (audit lecture validé + comblement lacune trou : ajout 13 tests vitest sur le cron qui n'en avait aucun).
>
> 🟢 **Backlog identifié** (cf. doc finale section dédiée) : nettoyage état `ready` state machine, marqueur DB déduplication cron (race Vercel timeout retry), audit log cluster `review_followup_*`, warning SSR styled-jsx, refactor pattern N+1 cron review-followup vers embeds PostgREST.
>
> 🟢 **Tests ajoutés** : 132 nouveaux tests sur le chantier (cumul) — `pickup-validation.test.ts` (35) + `validate-pickup/route.test.ts` (23) + `validate-pickup/integration.test.ts` (7) + `OrderDetailClient.test.tsx` (5) + `PickupValidationCard.test.tsx` (10) + `complete/route.test.ts` étendu (29) + `log-pickup-event.test.ts` (7) + `cron/review-followup/route.test.tsx` (13) + extensions `stateMachine.test.ts` matrice + LEGAL/ILLEGAL.
>
> 🟢 **Conventions vitest formalisées** : nouvelle doc [`docs/conventions/vitest-mocking-patterns.md`](./conventions/vitest-mocking-patterns.md) avec 3 leçons collectées en cours de chantier (`importOriginal` pour préserver exports transverses, imports directs vs barrel pour tests jsdom, `act()` autour helpers DOM custom) + 2 patterns bonus (mock Supabase queue par-table FIFO + capture, hoisted env stubs).
>
> 🟢 **Convention rate-limit étendue** : [`docs/conventions/rate-limiting.md`](./conventions/rate-limiting.md) — ajout ligne `getPickupValidationRateLimit` (10/60s `producerId`).
>
> 🧪 **Tests effectués** : Suite complète 2247/2247 verts (192 fichiers). tsc strict OK. lint OK. `npm run build` OK.
>
> ⚠️ **Aucune migration DB livrée** — le code commande `TRR-XXXXX` existait déjà via trigger Postgres `generate_order_code()` (migration initial schema 2026-04-19).

---

## 2026-05-06 (T-219 cache serveur géocodage CP→lat/lng)

> Cache persistant Supabase (`public.geocode_cache`) qui amortit les appels au géocodeur public `api-adresse.data.gouv.fr`. Le DistanceWidget hit ce cache via `/api/geocode` plutôt que d'appeler gouv.fr direct depuis le navigateur. Continuité T-200 r1 préservée (pas de PII, pas de log par-IP, pas de profilage user).
>
> 🟢 **Option α retenue (vs β Upstash KV / γ unstable_cache)** : CP français = stables à vie → TTL inutile, persistance permanente cross-deploy = bon modèle. Observabilité SQL (`hit_count`, `last_hit_at`) utile pour T-204 plan scaling.
>
> 🟢 **Migration DB** : `supabase/migrations/20260506181153_t219_geocode_cache.sql` (à appliquer manuellement via Supabase Studio). Table + 4 CHECK + 2 index + 2 policies RLS (public read, service-role write) + 2 RPC atomiques (`bump_geocode_cache` UPDATE...RETURNING, `upsert_geocode_cache` INSERT...ON CONFLICT préserve `resolved_at`).
>
> 🟢 **Backend** :
> - `lib/geo/geocode-cache.ts` (3 fonctions `getCachedGeocode` / `setCachedGeocode` / `resolvePostalCode` orchestrateur). Validation Zod CP, fail-safe (null/false sur input invalide). Pas de log par-IP / par-User.
> - `app/api/geocode/route.ts` GET — Zod validation, rate-limit Upstash 30/min/IP via nouveau helper `getGeocodeRateLimit()`, mapping erreurs typées → HTTP (400/404/429/502), Cache-Control `public, max-age=2592000` (30 jours).
>
> 🟢 **Frontend** :
> - `lib/geo/geocode-postal-client.ts` — nouveau helper navigateur `geocodePostalCodeViaApi` qui fetch `/api/geocode` (signature symétrique avec `geocodePostalCode` pour limiter le diff côté widget).
> - `app/(public)/producteurs/[slug]/_components/DistanceWidget.tsx` — bascule sur `geocodePostalCodeViaApi`. UX préservée (timeout 8s, validation regex, messages d'erreur typés). 2 nouveaux codes côté client (`rate_limited`, `upstream_unavailable`) + messages FR ajoutés dans `GEOCODE_POSTAL_ERROR_MESSAGES`.
> - `lib/geo/geocode-postal.ts` conservé — plus appelé côté client mais reste utilisé côté serveur par `geocode-cache.ts:resolvePostalCode` sur le path cache miss.
>
> 🟢 **PrivacyNote DistanceWidget mis à jour** pour refléter la nouvelle chaîne (le CP transite via TerrOir, cache anonyme côté serveur, avant l'appel à gouv.fr). Wording explicite « n'est jamais associée à ton compte ni à ta visite côté serveur » qui préserve la promesse RGPD T-200 r1 sans mentir sur le passage par TerrOir. Suivi T-207 : réintroduire un `<Link>` cliquable au moment de la livraison de la politique de confidentialité globale.
>
> 🟢 **Continuité T-200 r1** documentée formellement (`docs/fixes/geocode-cache-2026-05-06.md`) : aucune des 4 contraintes substantielles n'est violée — CP = donnée publique INSEE (pas PII), pas de colonne IP dans `geocode_cache`, pas de jointure user→cp, `hit_count` agrégé anonyme, AUCUN `INSERT` dans `audit_logs` côté route (verrou explicite dans le test).
>
> 🟢 **Tests vitest** :
> - `tests/lib/geo/geocode-cache.test.ts` (23 tests) : cache hit/miss/UPSERT/bump RPC, validation Zod, plages WGS84, fail-safe, contrat T-200 r1 (signatures sans IP/userId/userAgent).
> - `tests/app/api/geocode/route.test.ts` (14 tests) : validation querystring, happy path 200 cache hit / cache miss, mapping erreurs (400/404/429/502), Cache-Control 30j, **verrou anti-audit-log** (la route ne fait JAMAIS d'`INSERT audit_logs`).
> - `tests/app/producteurs/distance-widget.test.tsx` (existant, ajusté wording RGPD T-219).
>
> 🟢 **Backlog associé** : T-204 partiellement clôturée (cache en place, plan B fournisseur T-226 reste ouvert). T-207 mis à jour (réintroduire Link au go-live). T-237 (tests interactifs widget) bénéficiera du mock `/api/geocode`.
>
> 🧪 **Tests effectués** : 37 nouveaux tests verts (23 + 14). Suite complète Vitest 2091 verts, zéro régression.
>
> ⚠️ **À faire avant prod** : appliquer la migration `20260506181153_t219_geocode_cache.sql` manuellement via Supabase Studio ou MCP Supabase. La route `/api/geocode` retournera `502 upstream_unavailable` tant que la table + RPC ne sont pas en base.

---

## 2026-05-06 (T-217 politique uniforme floutage coordonnées producteur)

> Formalisation Option A (maintien `roundCoord` 2 décimales sur les 4 surfaces publiques) après audit T-217 préalable. Le chantier ne modifie aucun comportement runtime — la garantie au runtime est strictement identique à T-200 r3. Il ferme le trou de couverture de tests (le contrat sécurité de la fiche slug n'avait pas de verrou, contrairement à `/api/producers/search`).
>
> 🟢 **Décision** : Option A retenue (status quo `roundCoord` 2 décimales, ~1.1 km lat). Options B (commune-centroïde, ~5-10 km) et C (grille 1 km snap) explicitement écartées — la menace dominante T-227 est photos+commune, pas GPS, donc B/C ne résolvent pas le vrai risque pour un coût élevé (B = ~500 LOC + 3 migrations DB).
>
> 🟢 **Test contractuel ajouté** : `tests/app/(public)/producteurs/[slug]/page.test.tsx` (3 cas — floutage 2 décimales, scan exhaustif, propagation `null`). Pattern `findByName` sur l'arbre ReactElement (env=node, pas de jsdom), cohérent avec `tests/app/(producer)/invitation/page.test.tsx`. Le test mocke uniquement la couche Supabase + `unstable_cache` + `notFound`, et utilise le vrai `fetchPublicProducerBySlug` → si quelqu'un casse `roundCoord` côté fetcher, le test pète.
>
> 🟢 **Pas de `roundCoord` défensif au niveau page** : décision documentée dans `docs/fixes/coords-privacy-policy-2026-05-06.md`. Quatre raisons (DRY, lisibilité, bon signal anti-régression via test, cohérence avec pattern route search). Note explicite pour les futurs audits : si quelqu'un re-conclut "fuite ligne 118-119 de page.tsx" sans tracer la source du `producer`, c'est un faux positif — `producer` provient de `fetchCachedProducerBlock` → `fetchPublicProducerBySlug` qui floute déjà.
>
> 🟢 **Doc nouvelle** : `docs/fixes/coords-privacy-policy-2026-05-06.md` — rationale Option A, liste des 4 call sites verrouillés, helper canonique, modèle d'attaque résiduel T-227, recommandations privacy producteur (ne pas publier photos exploitation + adresse exacte ensemble), backlog defense in depth (T-235 vue Postgres, T-236 rate-limit, T-238 scan auto), continuité T-200 r1/r2/r3.
>
> 🟢 **Backlog inchangé** : T-227 (étude ré-identification par croisement) reste ouvert pour reprogrammation, T-235/T-236/T-238 restent prérequis Live (cf. T-244 priorisation).
>
> 🧪 **Tests effectués** : 3 nouveaux tests verts (`tests/app/(public)/producteurs/[slug]/page.test.tsx`). Pas de régression sur les tests existants (coords + route search).

---

## 2026-05-03 (T-081 Phase 3 finale audit logs cluster `admin_invite_*`)

> Bouclage Phase 3 du chantier audit_logs (T-081) : 5 trous restants comblés sur le flow d'invitation producer. Les 13 events précédents (Phase 1 auth + Phase 2 payment + Phase 2bis retry refund + T-081 PR-A + T-307/T-309/T-310 cluster invitation) restent inchangés. Total post-T-081 : 18 event types Auth (cf. `lib/audit-logs/log-auth-event.ts` const `AUTH_EVENT_TYPES`).
>
> 🟢 **5 nouveaux event types** (cluster `admin_invite_*`) :
> - `admin_invite_sent` — émis sur `/api/admin/producers/invite` après `sendTemplate` succès, envoi initial. metadata `{ invitation_id, invitation_email, resend_id }`. userId = admin créateur.
> - `admin_invite_draft_resend` — même call site, mais branche `isDraftResend=true` (relance d'un onboarding producer abandonné, `producer.statut='draft'` + flag `confirm_draft_resend=true` UI). Mutuellement exclusif avec `admin_invite_sent` : un POST émet l'un OU l'autre, jamais les deux. Permet aux queries forensiques de distinguer les patterns funnel acquisition initial vs réactivation.
> - `admin_invite_blocked_admin` — pré-check 409 (email déjà admin). metadata `{ invitation_email }`. Pas de bump invitation_created (sortie avant l'INSERT).
> - `admin_invite_blocked_producer` — pré-check 409 (email déjà producteur inscrit, statut hors `'draft'`). metadata `{ invitation_email, statut }` (granularité `pending|active|public|suspended|deleted` côté metadata, sémantique stable côté event_type). Le 409 `draft_resend_confirm_required` n'émet PAS d'event (demande de confirmation UX, pas un blocage strict).
> - `admin_invite_expired` — câblé sur les 4 server actions producer/* (`create-account`, `login-and-upgrade`, `accept-invitation`, `complete-onboarding`) sur le check `expires_at < now()`. metadata `{ invitation_id, token_prefix, surface }` — `surface` discrimine entre les 4 sites sans nouveau event_type. userId nullable (null sur create-account + login-and-upgrade, session.id sur accept-invitation + complete-onboarding).
>
> 🟢 **Tests vitest** (1 commit) :
> - Smoke test type-check étendu aux 5 nouveaux event types (`tests/lib/audit-logs/log-auth-event.test.ts`).
> - 9 nouveaux tests sur `tests/app/api/admin/producers/invite/route.test.ts` describe "J. T-081" (J1 sent, J2 draft_resend, J3 ni-l'un-ni-l'autre quand email fail, J4 blocked_admin, J5 ×5 statuts blocked_producer, J6 pas-d'event sur draft_resend_confirm_required).
> - 4 tests sur les server actions producer/* (1 par site pour `admin_invite_expired` avec assertion userId + surface + token_prefix).
>
> ⚠️ **Note sur le décompte sites `admin_invite_expired`** : l'inventaire initial mentionnait 3 sites (`create-account`, `accept-invitation`, `complete-onboarding`). Au câblage, le 4e site identique sémantiquement (`login-and-upgrade.ts:60-61`, oublié dans l'inventaire) a été couvert par cohérence forensique — ne pas l'instrumenter aurait laissé un trou évident sans justification. La page GET `/invitation` (point d'entrée du clic email réel) n'a PAS été instrumentée : risque de bruit (link prefetchers email clients potentiels) sans gain forensique majeur (les 4 server actions captureront le user au moindre clic UI subséquent).
>
> 🧪 **Tests effectués** : type-check strict zero warning + suite Vitest complète verte (Playwright skippé : pas d'impact UI utilisateur). Pas de migration DB (les events réutilisent la table `audit_logs` existante, schéma `event_type TEXT` côté DB — l'union TypeScript en application sert de contrat doc/dev seul).

---

## 2026-04-30 (T-013 Secure Email Change refonte)

> Refonte du flow de changement d'email côté `/compte/profil` depuis Supabase Secure Email Change (lien magique asynchrone double confirmation) vers un flow custom 2 OTP successifs in-session (modèle Amazon-like). Architecture en 3 PRs :
>
> - **PR1 (#87 mergée matin 30/04, premier write-prod via MCP Supabase CC)** : schéma DB pose UNIQUE preventive sur `lower(public.users.email)` + tables `email_change_otp_codes` + `email_change_undo_tokens` + filet sécurité (toggle Dashboard "Secure email change" laissé ON volontairement). Migration `20260430161902` apply prod via `mcp__supabase__apply_migration`. Premier usage du MCP Supabase configuré aujourd'hui — workflow CC + MCP standard documenté ([`METHODOLOGY.md`](./METHODOLOGY.md) section "Migrations DB"). Gotcha timestamp détecté : MCP génère son propre timestamp à l'apply, fix via `git mv` du fichier disque pour matcher tracking DB.
>
> - **PR2 (cette PR, à merger après preview tests)** : flow OTP code (helpers + templates + 3 server actions + UI stepper) — détail ci-dessous.
>
> - **PR3 (à venir, hors scope cette CHANGELOG)** : route `/api/email-change/undo` + persistance `email_change_undo_tokens` à completion + email Resend post-fait à l'ancienne adresse pour annulation 7 jours.

### PR2 — flow OTP custom + UI stepper (14 commits atomiques C2.1 → C2.14)

🟢 **Layer helpers** (3 commits) :
- **C2.1 HMAC Web Crypto** (`lib/email-change/hmac.ts`) : sign + verify constant-time avec `crypto.subtle`. Fail-fast au module-load sur `EMAIL_CHANGE_OTP_SECRET` absent. Singleton key cache. Pattern aligné T-321.
- **C2.2 OTP generator bias-free** (`lib/email-change/otp.ts`) : 6 chiffres via `crypto.getRandomValues` + rejection sampling (~0.023% rejets). `isValidOtpFormat` strict ASCII /^\d{6}$/ (anti-collision homoglyphes unicode).
- **C2.3 Rate-limit DB-based** (`lib/email-change/rate-limit.ts`) : 3/60s par (userId, step) via COUNT sur `email_change_otp_codes`. Fail-open sur erreur DB. Pattern différent d'Upstash (T-305) qui sert les call sites haute fréquence.

🟢 **Layer email** (1 commit) :
- **C2.4 Templates Resend** : `email-change-otp-current` (à ancienne adresse, affiche newEmail anti-phishing) + `email-change-otp-new` (à nouvelle adresse, sans révéler ancienne). Code OTP rendu en gros monospace (32px letterSpacing 6), validity 10min, disclaimer sécurité.

🟢 **Layer server actions** (3 commits) :
- **C2.5 requestOtp** : auth + Zod + rate-limit + INVALIDATE rows précédents + INSERT row + sendTemplate + audit log `account_otp_requested`.
- **C2.6 verifyOtp** : auth + format check + SELECT latest row + check expiration + cap attempts (5 = invalidation atomique sur la 5e wrong) + verifyHash constant-time. Audit logs granulaires (verified/invalid/expired/attempts_exceeded).
- **C2.7 completeEmailChange** : auth + defensive recheck (2 SELECT cohérence step=current+new consumed + email match) + `admin.auth.admin.updateUserById` + UPDATE `public.users` + `userClient.auth.signOut({ scope: 'others' })` + audit log `account_email_change_completed`. Workaround découvert : `auth.admin.signOut` requiert un JWT, pas un userId — d'où le passage par userClient (cf LESSONS section dédiée).

🟢 **Layer UI** (3 commits) :
- **C2.8 Refonte ChangeEmailSection** : state machine `idle → enter-email → verify-current → verify-new → completed` + step 1 (input email) + suppression legacy `_actions/change-email.ts` (utilisait l'anti-pattern `auth.updateUser({email})`) + cleanup commentaires stale dans `email-redirect.ts` + `compte/profil/page.tsx`.
- **C2.9 Step 2 (verify-current)** : extraction sous-composant `VerifyOtpStep` (réutilisable step 2+3) + bouton "Renvoyer le code" cooldown 30s + chaining auto vers requestOtp(new) post-verify ok.
- **C2.10 Step 3 (verify-new) + completion** : VerifyOtpStep réutilisé + chaining auto vers completeEmailChange post-verify ok + écran succès `CompletedStep` + `CompleteErrorPanel` pour erreurs (collision UNIQUE, désynchro). ChangeEmailSection.tsx maintenu sous le seuil 300 lignes via extraction sous-composants.

🟢 **Layer tests** (2 commits) :
- **C2.11 Integration full flow** : 5 scénarios cross-actions (happy path 5 actions chaînées + audit logs cumulés cohérents 5 events, collision UNIQUE sur completion, re-request invalidates, rate-limit hit, wrong code).
- **C2.12 Concurrency edge cases** : 7 scénarios state-machine (verify code obsolète post re-request, cap attempts perpétuel post-invalidation, complete prématuré flow_invalid, email tampering newRow.email !== newEmail).

🟢 **Layer docs** (2 commits) :
- **C2.13 LESSONS + CHANGELOG** (cette entrée).
- **C2.14 TODO + HANDOFF** : T-016 cron purge `email_change_otp_codes` rows expirées + T-018 doc Vercel CLI workflow METHODOLOGY (capitalise setup d'aujourd'hui) + statut PR3 = SUITE T-013.

⚙️ **Action externe Romain** :
- `EMAIL_CHANGE_OTP_SECRET` configuré Vercel All Environments (sensitive mode via Vercel CLI) + `.env.local` (commit C2.5 prep). Bonus session : Vercel CLI v52.2.1 installée globalement + repo lié projet `terr-oir-21cl` (capitalise pour T-018 doc post-merge).

🧪 **Tests effectués** : 109 fichiers vitest, 1258 baseline + nouveaux tests PR2 → tous verts. Lints + tsc strict zero warning.

⚠️ **Méthodologie / nouveautés capitalisées** :
- **Workflow CC + MCP Supabase pour migrations** (T-013 PR1) : premier write-prod réussi via `apply_migration`. Calibrage dual-GO (display tool call + GO 1, exec tool + GO 2) testé et validé. Gotcha timestamp documenté. Ouvre la voie pour automatiser les apply prod côté CC sans Studio Editor manuel.
- **Anti-pattern `supabase.auth.updateUser({email})` officiellement proscrit** : LESSONS section dédiée, applicable à tout flow futur qui touche à l'email. Toujours `auth.admin.updateUserById` côté service_role + sync `public.users` manuelle.
- **Pattern flow OTP custom multi-étape** : reproductible pour autres flows sensibles (ex: futur reset password custom, transfert producteur, etc.). Composants HMAC + OTP gen + rate-limit + 2 actions (request, verify) + 1 action finale (commit) + UI stepper sous 300 lignes via extraction sous-composants.
- **API Supabase JS limitation `auth.admin.signOut(jwt, scope)`** : la signature requiert un JWT, pas un userId. Workaround userClient (server client cookies-aware) documenté pour futurs flows qui force-logout.

---

## 2026-04-29 (purge audit Auth #1)

> Session marathon multi-terminal (TA/TB/TC/TD/TE) consacrée à la purge des findings de l'audit Auth #1 Cluster A/B/C/D + mineurs/cosmétiques + bloqueurs lancement code. **16 PRs mergées sur master** sur la séance complète (continuations cumulées). Master HEAD final : `d1be726` post-merge PR #48 T-325. **Audit Auth #1 close côté code** ; bloqueurs lancement résiduels non-code (T-041 pages légales + T-046 HIBP Pro plan).
>
> 🟢 **Chantiers majeurs clos par cluster** :
> - **Cluster A `auth/inscription/*`** (TC, PR #33 squash `4afa2e4`) — T-300 confirmation email signup activée + T-301 compensation orphelin `admin.auth.admin.deleteUser` symétrique + T-313 enumeration-resistance signup `{ success: { email } }` identique happy/error paths.
> - **Cluster B `invitation/_actions/*`** (TB+TC, PRs #36 `8163f88` + #38 `8f60412` + #40 `9648525`) — T-303 GET → POST anti-CSRF, T-302+T-304 enumeration-resistance + compensation orphelin `create-account.ts` + `login-and-upgrade.ts`, T-307 audit log `invitation_consumed_race_lost`, T-310 complet (3 events câblés `invitation_created`/`invitation_consumed_success`/`invitation_consumed_race_lost` + 1 pré-déclaré `invitation_revoked`).
> - **Cluster C `connexion/*` + `callback/*`** (TE, PRs #34 `358801f` + #42 `ec83876` + #47 `354de7d`) — T-318 mapping FR codes symboliques erreurs callback (4 codes `expired/invalid/missing/technical`), T-317 host header injection `requestPasswordResetAction`, T-309 audit log `login_failed` + helper inline `classifyLoginError` (4 codes EN-neutre `invalid_credentials/email_not_confirmed/rate_limited/technical`), T-314 hardening `sanitizeNext` extraction `lib/auth/sanitize-next.ts` + reject control chars + dangerous schemes + `/\\` gap principal.
> - **Cluster D `compte/*`** (séance précédente) — T-315 + T-327 (bug latent flow profil email change).
> - **Mineurs/cosmétiques** (TC, PR #41 `2417b04`) — T-319 helper `lib/auth/role-switcher-urls.ts` extracted (RoleToggle + RoleSwitcher) + T-322 `token_prefix` retiré metadata Resend invitation flow.
> - **T-305 rate-limit complet** (TA infra PR #35 `8c9f069` + TC intégration PR #46 `ba4857c`) — PR-A infra Upstash Redis sliding window + helpers `getSignupRateLimit/getLoginRateLimit/getRecoveryRateLimit` (5/60s signup-login, 3/60s recovery par IP). PR-B intégration 6 call sites auth + audit log `rate_limit_exceeded` (signup + login + magic_link mutualisé + recovery + invitation create-account + invitation login-and-upgrade). Wording erreur générique `"Trop de tentatives. Réessayez dans quelques minutes."` Bloqueur lancement public levé.
> - **T-316 cross-tab session sync** (TA, PR #39 `3508082`) — `lib/auth/cross-tab-auth-sync.ts` BroadcastChannel API avec fallback no-op + listener `UserProvider`. SIGNED_OUT/SIGNED_IN/USER_UPDATED propagés cross-tab même origin sans refresh manuel.
> - **T-321 middleware perf cache role snapshot cookie HttpOnly** (TB, PR #44 `98ffd53`) — `lib/auth/role-snapshot-cookie.ts` Web Crypto API HMAC-SHA256 + cookie isolation Chantier 4 (`__terroir_role_snapshot` www/pro shared `.terroir-local.fr` vs `sb-admin-role-snapshot` admin exclusif) + middleware fast-path 3 call sites cachables (admin lookup + pro roles lookup + parallel needsAuth) + invalidation triggers (login success + logout + callback OTP + role_changed login-and-upgrade + role_changed accept-invitation). 2 queries DB économisées par request authentifiée (~50-100ms gagnés). TTL 15 min. **Bug Edge Runtime crypto Node natif détecté + fix Web Crypto API async** (cf LESSONS.md section dédiée).
> - **T-323 slugFromEmail extraction** (TA, PR #43 `f6aa8a4`) — duplication strictement identique 3 fichiers `_actions/*` extraite vers `lib/producers/slug-from-email.ts` pure function + 5 tests vector matrix (standard + accents + majuscules + spéciaux + randomness).
> - **T-327 bug latent flow profil email change** (TA, PR #32 `ee43444`) — fix bug latent post-merge T-315 doc Word audit.
> - **T-328 hardcode prod URLs `lib/auth/email-redirect.ts`** (TA, PR #45 `05df0c3`) — 4 constantes refondues env-driven `${NEXT_PUBLIC_*}/path` (fail-fast strict via `lib/env/urls.ts`, antimagne T-317 préservée env build-time ≠ donnée runtime). Tests preview Change Email + Magic Link + Reset Password + Confirm Signup possibles maintenant. Action externe Romain : `NEXT_PUBLIC_ADMIN_URL=https://admin.terroir-local.fr` configuré Vercel All Environments.
> - **T-325 refactor env vars hostnames** (TA, PR #48 `d1be726`) — 3 fichiers landing/UI basculés env-driven (`pro-accueil/page.tsx` + `admin-accueil/page.tsx` URL technique lignes 41/50 + `footer.tsx`) + texte UX visible `admin-accueil` lignes 44/53 hardcoded (label distinction URL technique). Catégorie B intentionnelle préservée (`cookie-domain/redirect-cookie/role-snapshot/post-login-redirect/middleware/connexion-layout` = apex prod cookies partagés multi-subdomain). `lib/twilio/sms.ts` skip (texte communicationnel).
>
> ⚠️ **Méthodologie / nouveautés capitalisées** :
> - **Bug Edge Runtime crypto Node natif détecté via Vercel logs** (T-321 PUSH 2.5 fix) : `middleware.ts` Next.js tourne en Edge Runtime, pas Node.js runtime. `crypto.createHmac` + `timingSafeEqual` Node natif **incompatibles Edge Runtime**. Bug NON détecté par auto-QA Vitest (Node runtime, false positive) ni Build Vercel (compile-time OK). Détection uniquement via runtime preview Vercel `MIDDLEWARE_INVOCATION_FAILED` + Vercel logs JSONL. **Fix : refacto Web Crypto API `crypto.subtle.sign/verify` async** (cascade async sur 3 fichiers app + 2 fichiers tests). Invariant méthodologique gravé pour TerrOir (cf LESSONS.md section dédiée).
> - **Pattern fail-fast env vars vs fallback silencieux** (commit `ef7f10b` "localhost a déjà fait perdre du temps en prod") — convention projet TerrOir prime sur defense-in-depth dans helper. Tests existants nécessitent stubs `process.env ??=` dans `vi.hoisted` ou pré-import. Coût attendu accepté vs fallback silencieux. Cohérent T-328 + T-325 séance courante. Pattern stub réutilisable pour tester n'importe quelle route qui touche aux env vars hostnames.
> - **Pattern recovery merge `gh CLI`** (TC PUSH 3 PR #46) : si `gh CLI` plante (scope OAuth restreint, master locked worktree TD), fallback **REST API curl + node payload writer** (POST `/repos/{owner}/{repo}/pulls` + payload JSON construit via node throw-away). Token `gho_*` du Git Credential Manager. Pattern documenté pour chantiers futurs si auth gh inline plante. Recovery DELETE branche : `gh api -X DELETE repos/{}/git/refs/heads/<branche>`.
> - **Pattern résolution conflit AuthEventType union** (TE T-309 + TC T-305 PR-B rebases) : conflits récurrents sur `lib/audit-logs/log-auth-event.ts` quand plusieurs PRs ajoutent entries en parallèle. Résolution : garder TOUTES les entries ordre chronologique d'ajout + commentaires dédiés respectifs préservés. `git rebase origin/master` + `git push --force-with-lease` standard.
> - **Pattern audit log forensique préfixe greppable** (cohérent T-318 + T-309 + T-317 + T-314 + T-305 PR-B + T-310) : format `[AUDIT_TYPE] reason=<reason> raw_length=<n>` côté logs Vercel. PAS de raw verbatim (anti log forging + anti PII). Reasons enum strict (no injection vector). Cohabitation avec audit_logs DB-only (pas de console.warn applicatif redondant).
> - **Pattern compensation orphelin `admin.auth.admin.deleteUser`** (T-301 + T-302 + T-304 + Cluster B) — symétrique reproductible : si auth signup/upgrade OK + DB insert KO → `deleteUser` rollback. Évite users orphelins en `auth.users` sans row applicative.
> - **Pattern enumeration-resistance strict** (T-301 + T-302 + T-304 + T-313) — `{ success: { email } }` identique happy path et error path vs message générique unique selon contexte. Anti-énumération comptes existants. Distinct du pattern wording erreur côté UI.
> - **Pattern bundling cohérent "on évite la dette technique"** : T-300+T-301+T-313 PR #33, T-302+T-304 PR #38, T-319+T-322 PR #41, T-310 complet PR #40. Plusieurs findings cohérents fonctionnellement bundlés en 1 PR plutôt que sub-PRs séparés.
> - **Pattern worktrees dédiés `terroir-XX-tNNN` validés systématiquement** : 13+ worktrees créés cette séance (`terroir-tb-t302`, `terroir-tb-t303`, `terroir-tb-t307`, `terroir-tb-t310`, `terroir-tb-t321`, `terroir-tc-batch`, `terroir-tc-t300`, `terroir-tc-t315`, `terroir-tc-t305-prb`, `terroir-ta-t323`, `terroir-ta-t328`, `terroir-ta-t325`, `terroir-te-t309`, `terroir-te-t317`, etc.). Junction `node_modules` + `cp .env.local` instantanés. Évite contamination working tree partagé multi-terminal (cf LESSONS.md `5e1a48a` + `11b914e` + `894fa5e`).
> - **Vercel SSO bloque accès curl externe preview** (TC + TB diagnostic T-305 PR-B test) : preview Vercel team protégés par SSO retournent 401 sur curl anonyme. Server Actions Next 14 hostiles au curl scripté (Next-Action header hashé build-time, body multipart, Origin/Referer matching). 3 approches identifiées : DevTools "Copy as cURL" + node payload, auto-extraction Next-Action fragile, SKIP test preview (auto-QA exhaustive + pattern uniforme + validation prod réelle post-merge). Voie SKIP retenue pour T-305 PR-B (mur technique, pas soft-fail).
> - **Skip motivés findings audit Auth #1** archivés : T-320 (e2e cross-tab session sync, ROI faible setup framework e2e + 5 tests unit T-316 broadcaster suffisants + validation manuelle Romain), T-324 (status quo cookie redirect_after_auth scope acceptable), T-326 (déjà capitalisé `docs/TODO.md` Vision funnel Phase 3), T-308 (close direct via T-300 callback `route.ts:154-165` audit `account_signup`).

### Cluster A finalisation (chantier TC, PR #33 squash `4afa2e4`)

- **T-300 confirmation email signup** : action externe Romain Dashboard Supabase ON activée début continuation 2 (bloqueur initial levé). Auto-login retiré post-confirmation, message "Vérifiez vos emails" affiché à la place du redirect `/compte`.
- **T-301 compensation orphelin signup** : pattern `admin.auth.admin.deleteUser` symétrique si auth signup OK + DB insert KO. Préserve invariant zéro user orphelin `auth.users` sans `public.users`.
- **T-313 enumeration-resistance signup** : `{ success: { email } }` identique happy path et error path. Anti-énumération comptes existants côté UI. Cohérent pattern enumeration-resistance Cluster B.
- **Auto-QA** : tsc clean ✓ | vitest baseline ✓ | lint clean ✓ | build OK ✓.

### Cluster B finalisation (chantiers TB+TC, PRs #36 `8163f88` + #38 `8f60412` + #40 `9648525`)

- **T-303 GET → POST anti-CSRF** (TB, PR #36 squash `8163f88`) : auto-upgrade GET → POST sur route invitation accept pour défense CSRF. Pattern auto-QA assertion mock count = 0 pendant render anti-CSRF.
- **T-302 + T-304 enumeration-resistance + compensation orphelin** (TC, PR #38 squash `8f60412`) : `create-account.ts` + `login-and-upgrade.ts` enrichis pattern enumeration-resistance + `admin.auth.admin.deleteUser` symétrique. Cohérent T-301 Cluster A.
- **T-310 complet audit log invitation flow** (TB, PR #40 squash `9648525`) : 3 events câblés (`invitation_created` POST `/api/admin/producers/invite`, `invitation_consumed_success` `completeOnboardingAction` success path, `invitation_consumed_race_lost` déjà mergé séance précédente T-307) + 1 pré-déclaré (`invitation_revoked` Option A — fonction admin de révocation absente, type `AuthEventType` prêt côté `lib/audit-logs/log-auth-event.ts`, câblage = juste 1 appel `logAuthEvent` côté future server action de révocation, coût zéro). Cluster B couverture forensique complète flow invitation producer.

### Cluster C finalisation (chantiers TE, PRs #34 `358801f` + #42 `ec83876` + #47 `354de7d`)

- **T-318 mapping FR codes symboliques erreurs callback** (TE, PR #34 squash `358801f`) : 4 codes catégoriels `expired/invalid/missing/technical` mappés depuis `verifyOtp` errors. Préserve enumeration-resistance UI (pas de signal différentiel selon que l'OTP est expiré ou invalide).
- **T-317 host header injection `requestPasswordResetAction`** : whitelist hostnames stricte vs `request.headers.host` non-vérifié. Préserve antimagne contre redirect attacker-controlled cross-domain.
- **T-309 audit log `login_failed`** (TE, PR #42 squash `ec83876`) : helper inline `classifyLoginError(code, message)` ~22L mappant `signinError` vers 4 codes EN-neutre `invalid_credentials/email_not_confirmed/rate_limited/technical`. `logAuthEvent({ eventType: "login_failed", userId: null, metadata: { email, reason_code } })` câblé fail path `loginAction`. IP + UA auto-extraits par `logAuthEvent` interne (`resolveRequestContext`). Surveillance forensique brute-force / énumération possible via grep `audit_logs` Supabase Dashboard. **Rebase trivial post-T-310** : conflit AuthEventType union résolu garder LES DEUX additions (T-310 entries puis T-309 login_failed) ordre chronologique d'ajout.
- **T-314 hardening `sanitizeNext`** (TE, PR #47 squash `354de7d`) : extraction helper `lib/auth/sanitize-next.ts` (NEW +73L) + 27 tests vector matrix exhaustive (vs 18 plan, +9 cas overdelivery). 12 vectors couverts : URL absolues + protocol-relative `//` + backslash `/\\` (gap principal fixé) + schemes dangereux `javascript|data|file|vbscript` case-insensitive + control chars `[\r\n\0\t]` (anti CRLF log forging + null byte). Logging forensique format greppable `[SANITIZE_NEXT_REJECTED] reason=<reason> raw_length=<n>` (pas de raw verbatim, anti log forging + anti PII). Sister helper `isValidRedirectPath` (`post-login-redirect.ts`) **INTACT** par décision (asymétrie historique consolidée vs extension périmètre risquée). Cluster C close 5/5.

### Mineurs/cosmétiques (chantier TC, PR #41 squash `2417b04`)

- **T-319 helper `lib/auth/role-switcher-urls.ts` extracted** : duplication `RoleToggle` (navbar consumer multi-rôle) + `RoleSwitcher` (sidebar admin/producer multi-rôle) refactor via helper pur `getRoleSwitcherUrls`. 10 tests helper + 4 invariants role-toggle.
- **T-322 `token_prefix` retiré metadata Resend invitation flow** : leak forensique vers tiers (Resend) supprimé. `token_prefix` reste tracé interne via `audit_logs` (forensique = DB-only, cohérent convention Phase 3).
- **Auto-QA** : tsc clean ✓ | vitest baseline + 10 helper + 1 enrichi ✓ | lint clean ✓ | build OK ✓.

### Bloqueurs lancement public (chantiers TA + TC, PRs #35 `8c9f069` + #46 `ba4857c` + #39 `3508082`)

- **T-305 PR-A infra rate-limit Upstash Redis** (TA, PR #35 squash `8c9f069`) : `lib/rate-limit.ts` sliding window + helpers `getSignupRateLimit/getLoginRateLimit/getRecoveryRateLimit` (5/60s signup-login, 3/60s recovery par IP). Pattern fail-open Redis indispo (cohérent fail-safe `logAuthEvent` Phase 3). Memoization via `@upstash/redis` SDK. 9 tests vitest infra. Action externe Romain : compte Upstash + database `terroir-rate-limit` Ireland (eu-west-1) Free tier + vars `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` Vercel All Environments + `.env.local`.
- **T-305 PR-B intégration 6 call sites auth + audit log `rate_limit_exceeded`** (TC, PR #46 squash `ba4857c`) : pattern code uniforme wrap pre-Supabase 6 call sites (signup + login + magic_link mutualisé `getLoginRateLimit` + recovery + invitation create-account + invitation login-and-upgrade mutualisés `getSignupRateLimit/getLoginRateLimit`). Insertion après `safeParse`, avant tout call Supabase coûteux. IP extraction via `extractRequestContext` existant (Vercel `x-forwarded-for` CSV + fallback `x-real-ip`). Wording erreur générique FR `"Trop de tentatives. Réessayez dans quelques minutes."` Metadata `{ route, cap, reset }` (pas `remaining: 0` redondant). 12 tests neufs (cap dépassé + cap OK pour chaque call site). **D4 SKIP `acceptInvitationAction`** (session-authed user déjà loggé + T-307 race-loss couvert protection mutuelle). **Rebase post-T-321 + T-328 + T-314 mergés entre temps** : conflit `app/(producer)/invitation/_actions/login-and-upgrade.ts` résolu union imports cookies + headers + clearRoleSnapshotOnStore + consumeRateLimit + getLoginRateLimit. Auto-QA verte 885/885 post-rebase. **Bloqueur lancement public majeur levé**.
- **T-316 cross-tab session sync** (TA, PR #39 squash `3508082`) : `lib/auth/cross-tab-auth-sync.ts` BroadcastChannel API avec fallback no-op + listener `UserProvider`. SIGNED_OUT/SIGNED_IN/USER_UPDATED propagés cross-tab même origin sans refresh manuel. 5 tests broadcaster (cross-instance + filter par type + isolation post-close + unsubscribe + fallback no-op). Test preview validé Romain (Tab 1 logout → Tab 2 navbar bascule "Connexion" sans refresh).

### T-321 middleware perf cache role snapshot cookie HttpOnly (chantier TB, PR #44 squash `98ffd53`)

- **Architecture cookie HttpOnly signé HMAC** : `lib/auth/role-snapshot-cookie.ts` (NEW ~280L) helpers `getRoleSnapshotSecret/signRoleSnapshot/parseAndVerifyRoleSnapshot/setRoleSnapshotCookie/clearRoleSnapshotCookie/readRoleSnapshotCookie`. Payload `{ user_id, roles, isAdmin, expires_at }`. Format value `base64url(JSON_payload).hex(HMAC-SHA256)`. Attrs httpOnly + secure (prod) + sameSite=lax + domain (`.terroir-local.fr` prod, undefined admin) + path=/ + maxAge=900 (15min).
- **Isolation Chantier 4 préservée** : `__terroir_role_snapshot` (www/pro shared `.terroir-local.fr`) vs `sb-admin-role-snapshot` (admin exclusif, no domain). Mirror exact `lib/supabase/cookie-domain.ts`.
- **Refacto middleware 3 call sites cachables** : L116-120 admin lookup + L145-149 pro roles lookup + L190-197 parallel needsAuth. `producers.statut` lookups L157-161 + L218-222 INTACTS (volatile draft↔active, hors scope cache). 2 queries DB économisées par request authentifiée (~50-100ms gagnés). `getUser()` reste source vérité auth (non cachable).
- **Invalidation triggers** : login success password (`loginAction` write fresh), login success magic link OTP (`callback/route.ts` write fresh), logout (`logout-action.ts` clear maxAge=0), `role_changed` `login-and-upgrade.ts` + `accept-invitation.ts` (clear, force DB lookup au prochain hit). `complete-onboarding.ts` PAS d'action (statut producer change, roles inchangés). Cross-tab T-316 PAS d'action (cookie HttpOnly server-only, partagé naturellement entre tabs).
- **Bug Edge Runtime crypto Node natif** (PUSH 2.5 fix) : commit initial `e22f14a` utilisait `createHmac` + `timingSafeEqual` Node natif → 500 `MIDDLEWARE_INVOCATION_FAILED` preview Vercel. Diagnostic via Vercel runtime logs JSONL. **Fix Web Crypto API async** : refacto helpers `crypto.subtle.sign/verify` (timing-safe intrinsèque) + `TextEncoder`/`TextDecoder` + `btoa/atob` (zéro Buffer). Cascade async sur 3 fichiers app (`middleware.ts` + `loginAction` + `callback/route.ts`) + 2 fichiers tests. **Auto-QA Vitest n'a PAS détecté le bug** (Node runtime, false positive). Build Vercel SUCCESS au compile-time pas garantie runtime Edge. Validation runtime preview Vercel obligatoire pour helpers middleware. Invariant méthodologique gravé pour TerrOir (cf LESSONS.md section dédiée).
- **Action externe Romain** : `ROLE_SNAPSHOT_SECRET` généré via `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (clé hexa 64 chars) + Vercel All Environments + `.env.local`. Sensitive masqué Vercel.
- **Test preview validé Romain** (post-fix Edge Runtime) : `/compte` charge sans 500 ✓ + cookie `__terroir_role_snapshot` écrit DevTools (Application > Cookies, value `base64.signature`, HttpOnly + SameSite Lax + Size 240 bytes) ✓ + cookie cleared post-logout ✓.
- **Auto-QA** : tsc clean ✓ | vitest 864/864 (post-fix Edge Runtime) ✓ | lint clean ✓ | build OK (Middleware bundle 81 kB stable) ✓ | grep `import crypto Node` côté middleware = 0 (defense vs régression future) ✓.

### T-323 slugFromEmail extraction (chantier TA, PR #43 squash `f6aa8a4`)

- **Refactor pur extraction** : duplication strictement identique byte-for-byte 3 fichiers `_actions/*` (`accept-invitation.ts:15-19` + `create-account.ts:9-13` + `login-and-upgrade.ts:10-14`) extraite vers `lib/producers/slug-from-email.ts` (NEW pure function). Cohérent helpers similaires existants `lib/producers/*` kebab-case (`get-display-name.ts` + `promote-to-public.ts` + `fetch-public.ts` + etc.).
- **5 tests vector matrix** : email standard `john.doe@example.com` → préfixe `john-doe-` + suffixe 6 chars + email avec accents `émile@x.fr` → caractères non-ASCII → tirets + email majuscules `Foo.Bar@x.fr` → lowercase + caractères spéciaux `+_!@x.fr` → tirets fusionnés + randomness 2 appels même email → suffixes différents.
- **T-308 close direct sans code** : Scénario A confirmé Cluster A `account_signup` audit déjà couvert via T-300 `callback/route.ts:154-165` post-`verifyOtp` avec metadata `source: "consumer_signup_form"` (commit `4afa2e4` Cluster A merge).
- **Auto-QA** : tsc clean ✓ | vitest baseline + 5 nouveaux tests T-323 ✓ | lint clean ✓ | build OK ✓.

### T-327 bug latent flow profil email change (chantier TA, PR #32 squash `ee43444`)

- **Fix bug latent post-merge T-315** : flag par doc Word audit, scope Cluster D `compte/*`. Détails côté doc audit Auth (séance précédente).

### T-328 hardcode prod URLs `lib/auth/email-redirect.ts` (chantier TA, PR #45 squash `05df0c3`)

- **3 reflags tranchés PUSH 1** : Q1 fail-fast strict (cohérence projet `lib/env/urls.ts` commit `ef7f10b` "pas de fallback silencieux car localhost a déjà fait perdre du temps en prod"), Q2 `NEXT_PUBLIC_APP_URL` Vercel valeur réelle = `https://www.terroir-local.fr` (avec www) confirmée Romain, Q3 scope effectif 4 constantes seulement (pas 6 — magic link réutilise déjà `getAuthCallbackUrl`, pas de `MAGIC_LINK_*_CALLBACK` constantes).
- **Refonte 4 constantes env-driven** : `AUTH_CALLBACK_ADMIN/DEFAULT` + `PASSWORD_RESET_ADMIN/DEFAULT` refondues `${NEXT_PUBLIC_*_URL}/path`. Helpers `getAuthCallbackUrl(isAdmin)` + `getPasswordResetUrl(isAdmin)` signatures préservées (call sites intacts).
- **`lib/env/urls.ts` enrichi** : `NEXT_PUBLIC_ADMIN_URL` ajouté fail-fast strict (mirror `NEXT_PUBLIC_APP_URL` pattern projet). Throw au module-load si manquante.
- **Antimagne T-317 préservée** : env build-time ≠ donnée externe runtime. Pas de host header injection vector réintroduit (env vars build-time injectées au build Vercel, pas modifiables runtime).
- **Élargissement scope tests** : 14 fichiers tests existants chargent transitivement `lib/env/urls.ts` et cassent sur throw fail-fast `Missing NEXT_PUBLIC_ADMIN_URL`. Patch via stubs `process.env.NEXT_PUBLIC_ADMIN_URL ??=` dans `vi.hoisted` ou pré-import (pattern projet réutilisé). Coût attendu fail-fast strict, pas scope creep.
- **Action externe Romain** : `NEXT_PUBLIC_ADMIN_URL=https://admin.terroir-local.fr` configuré Vercel All Environments + `.env.local`. Tests preview Change Email + Magic Link + Reset Password + Confirm Signup possibles maintenant (testabilité restored).
- **Auto-QA** : tsc clean ✓ | vitest 839/839 (+9 nouveaux T-328) ✓ | lint clean ✓ | build OK ✓.

### T-325 refactor env vars hostnames (chantier TA, PR #48 squash `d1be726`)

- **3 reflags tranchés PUSH 1** : Q1 scope 3 fichiers (`pro-accueil` + `admin-accueil` + `footer.tsx`) skip `lib/twilio/sms.ts` (texte SMS communicationnel user-facing branding), Q2 texte UX visible `admin-accueil` lignes 44 & 53 hardcoded (label distinction URL technique vs label UX, preview Vercel hostname long technique illisible casse UX), Q3 catégorie B EXCLUE (`cookie-domain/redirect-cookie/role-snapshot/post-login-redirect/middleware/connexion-layout` — design intentionnel apex prod cookies `.terroir-local.fr` partagés multi-subdomain, refacto casserait cookies preview Vercel).
- **3 fichiers refondus env-driven** : `app/pro-accueil/page.tsx` (lines 5-6) imports `NEXT_PUBLIC_APP_URL` + `APPLY_URL`/`CONSUMER_URL` templates. `app/admin-accueil/page.tsx` (lines 41 + 50) imports `NEXT_PUBLIC_PRODUCER_URL` + `NEXT_PUBLIC_APP_URL` URL technique href interpolated (texte UX lignes 44/53 INTACT). `components/ui/footer.tsx` (line 31) import `NEXT_PUBLIC_PRODUCER_URL` + `defaultColumns[1].links[1].href` interpolated.
- **Auto-QA** : tsc clean ✓ | vitest 873/873 (zéro régression) ✓ | lint clean ✓ | build OK (fail-fast `NEXT_PUBLIC_PRODUCER_URL` valide Vercel All Environments) ✓.

### Récap quantitatif séance 29/04 (purge audit Auth #1 close)

**16 PRs mergées en prod** (master timeline antichronologique) :

| PR | Chantier | Hash master | Terminal | Tests |
|---|---|---|---|---|
| #48 | T-325 refactor env vars hostnames | `d1be726` | TA | 873/873 (zéro régression) |
| #47 | T-314 hardening `sanitizeNext` | `354de7d` | TE | 900/900 (+27 cas) |
| #46 | T-305 PR-B intégration call sites rate-limit | `ba4857c` | TC | 885/885 (post-rebase) |
| #45 | T-328 hardcode prod URLs `email-redirect.ts` | `05df0c3` | TA | 839/839 (+9) |
| #44 | T-321 middleware perf cache role snapshot | `98ffd53` | TB | 864/864 (post-fix Edge Runtime) |
| #43 | T-323 `slugFromEmail` extraction | `f6aa8a4` | TA | baseline + 5 |
| #42 | T-309 audit log `login_failed` | `ec83876` | TE | 825/825 (post-rebase) |
| #41 | T-319 + T-322 mineurs/cosmétiques bundle | `2417b04` | TC | baseline + 10 + 1 |
| #40 | T-310 complet audit log invitation flow | `9648525` | TB | 810/810 |
| #39 | T-316 cross-tab session sync | `3508082` | TA | baseline + 5 |
| #38 | T-302 + T-304 Cluster B finalisation | `8f60412` | TC | baseline + tests Cluster B |
| #36 | T-303 GET → POST anti-CSRF | `8163f88` | TB | baseline + 8 |
| #35 | T-305 PR-A infra Upstash | `8c9f069` | TA | baseline + 9 |
| #34 | T-318 mapping FR codes erreurs callback | `358801f` | TE | baseline + 3 |
| #33 | T-300 + T-301 + T-313 Cluster A | `4afa2e4` | TC | baseline + Cluster A |
| #32 | T-327 bug latent flow profil email change | `ee43444` | TA | baseline + 1 |

**Vitest baseline** : ~487 (28/04 fin) → 873 (29/04 fin séance) (+386 tests, +79.3%).

**Master HEAD final** : `d1be726` (post-merge PR #48).

**Configurations externes Romain Dashboard** :
- Confirm email Dashboard Supabase ON activé (bloqueur T-300 levé).
- Compte Upstash + database `terroir-rate-limit` Ireland (eu-west-1) Free tier + vars `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` Vercel All Environments + `.env.local` (T-305 PR-A).
- `ROLE_SNAPSHOT_SECRET` généré via `node crypto.randomBytes(32).toString('hex')` + Vercel Production + Preview + `.env.local` (T-321). Sensitive masqué Vercel.
- `NEXT_PUBLIC_ADMIN_URL=https://admin.terroir-local.fr` Vercel All Environments + `.env.local` (T-328).

**Tests preview validés Romain** : T-327 + T-318 (3 tests) + T-300 UI (1 test) + T-303 (skip auto-QA suffit) + T-316 cross-tab (1 test logout multi-tab) + T-321 cookie post-fix Edge Runtime (3 tests DevTools).

**Bloqueurs lancement public résiduels (non-code)** :
- **T-041 Pages légales** (Mentions légales / CGU / CGV / Politique confidentialité) — fusion T-041 (footer pro) + T-046 (footer consumer "à venir") + finding audit Auth #1 séance 29/04. Action externe Romain rédaction + validation juridique avocat avant go-live public.
- **T-046 HIBP password protection** — bloqué Pro plan Supabase ($25/mois). Action externe Romain upgrade Pro plan + toggle Dashboard Settings → Auth → Password Strength → "Enable HIBP password check". Pas de chantier code TerrOir.

**Audit Auth #1 close côté code** (16 PRs mergées). Bloqueurs lancement résiduels = actions externes (juridique + Pro plan Supabase).

---

## 2026-04-28 (après-midi/soir)

> Session 4 chantiers `### Chantiers code futurs` purgés + Phase A nouveau chantier "Notre démarche" + extension dotenv 5 scripts repo. **6 PRs mergées** sur master (#3 brand assets / #4 invite email-existant / #5 cron retry-failed-refunds / #6 extension dotenv 4 scripts) + **Phase A nouveau chantier "Notre démarche"** (PR #2 mergée matin via merge commit `f7293ba` regroupant `ced2ec2` + `cad9d95` + `4d57a30`). Master HEAD : `217a9f4` post-merge PR #6.
>
> 🟢 **Chantiers majeurs clos** :
> - **Logo variants externes** (TA, PR #3 squash `fc539ea`) — favicon multi-tailles + apple-icon iOS + OG image + Twitter image + metadata Next 14 file-based + factorisation `scripts/_logo-paths.mjs` partagé. Convention Next 14 file-based préférée à `metadata.icons` path-based.
> - **Flux invitation email-existant** (TB, PR #4 squash `b3eb40e`) — levée 409 sur `producer.statut='draft'` avec friction UX two-step (1er POST → 409 + `kind='draft_resend_confirm_required'`, modal bascule en mode confirmation amber + bouton "Confirmer la relance", 2nd POST avec `confirm_draft_resend=true`). Statuts `pending|active|public|suspended|deleted` inchangés (409 dur). 19 tests vitest.
> - **Cron retry-failed-refunds** (TC, PR #5 squash `00c5d10`) — scope minimal résurrection bloquée (path P1 robuste 27/04 only), schedule daily `0 4 * * *` UTC, 3 attempts cumulatifs J+1/J+2/J+3 puis `order_refund_retry_exhausted` + notification placeholder admin. Stripe idempotencyKey par attempt (anti cache erreur 24h). 27 tests vitest.
> - **Phase A chantier "Notre démarche"** (TB, PR #2 merge commit `f7293ba`) — DB tables `gms_prices` + `gms_prices_history` + RLS public read filtré `active=true` + 10 références seed initial (4 bovin + 3 porcin + 3 ovin) + helper `lib/gms-prices/fetch-active.ts` (snake_case, log+return [] sur erreur, defense-in-depth `.eq('active', true)` côté applicatif) + 9 tests vitest. Migration `20260428000000_gms_prices` apply confirmée prod, seed apply confirmée prod (10 références actives, breakdown filière 4/3/3 OK).
> - **Extension dotenv 4 scripts** (TB, PR #6 squash `217a9f4`) — pattern `dotenv` uniformisé sur les 5 scripts du repo qui lisent `process.env` (`seed.ts`, `seed-producers.ts`, `cleanup-seed.ts`, `backfill-stripe-connect-flags.ts`, + `seed-gms-prices.ts` déjà fait commit `4d57a30` Phase A). Plus besoin de sourcer `.env.local` manuellement avant chaque run (ergonomie Windows PowerShell).
>
> ⚠️ **Méthodologie / nouveautés capitalisées** :
> - **Pattern `gh CLI` pour PRs** : création + merge des 4 PRs (#3/#4/#5/#6) via `gh pr create` + `gh pr merge --squash --delete-branch` exécuté par TB depuis le terminal. Auth gh non-interactive via Git Credential Manager Windows + GH_TOKEN env var inline (token gho_… extrait à chaque session, scope `repo`/`gist`/`workflow` suffisant pour repo perso, pas de persistence `~/.config/gh/hosts.yml` car scope `read:org` insuffisant). Économise temps de création/merge web manuel (5-10 min par chantier × 4 PRs). À embarquer comme step standard du pattern STOP-GO terminal CC.
> - **Push back factuel terminal CC sur conventions repo** : 2 occurrences cette session (TA file-based Next 14 vs path-based, TB snake_case vs camelCase + log+null vs throw). Le terminal CC a accès à l'inspection du codebase réel et corrige le brief mal calibré du chat. Pattern fiable et rentable, à valoriser systématiquement.
> - **TODO en retard sur le code — 3e occurrence en série** : TB invitation email-existant a flag que 3 cas sur 4 du brief étaient déjà gérés. Pattern récidiviste (`ddb3a02` Phase C.4 25/04, `db248ac` auto-bump onboarded 27/04, ce fix 28/04). Pattern préventif renforcé : avant brief CC nouveau chantier listé dans TODO, faire grep ciblé fonction/route + `git log --all --oneline --grep="<keyword>"` pour vérifier qu'aucune session récente n'a livré silencieusement.
> - **Working tree partagé saturation** : observation 4 processus actifs simultanés (TA + TB + TC + chat) provoque stash externes auto + bascules silencieuses de branche récidivantes. 3 récidives dans une même session, mitigation par `git branch --show-current` intercalé entre commandes critiques. À 1 seul terminal actif (post-fermeture TA/TC), saturation éliminée immédiatement. **Recommandation forte pour sessions futures multi-terminal** : `git worktree add` ou clones distincts par terminal.
> - **Plan chirurgical `git checkout stash@{0} -- <paths>`** : innovation TA pour extraction sélective sans pop conflictuel quand le stash contient un mix de fichiers à toi + d'autres terminaux. Évite les conflits 3-way garantis par `git stash pop` quand les TC ont avancé entre temps. Pattern à réutiliser en working tree partagé saturé.
> - **Convention `/docs/*` violée par TC, redressée à temps** : TC avait modifié les 4 fichiers docs avant push, redressement obligatoire via `git checkout HEAD -- docs/*` appliqué proprement avant commit. Pattern préventif : inclure systématiquement dans tous les briefs CC un rappel explicite de la convention LESSONS.md ligne 148.
> - **Mode merge non uniforme** : PR #2 mergée en "Merge commit" (`f7293ba`) alors que PRs #3/#4/#5/#6 en "Squash". Bénin (cohérence post-fact des 4 squash uniformes), explique pourquoi master montre les 3 commits Phase A individuels (`ced2ec2`/`cad9d95`/`4d57a30`) en plus du merge commit. À aligner sur "Squash" par défaut pour futures sessions.

### Logo variants externes (chantier TA, PR #3 squash `fc539ea`)

- **Convention Next 14 file-based** : `app/icon.png` (64×64, icon variant fond transparent) + `app/apple-icon.png` (180×180, fond `terra-700` pour iOS qui arrondit + ne supporte pas transparence) + `app/opengraph-image.png` (1200×630, wordmark sur fond crème `#F7F4EF` padding ~18%) + `app/twitter-image.png` (identique OG). Next 14 branche automatiquement les balises `<link rel="icon">` / `<link rel="apple-touch-icon">` / `<meta property="og:image">` / `<meta name="twitter:image">` sans toucher à `metadata.icons` ni `openGraph.images`. Élimine couplage manuel et drift, plus robuste.
- **`app/layout.tsx`** : ajout `metadataBase = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000")` + `metadata.openGraph` complet (`title`/`description`/`url`/`type:'website'`/`locale:'fr_FR'`/`siteName:'TerrOir'`) + `metadata.twitter.card = 'summary_large_image'`. File-based Next 14 ajoute auto les balises image.
- **`scripts/_logo-paths.mjs`** (NEW) : module partagé exposant les 8 paths SVG du logo source + helpers `buildWordmarkSvg` / `buildIconSvg` + couleurs marque (`GREEN_700` / `GREEN_400` / `TERRA_700` / `TERRA_300`). Factorisation post-inspection : duplication des 8 paths sinon répétée entre `generate-email-logo.mjs` (existant) et `generate-brand-assets.mjs` (nouveau).
- **`scripts/generate-brand-assets.mjs`** (NEW) : générateur unique des 4 PNG en une passe via `sharp` (déjà dans le repo). Idempotent.
- **`scripts/generate-email-logo.mjs`** (MOD) : refacto pour utiliser `_logo-paths.mjs` partagé (-45 LOC déduplication).
- **Auto-QA** : tsc clean ✓ | vitest 432/432 ✓ | lint clean ✓ | build OK (routes statiques `/icon.png` `/opengraph-image.png` `/twitter-image.png` détectées) ✓ | HTML rendu home (curl localhost) avec toutes les balises injectées auto par convention Next 14 ✓

### Flux invitation email-existant (chantier TB, PR #4 squash `b3eb40e`)

- **Inspection préalable + push back partiel** : à la lecture de la route `/api/admin/producers/invite`, de `app/(producer)/invitation/page.tsx` (server component) et de `loginAndUpgradeAction`, **3 des 4 cas du brief étaient déjà gérés fonctionnellement** : cas 1 lead `'new'` (auto-bump → `'contacted'` commit `dbe6360`), cas 2 consumer existant (flow upgrade roles via `loginAndUpgradeAction` idempotent), cas 4 admin (409 + défense en profondeur côté `/invitation`). Seul trou réel : cas 3 producer en `statut='draft'` (onboarding abandonné) → 409 inconditionnel bloquait toute relance admin. 3e occurrence pattern récidiviste TODO en retard sur le code.
- **Fix MID retenu (vs MIN doc-only / MAX migration SQL invalidation)** : lookup conditionnel `producers.statut` ajouté à la route. Si `statut='draft'`, friction UX two-step : 1er POST → 409 + `kind='draft_resend_confirm_required'`, modal bascule en mode confirmation (encadré `amber-50/300/900` + bouton `terra-terracotta` "Confirmer la relance"), 2nd POST avec `confirm_draft_resend=true` autorise un nouveau token. Anciens tokens restent en base mais deviennent orphelins. Autres statuts (`pending|active|public|suspended|deleted`) inchangés (409 dur). Réponse 200 enrichie de `draft_resend: boolean` pour traçabilité.
- **3 fichiers touchés** : `app/api/admin/producers/invite/route.tsx`, `app/(admin)/gestion-producteurs/page.tsx`, `tests/app/api/admin/producers/invite/route.test.ts` (nouveau, 19 tests).
- **Auto-QA** : tsc clean sur scope ✓ | vitest **478/478** (459 + 19) ✓ | lint clean ✓.
- **4 résidus identifiés à l'inspection mais hors-scope MID, renvoyés au TODO comme chantiers dédiés futurs** : (1) UX admin réponse `existing_account` + toasts distincts, (2) invalidation SQL auto des invitations actives à chaque nouvel envoi, (3) casse email normalisée `ilike` sur tous les lookups, (4) audit log `[ADMIN_INVITE_*]` structuré (à fusionner avec Phase 3 audit).

### Cron retry-failed-refunds (chantier TC, PR #5 squash `00c5d10`)

- **Scope minimal validé** : retry uniquement les `order_revival_refund_failed` instrumentés par chantier P1 robuste 27/04. Admin manuel `/api/stripe/refund` + cron `order-timeout` NON couverts (pas d'instrumentation `*_refund_failed` audit_logs préalable). Item dédié posé au TODO pour extension future après instrumentation.
- **Politique retry validée par push back factuel** : brief initial chat proposait backoff 1h/6h/24h sur cron daily 0 4 * * * — incohérence détectée par TC (avec daily, le délai minimum entre attempts est forcément 24h). Bascule sur **3 attempts cumulatifs daily** (J+1, J+2, J+3 puis exhausted à J+4). Plus simple, observable, prévisible.
- **Stripe idempotencyKey par attempt** : `refund_${order_id}_${attempt}` varie par attempt. Anti cache erreur Stripe 24h sur idempotencyKey unique (figer une clé par order = anti-pattern). Garde l'idempotence intra-attempt + permet retry après 24h.
- **Pattern audit-log-driven background job** : query `audit_logs WHERE event_type='order_revival_refund_failed' AND order_id NOT IN (...succeeded OR exhausted)` identifie les targets. Compteur attempt = `count(metadata->>'order_id'=X AND event_type='order_revival_refund_failed')`. Pas de colonne dédiée, audit_logs sert de single source of truth.
- **Notification placeholder admin** (template `'refund_retry_exhausted'`) sans Resend dédié. Cohérent avec pattern existant `'webhook_anomaly_refund_failed'`. Si email immédiat souhaité plus tard, +1 commit Resend séparé.
- **Refactor `buildRetryTargets` extraction module séparé** : Next.js 14 type-check refuse les exports custom dans un route file (`checkFields<Diff<...>>` failure). Extraction dans `lib/cron/build-retry-targets.ts`. Pattern à retenir pour futurs route files Next.js 14 avec helpers.
- **5 fichiers code + 2 fichiers tests** : `lib/audit-logs/log-payment-event.ts` (extension 2 event types : `order_refund_retried_succeeded` + `order_refund_retry_exhausted`), `lib/stripe/retry-failed-refund.ts` (NEW, helper pure 165 lignes), `lib/cron/build-retry-targets.ts` (NEW, 110 lignes), `app/api/cron/retry-failed-refunds/route.ts` (NEW, 100 lignes), `vercel.json` (+1 cron `0 4 * * *` + entry function `maxDuration: 60`), `tests/lib/stripe/retry-failed-refund.test.ts` (NEW, 8 tests), `tests/app/api/cron/retry-failed-refunds/route.test.ts` (NEW, 19 tests intégration).
- **Auto-QA** : tsc clean ✓ | vitest **459/459** (432 + 27) ✓ | lint clean (1 warning pré-existant sur `no-explicit-any` rule undefined) ✓ | build OK ✓.
- **Pas de migration DB** : `event_type` est `text` libre dans `audit_logs`, ajout de 2 valeurs = pure extension TypeScript.
- **Configuration externe Vercel** : cron schedule `0 4 * * *` UTC ajouté à `vercel.json`. Activation automatique sur master post-merge. Cron quotidien ne se déclenche qu'en production (Vercel ne run pas les schedules cron sur preview environments).

### Phase A chantier "Notre démarche" (chantier TB, PR #2 merge commit `f7293ba`)

- **Recadrage produit avant code** : item roadmap "Prix GMS sur chaque fiche produit" priorité HAUTE (vision Avril 2026) recadré en chantier "Notre démarche" — page pédagogique GMS dédiée avec graphique circuit interactif + comparaison panier 10 références, plutôt qu'affichage prix GMS sur fiche produit individuelle. Décision risque juridique (publicité comparative) + impact pédagogique. 5 décisions tranchées : slug `/notre-demarche`, données graphique placeholder à calibrer plus tard sur sources OFPM/Idele/CGAAER, item navbar primaire, encart home entre Steps et Products grid, sources rigoureuses cherchées plus tard avant audit pré-lancement.
- **Phase A — DB + seed + helper** (3 commits sur la PR #2) :
  - **Migration SQL `20260428000000_gms_prices.sql`** (commit `ced2ec2`) : tables `gms_prices` (ref stable, 10 colonnes principales `id`/`slug`/`filiere`/`libelle`/`description_courte`/`prix_gms_kg`/`prix_terroir_kg_min/max/moyen`/`mois_reference`/`source`/`source_url`/`ordre_affichage`/`active`/`notes_admin` + métadonnées) + `gms_prices_history` (snapshots mensuels avec UNIQUE `(reference_id, mois_reference)`). RLS public read filtré `active=true` sur `gms_prices`, public read tout sur `gms_prices_history`. Pas de policies INSERT/UPDATE/DELETE — écritures admin via `service_role` (pattern Phase B). 2 indexes : `idx_gms_prices_filiere WHERE active` (partiel) + `idx_gms_prices_history_reference (reference_id, mois_reference DESC)`.
  - **Helper + seed + tests** (commit `cad9d95`) : `lib/gms-prices/fetch-active.ts` exposant `fetchActiveGmsPrices(supabase)` et `fetchActiveGmsPricesByFiliere(supabase, filiere)` avec signature `supabase: SupabaseClient` en paramètre (testabilité, contexte choisi par appelant). Type `GmsPrice` snake_case (passe-plat DB → UI, aligné `ProducerPublic`). Log préfixé `[FETCH_GMS_PRICES_ERROR]` + return `[]` sur erreur DB (convention `fetch-public.ts`). Defense-in-depth `.eq('active', true)` (+ `.eq('filiere', filiere)` pour la variante) côté applicatif en plus du filtre RLS. `scripts/seed-gms-prices.ts` aligné pattern `seed-producers.ts` (tsx + SERVICE_ROLE + `--dry-run` + prompt confirm + upsert applicatif SELECT puis UPDATE/INSERT par slug). 10 références seed (4 bovin + 3 porcin + 3 ovin) avec prix placeholder à calibrer plus tard sur sources réelles. **9 tests vitest** sur les 2 helpers.
  - **Fix dotenv** (commit `4d57a30`, mini-chantier additionnel dans la foulée) : `scripts/seed-gms-prices.ts` charge `.env.local` automatiquement via `dotenv` (devDep) + import `node:path`. `loadEnv()` exécuté avant les `const SUPABASE_URL = process.env.*`. Plus besoin de sourcer manuellement `.env.local` avant chaque run (ergonomie Windows PowerShell).
- **Auto-QA** : tsc clean ✓ | vitest **441/441** (432 + 9) ✓ | lint clean ✓ | build OK ✓.
- **Validation prod end-to-end** : migration apply manuellement Supabase Studio SQL Editor par Romain. Vérifications post-apply : `SELECT count(*) FROM gms_prices` = 0 (table créée vide), RLS policy `gms_prices public read` confirmée. Seed run depuis local : `npx tsx scripts/seed-gms-prices.ts --dry-run` puis apply réel = 10 inséré(s). Vérifications post-seed : count = 10, breakdown filière `bovin: 4, porcin: 3, ovin: 3`, ordre d'affichage 1 → 10 conforme. Vercel preview build OK, navigation propre, aucune régression. Master merge OK, redéploy master Ready, prod fonctionne, 10 références toujours actives.

### Extension dotenv 4 scripts (chantier TB additionnel, PR #6 squash `217a9f4`)

- **Pattern uniformisé** sur les 5 scripts du repo qui lisent `process.env` Supabase/Stripe : `seed.ts`, `seed-producers.ts`, `cleanup-seed.ts`, `backfill-stripe-connect-flags.ts` (PR #6 28/04 après-midi/soir) + `seed-gms-prices.ts` (PR #2 28/04 matin).
- **Modif standardisée** par fichier (~6 lignes ajoutées) : import `dotenv` + import `node:path` + `loadEnv({ path: resolve(process.cwd(), ".env.local") })` exécuté AVANT les `const SUPABASE_URL = process.env.*`. Aucun changement business.
- **Auto-QA** : tsc clean ✓ | vitest **487/487** ✓ | lint clean ✓ | build OK ✓.
- **Pas de chantier suivant prévu** : pattern dotenv = closed sur le repo. Si un nouveau script apparaît, le pattern est documenté en LESSONS.md pour duplication systématique.

### Récap quantitatif session 28/04 après-midi/soir

**4 chantiers livrés en prod** :

| PR | Chantier | Hash master | Fichiers | Lignes | Tests |
|---|---|---|---|---|---|
| #2 | Phase A "Notre démarche" | `f7293ba` (merge) | 4 | +637 | +9 |
| #3 | Logo variants externes | `fc539ea` (squash) | 8 | +230/-44 | 0 |
| #4 | Flux invitation email-existant | `b3eb40e` (squash) | 3 | +573/-8 | +19 |
| #5 | Cron retry-failed-refunds | `00c5d10` (squash) | 7 | +1067/+470/-2 | +27 |
| #6 | Extension dotenv 4 scripts | `217a9f4` (squash) | 4 | +24 | 0 |

**Vitest baseline** : 432 → 487 (+55 tests, +12.7%).

**Section TODO `### Chantiers code futurs` purgée** : 4 items retirés (cron retry-failed-refunds livré, dédup webhook flag à instrumenter avant volume, transformWithOxc bloqué upstream, flux invitation email-existant livré, backfill producers count=0 hors décision lancement, DS Phase 2 chantier dédié futur, logo variants externes livré). 4 nouveaux items ajoutés (instrumentation `*_refund_failed` paths admin/timeout, UX admin invite réponse enrichie, invalidation auto invitations, casse email normalisée).

**Configurations externes** :
- Vercel cron schedule `0 4 * * *` UTC ajouté à `vercel.json` pour `retry-failed-refunds`.
- Méthode auth `gh CLI` non-interactive validée (Git Credential Manager Windows + GH_TOKEN env var inline).

**Vulnérabilités npm pré-existantes** : 5 vulnerabilities détectées sur le repo (1 critical + 3 high + 1 moderate) — indépendantes des chantiers session, à investiguer en chantier dédié 🔐 Avant lancement public.

## 2026-04-28 (matin)

> Session refonte homepage consumer suite directe de la session 27/04 (extraction design system + bundle handoff Claude Design). **8 commits** sur la branche `feature/home-refonte` + merge `1bb17f5` vers master. Implémentation Next.js complète de la home consumer alignée sur le design system terra livré par Claude Design : tokens, logo, composants atomic + composés, navbar refondue avec drawer mobile, footer dark 4 colonnes, 7 sections home assemblées dans `app/(public)/page.tsx`. Build prod 99.3 kB First Load JS, **432/432 tests préservés**, zéro régression.
>
> 🟢 **Chantier majeur clos** : refonte design system terra Phase 1 (homepage consumer + composants atomic critiques). Phase 2 (fiches produit, panier/checkout, UI kits producer/admin, migration 14 sites accent → primary/success/secondary, 18 forms focus ring vert) reportée à sessions ultérieures dédiées.
>
> ⚠️ **Méthodologie** : pattern multi-PUSH STOP-GO sur 7 commits validé. Chaque PUSH = audit + plan + STOP + GO + code + auto-QA + STOP + push. Terminal CC (Claude Code, surnommé TT pour cette session) a démontré : self-correction (cast href trompeur PUSH 5), push back factuel (trailer Co-Authored-By que le chat avait mal lu), recovery propre (cherry-pick PUSH 3 après checkout master accidentel), fidélité aux sources (9e pin Sillé du screen handoff vs 8 du brief). Auto-QA stricte entre chaque PUSH (tsc + build + vitest + lint). Aucun fichier `/docs/*` touché par le terminal CC, pattern doc-only commit consolidé respecté.

### Refonte homepage consumer + design system Phase 1 (branche `feature/home-refonte`, 7 commits)

- **PUSH 1 — Tokens design system + tailwind config + globals.css enrichi** (commit `d59d50d`) : extension `tailwind.config.js` avec terra complet (50/200/400/600/800 ajoutés aux 100/300/500/700/900 existants), tokens postit (`#FFF7D6` bg + `#FEF3C7` fill + `#FDE68A` border + `#F59E0B` icon amber-500), `borderRadius` 2xl/3xl, `fontFamily.hand` (Caveat). `app/globals.css` : palette terra complète exposée en CSS vars + tokens postit + `--shadow-lift`. `app/layout.tsx` : ajout font Caveat via `next/font/google` avec variable `--font-caveat`.
- **PUSH 2 — Logo source nettoyé + variants wordmark-dark / icon-dark** (commit `9371275`) : `public/logo/logo-source.svg` créé depuis `~/Desktop/Logo.svg` officiel Romain (refait à la main dans Inkscape), nettoyage du calque JPEG modèle masqué (`display:none` avec base64 embedded), réduction de **92 KB → 11 KB (-87%)**. `components/ui/logo.tsx` étendu : 6 variants (`wordmark` / `wordmark-dark` / `icon` / `icon-dark` / `mono` + alias rétro-compat `full` → `wordmark`). API refacto props couleur passée de duo `greenFill/siennaFill` à trio `letterFill/ringFill/riverFill` (1 path = 1 prop). `wordmark-dark` : lettres blanches + anneau `O` `#74C69D` (green-400) + rivière `#D4A373` (terra-300) — variant correct sans le bug 2 lettres manquantes du bundle CD initial. Détection `isDark` automatique pour couleur tagline.
- **PUSH 3 — Migration sémantique Button** (commit `a07ae5e`) : `components/ui/button.tsx` refonte 5 variants (primary terra-700, secondary terra-100/terra-700, ghost terra-700 sans bg, success green-700, accent green-700 deprecated transitional avec JSDoc). Focus ring migré `ring-terroir-green-700` → `ring-terra-700`. `components/ui/input.tsx` focus ring vert → terra. `components/ui/product-card.tsx` prix `text-terroir-green-700` → `text-terra-700` tabular-nums. **Audit 58 call sites Button** (vs 14 attendus dans le brief — TT a fait le bon réflexe de grep le default sans variant explicite). 38 sites consumer-facing migrent automatiquement vers terra. 14 sites admin/producer reclassés explicitement en variant `accent` (deprecated transitional, à migrer Phase 2). 3 sites producer reclassés explicitement en variant `success` (validations métier : Confirmer commande, Marquer livrée, Confirmer retrait). 1 site admin "Inviter un producteur" reclassé en `accent` (vote correctif vs `primary` initial pour préserver cohérence visuelle dashboard admin majoritairement green Phase 2).
- **PUSH 4 — Composants UI post-it + map-sarthe** (commit `0030509`) : `components/ui/post-it.tsx` (NEW) variante statique avec props `eyebrow`/`quote`/`signature`/`meta`. Style fidèle screen handoff : `transform: rotate(-1.4deg)` inline (Tailwind JIT instable sur valeurs décimales négatives), `bg-postit-bg`, scotch terra en pseudo-element `before:[transform:rotate(-3deg)]`, signature en `font-hand` (Caveat green-900). Pattern trigger+popover documenté dans le fichier mais réservé Phase 2 (fiche produit interactive). `components/ui/map-sarthe.tsx` (NEW) : SVG inline silhouette stylisée Sarthe + 9 pins producteurs (Coulaines, Allonnes, Vibraye, Saosnes, Mayet, Loué, Bonnétable, Le Lude, Sillé) + marqueur Le Mans + 2 rivières + légende. Pattern `<defs>` id namespacé `map-sarthe-hatch` anti-collision multi-instance. Composants 100% Server (zéro `"use client"`). `components/ui/index.ts` : +2 exports.
- **PUSH 5 — Refonte navbar + footer alignés DS** (commit `187b82e`) : `components/ui/navbar-public.tsx` refacto in-place avec préservation 100% logique cliente (Zustand `useCartStore`, `useUserContext`, `useLogoutFlow`, mounted flag anti-hydration, `usePathname` active state, "use client" directive). Migration style green → terra (hover/active/focus rings). Pill cart `bg-terra-700` (mobile + desktop) avec badge blanc `text-terra-700`. Copy nav links alignée DS : "Rencontrer les producteurs" (au lieu de "Les éleveurs"), "Carte", "Comment ça marche". À propos retiré du nav, conservé en footer. Logo passé en variant `wordmark` (alias `full` rétro-compat). Pill "S'inscrire" retirée (DS desktop ne la montre pas, /connexion contient déjà le lien inscription). Drawer mobile NEW (Phase 1) : pure React `useState` + Tailwind transitions (pas de Radix/framer-motion), slide-in from left `w-80 max-w-[85vw]`, 5 modes de fermeture (tap dehors backdrop / tap X / tap lien / resize desktop via `matchMedia` listener / logout), body scroll lock pendant ouverture (UX mobile), a11y `role="dialog"` + `aria-modal` + `aria-label` + `aria-controls` + `aria-expanded` + `aria-current`. Layout responsive 2 conteneurs distincts (`md:hidden` mobile / `hidden md:flex` desktop). Mobile bar isAdmin : `<span className="w-11" aria-hidden />` placeholder pour préserver l'équilibre flex. `components/ui/footer.tsx` refonte structurelle complète : `bg-green-900` dark mode (text-white/65), 4 colonnes (Brand avec wordmark-dark + tagline + commission disclosure italic / Acheter / Producteurs avec lien externe `↗` Espace producteur target=_blank rel=noopener / TerrOir avec mailto:contact + mentions légales `Mentions légales · CGU · CGV · Politique de confidentialité — à venir` italique muted). Footer-bottom minimaliste `© 2026 TerrOir · Sarthe`.
- **PUSH 6 — Mocks featured-products + 6 sections home** (commit `e29d1e1`, 7 fichiers nouveaux, +582 lignes) : `lib/mocks/featured-products.ts` typé `ProductCardData[]` avec 4 produits cohérents screen DS (Poulet fermier 1,8kg Coulaines, Carottes des sables Allonnes, Crottin frais Vibraye, Pommes Reinette du Mans Saosnes), IDs slug pour navigation future. 6 sections dans `app/(public)/_components/home/` : `Hero.tsx` (eyebrow terra + H1 Cormorant italique avec mot "producteurs" en italique terra + 2 CTAs primary/ghost + visuel placeholder dégradé terra avec mini producer card overlay "Ferme des Tilleuls · Coulaines · volaille fermière depuis 1987"), `Steps.tsx` (3 cards "Choisir / Payer en ligne / Récupérer" pastilles 01/02/03 terra + icônes vertes), `FeaturedProducts.tsx` (header + grid 4 ProductCard mocks), `SarthemapPostit.tsx` (grid 2 cols MapSarthe gauche / PostIt Marie droite avec signature Caveat manuscrite), `Reassurance.tsx` (4 cards icônes terra : Producteurs sarthois / Paiement sécurisé / Circuit court / Retrait à la ferme), `CtaBand.tsx` (eyebrow "GOÛTEZ LA SARTHE" + H2 italique terra-300 + CTA primary "Explorer les fermes →" sur fond dark green-900 avec overlay terra). Toutes Server Components (zéro `"use client"`). Aucune section ne consomme une autre section (composition pure dans `page.tsx`).
- **PUSH 7 — Nouvelle homepage page.tsx agrégateur** (commit `76f85e6`, **-69%** : 97 → 30 lignes) : `app/(public)/page.tsx` réécrit complètement. Server Component pur (zéro `"use client"`), agrège dans l'ordre Hero / `<PublicStats />` (existant Supabase live conservé après Hero, vote Q2 du brief) / Steps / FeaturedProducts / SarthemapPostit / Reassurance / CtaBand. Metadata override : title "TerrOir — La marketplace des producteurs sarthois" + description SEO axée circuit court Sarthe. Pas d'import NavbarPublic ni Footer (fournis par `app/(public)/layout.tsx`). Build prod : route `/` = 99.3 kB First Load JS (188 B page + 87.2 kB chunks shared), dynamic (`ƒ`) car PublicStats fetch Supabase.
- **Merge PR #1 vers master** (commit `1bb17f5`) : merge commit avec préservation des 7 commits dans l'historique master (stratégie merge commit vs squash pour bisect-friendly). 35 fichiers, **+1358 / -209** lignes. Suppression branche locale + remote + cache origin/feature/home-refonte. **Production déployée** automatiquement par Vercel.

### Récap quantitatif Phase C TT

- 7 commits sur `feature/home-refonte` + 1 merge commit
- 11 fichiers nouveaux (logo source + 2 ui composants + 6 sections home + 1 mocks + 1 commit page final)
- 22 fichiers modifiés (3 ui + 14 producer + 1 admin + tailwind/globals/layout + footer/navbar/page)
- ~1 350 lignes ajoutées, ~210 supprimées
- 432/432 tests préservés (zéro régression)
- 38 sites Button consumer migrés terra automatiquement
- 14 sites Button préservés en green via accent (deprecated transitional)
- 3 sites Button explicites en success vert (validations métier)
- 1 site Button admin reclassé en accent (Q4 corrigé : Inviter producteur)

### Décisions méthodologiques validées

- **Pattern multi-PUSH STOP-GO sur chantier large** : 7 PUSH avec audit + plan + STOP + GO + code + auto-QA + STOP + rapport intermédiaire + GO push. Chaque PUSH avait un blast radius mesuré (PUSH 3 = 14 fichiers identifiés en audit, etc.) permettant à Romain de valider granulairement. Coût méthodologique élevé (~2-3h de discussion brief/audit/validation pour ~7-8h de code) mais coût d'erreur faible (zéro revert, zéro force push, zéro régression).
- **Vercel preview comme review visuelle** : preview auto-déclenchée par chaque push sur la branche feature, validation visuelle desktop avant merge sur master. Suffisant pour cette session (mobile responsive non-vérifié visuellement, mais auto-QA build OK + screen handoff mobile 375px de référence). Pour Phase 2 critique, prévoir vérification mobile DevTools en plus.

### Leçons consolidées

- **Pattern checkout master silencieux récurrent en multi-terminal partagé** : observé 3 fois pendant la session (avant PUSH 3, avant cherry-pick PUSH 3, avant PUSH 4). Cause probable : working directory partagé entre les terminaux PowerShell (TT terminal CC + chat terminal docs), un checkout fait dans l'un se propage à l'autre via le filesystem partagé. Mitigation : `git branch --show-current` au début de chaque PUSH (TT l'a institutionnalisé après la 2e occurrence). Voir `LESSONS.md` section "Parallélisation Claude Code".
- **Pattern recovery cherry-pick après commit sur mauvaise branche** (commit `a07ae5e` cherry-picked depuis `c911e5f` orphelin sur master local). Quand un terminal CC commit accidentellement sur master au lieu de feature, ne jamais push master. Procédure : `git checkout feature && git cherry-pick <hash> && auto-QA && git push origin feature` puis sur master local `git reset --hard origin/master`. Pas de force push remote nécessaire si l'erreur est locale uniquement.
- **Pattern self-correction TT en streaming** (PUSH 5, cast `href={undefined as unknown as string}` louche → corrigé immédiatement en omettant la prop pour utiliser le default `/`). Quand un terminal CC produit du code louche dans un premier jet et le corrige avant le rapport intermédiaire, c'est un bon signal de maturité auto-critique. Pattern à valoriser.
- **Pattern push back factuel TT sur erreur du chat** (PUSH 7, trailer Co-Authored-By). Le chat avait supposé que les 6 commits précédents n'avaient pas le trailer (ne l'ayant pas vu dans les rapports streamés). TT a fait la vérification factuelle dans `git log` et confirmé que les 6 avaient le trailer. Recommandation : garder le trailer sur PUSH 7 pour cohérence. **Côté chat (Claude principal)**, recevoir un push back factuel = vérifier ses propres assumptions, pas insister par défaut. Pattern récurrent (3e occurrence cumulative en série : `ddb3a02` Phase C.4, `49c0f1b` P1 cible, ce trailer).

---

 **15+ commits** sur 4 thèmes : (1) **3 bugs critiques orders/paiement résolus** (P0 stock + P2 commande fantôme 3DS + P1 idempotence retentative), (2) **chantier P1 robuste résurrection** avec RPC SQL atomique + refund Stripe automatique + audit_logs Phase 2 payment events (matin 27/04), (3) **extension massive couverture vitest** (state machine + cron timeout + cancel + confirm + complete + handle-payment-failed/succeeded), (4) **navbar SSR-aware étendue** (`isAdmin` + `isProducer` pré-fetch). Migrations `20260427200000` (trigger stock) + `20260427300000` (RPC résurrection) apply prod. Validations prod end-to-end : P0 + P2 + P1 simultanés sur commande TRR-7235E ; chantier P1 robuste validé sur TRR-KKKDL.
>
> 🟢 **Chantiers majeurs clos cette session** : 3 bugs 🔴 critiques résolus + couverture vitest passe de 207 à 411+ tests (+98%) + finalisation auth/navbar SSR + audit_logs Phase 2 payment events instrumentés (6 events).
>
> ⚠️ **Méthodologie** : pattern doc-only commit consolidé par session institué (terminaux CC ne touchent pas /docs/*, le chat agrège en un commit final). Pattern push back terminal CC sur brief incohérent valorisé (cas P1 cible `pending` vs `confirmed` initialement proposé).

### Bugs critiques résolus

#### P0 — Stock non restauré à l'annulation

- **Trigger DB `orders_restore_stock_after_cancel`** (commit `4584139` + migration `20260427200000_restore_stock_on_order_cancel.sql`) : la RPC `create_order_with_items` décrémentait le stock à l'INSERT mais aucun chemin ne ré-incrémentait à l'annulation (3DS-fail webhook, cron timeout, cancel route, refund route). Trigger `AFTER UPDATE OF statut` avec clause `WHEN` PG-level filtre les transitions concernées (`pending|confirmed|ready → cancelled|refunded`). `IS DISTINCT FROM` garantit l'idempotence (no-op si trigger rejoué). `SECURITY DEFINER` bypass RLS pour UPDATE products. Exclusion délibérée de `completed → refunded` (cas litige post-retrait : produit déjà remis au consumer). Validation prod : Salade mesclun stock 50 → 47 (commande pending) → 50 (3DS-fail). Apply prod 26/04 via Supabase Studio SQL Editor.

#### P2 — Commande fantôme à l'échec 3DS

- **Webhook payment_failed cancellation_reason + guard rétrogradation** (commit `9482e5b`) : extraction `lib/stripe/handle-payment-failed.ts` avec return enum 5 valeurs (`'no_metadata' | 'order_not_found' | 'already_terminal' | 'guard_confirmed' | 'cancelled'`) + 7 tests vitest. Pose `cancellation_reason='payment_failed'` + `assertTransition('pending','cancelled')` + `revalidateTag('public-stats')`. Guard explicite `[WEBHOOK_FAILED_AFTER_SUCCEEDED_NOOP]` sur statut `confirmed`/`ready` (Stripe peut émettre failed après succeeded sur retries/redélivery). Pattern symétrique de `syncStripeAccountFlags` (commit `8ba2e49`). Webhook handler devient thin wrapper.
- **UI consumer exclusion + badge admin distinct** (commit `56ab733`) : exploitation du `cancellation_reason='payment_failed'` posé par commit `9482e5b`.
  - Côté consumer (`/compte/commandes`) : exclusion stricte à la source (compteur + listing + realtime postgres_changes handler). Helpers `isPaymentFailedRow` / `isPaymentFailedOrder` pour cohérence des call sites. Sémantique métier : un paiement non finalisé = engagement inexistant, le consumer n'a jamais rien acheté.
  - Côté admin (`/suivi-commandes`) : pseudo-statut UI `payment_failed_pseudo` dans `STATUS_META` local (label "Tentative échouée", gris doux), filtre tab dédié pour drill-down opérationnel, metrics `today` + `completion` ajustés (option a strict scope `payment_failed` retenue, commentaire dans le code expliquant le choix).
- **Backfill TRR-AM2UN** (apply prod 26/04) : commande SQL idempotente (conditions cumulatives `statut='cancelled' AND cancellation_reason IS NULL`) appliquée via Supabase Studio SQL Editor pour la commande historique du test 3DS du début de soirée.

#### P1 — Idempotence retentative paiement (résurrection)

- **Webhook succeeded résurrection cancelled → pending** (commit `49c0f1b`) : extraction `lib/stripe/handle-payment-succeeded.ts` avec return enum 6 valeurs (`'no_metadata' | 'order_not_found' | 'pending_to_notify' | 'revived_to_notify' | 'already_confirmed' | 'anomaly'`) + 8 tests vitest. Le scénario qui cassait : client paye → 3DS-fail → order `cancelled+payment_failed` → client retente avec autre carte (sans recharger la page) → 3DS passe → Stripe émet `payment_intent.succeeded` sur le MÊME PaymentIntent → ancien handler tombait dans webhook_anomaly (state machine refusait `cancelled → confirmed`). Fix : résurrection conditionnelle si `statut='cancelled' AND cancellation_reason='payment_failed'`. **Cible `pending`** (pas `confirmed`) — TA a poussé back sur le brief initial après inspection du code (le webhook succeeded ne fait jamais d'UPDATE statut sur le path nominal, le passage `pending → confirmed` se fait via `/api/orders/[id]/confirm` par le producer). Argument validé : reproduire l'état d'avant 3DS-fail + préserver le flow normal de validation producer. Reset `cancellation_reason` et `cancelled_at` à NULL pour préserver l'invariant projet `cancelled_at IS NULL ⟺ statut ∉ {cancelled, refunded}`. Bypass volontaire de la state machine sur path résurrection uniquement, commenté explicitement (pas d'extension `TRANSITIONS` dans `stateMachine.ts` — la state machine globale reste restrictive pour tous les autres call sites). Logs préfixés grep-able : `[WEBHOOK_SUCCEEDED_REVIVAL]` et `[WEBHOOK_SUCCEEDED_ANOMALY]`. Validation prod : commande TRR-7235E créée pending après séquence 3DS-fail puis retentative carte 4242.

### Chantier P1 robuste — résurrection avec RPC atomique + refund Stripe + audit_logs (matin 27/04)

> Détection en validation prod du commit `49c0f1b` : la résurrection P1 ne re-décrémentait pas le stock (cancelled → pending via UPDATE direct, le trigger DB de restauration ne gère pas le sens inverse intentionnellement). État observé : order TRR-7235E pending avec quantité 3 mais stock affiché 50 au lieu de 47. Décision Romain (matin 27/04) : Option C robuste — pas de retour en arrière, on fait une fois pour toutes.

> Décisions produit actées :
> 1. RPC SQL atomique avec lock + check stock + check slot + décrémentation + reset reason/cancelled_at.
> 2. Refund Stripe automatique si résurrection bloquée (rupture stock ou slot complet entre temps).
> 3. Multi-items en rupture partielle : tout-ou-rien (refund total).
> 4. Slot indisponible : refund total (le slot est un choix consumer, on ne peut pas en imposer un autre).
> 5. `cancellation_reason` distinctes : `'revival_blocked_stock'` et `'revival_blocked_slot'` (drill-down admin + analytics).
> 6. UX consumer : email transactionnel `order_revival_blocked` + page `/compte/confirmation/[id]` détecte le statut et affiche un message explicite.
> 7. Helper `logPaymentEvent` créé en même temps (clos la dette Phase 2 audit_logs orders/payment) avec 6 event types.

#### Commit 1/3 — RPC SQL atomique + helper logPaymentEvent

- **`feat(orders): RPC atomique résurrection avec check stock + slot + helper logPaymentEvent`** (commit `6b4a835` + migration `20260427300000_revive_order_with_stock_check.sql`) : nouvelle RPC `revive_order_with_stock_check(p_order_id uuid)` retournant text `'revived' | 'blocked_stock' | 'blocked_slot'`. Pattern fidèle à `create_order_with_items` (commit `0e1c640`) : (1) lock order `FOR UPDATE`, (2) garde-fou défensif sur `statut='cancelled' AND cancellation_reason='payment_failed'` (raise sinon), (3) lock slot `FOR UPDATE` + check capacité via `COUNT(orders) WHERE statut IN ('pending','confirmed','ready')`, (4) lock multi-products ordonné `ORDER BY id FOR UPDATE` (anti-deadlock), (5) check stock tout-ou-rien (1 item insuffisant → return `'blocked_stock'` sans modif), (6) décrémentation atomique multi-products, (7) UPDATE order vers `pending` + reset `cancellation_reason=NULL` + `cancelled_at=NULL`. `GRANT execute` au `service_role` uniquement (pas de path browser).
- **Helper `lib/audit-logs/log-payment-event.ts`** (Phase 2 audit_logs orders/payment) avec 6 event types : `order_payment_succeeded`, `order_payment_failed`, `order_revival_succeeded`, `order_revival_blocked_stock`, `order_revival_blocked_slot`, `order_revival_refund_failed`. 11 tests vitest. Pattern symétrique à `logAuthEvent` Phase 1 (`a36fcaa`) mais SANS auto-extraction IP/UA via `next/headers()` (webhook Stripe IPs, peu pertinentes forensiquement — params explicites uniquement). Clos la dette Phase 2 flag depuis le chantier P2.
- **Validation prod** : 3 scénarios SQL apply via Supabase Studio (revival OK + blocked stock + blocked slot) tous ✅. Pattern QA SQL via `do $$` block + `temp table` + `select` final pour récupérer les résultats dans le panneau "Results" (les `RAISE NOTICE` ne s'affichent pas toujours dans Supabase Studio web SQL Editor).

#### Commit 2/3 — Webhook handler étendu + refund Stripe + audit logs complets

- **`fix(webhook): refund Stripe automatique si résurrection bloquée + audit logs payment events complets`** (commit `9d6cb13`) : câble la RPC du commit 1 au webhook `payment_intent.succeeded`. Enum `PaymentSucceededResult` étendu de 6 → 9 valeurs (ajout `'revival_blocked_stock'`, `'revival_blocked_slot'`, `'revival_refund_failed'`). Refund Stripe automatique sur paths bloqués (rupture stock ou slot saturé entre temps) via `stripe.refunds.create({ payment_intent })` inline. Si refund échoue (rare : réseau, idempotency conflict) → audit log `order_revival_refund_failed` poussé pour grep manuel + alerte admin via `notifications` table (pas de retry auto, chantier dédié futur).
- **Audit logs instrumentés sur 6 events** (Phase 2 payment) : tous les paths nominaux ET bloqués loguent désormais. Stratégie : pas d'audit sur `already_*` / `guard_*` / `no_metadata` / `order_not_found` (évite duplication au rejouage et bruit forensique).
- **`handle-payment-failed.ts` étendu rétroactivement** (Phase 2) : ajout `logPaymentEvent({ eventType: 'order_payment_failed' })` sur path cancelled + 4 tests vitest pour vérifier le call. SELECT `consumer_id` ajouté pour traçabilité forensique attachée à un user.
- Tests vitest étendus : `handle-payment-succeeded.test.ts` 8 → 14 cas (+6) + `handle-payment-failed.test.ts` 7 → 11 cas (+4). Suite globale 401 → 411 tests + 2 todo.

#### Commit 3/3 — UI consumer + admin metrics

- **`feat(orders): UI consumer revival_blocked + extension filtre payment_failed → revival_blocked_*`** (commit `5a572b2`) : commit final du chantier.
- **Template Resend `order-revival-blocked.tsx`** : 1 template avec prop discriminante `blockedReason: 'stock' | 'slot'`. Wording légèrement différent (stock épuisé vs créneau pris par autre client) mais structure identique. Subject "Commande X non honorée — remboursement initié" + montant remboursé + CTAs.
- **Page `/compte/confirmation/[id]`** : SELECT étendu avec `cancellation_reason`. `ConfirmationClient.tsx` détecte `cancelled+revival_blocked_*` et affiche `RevivalBlockedView` inline (icône terra `!` au lieu du checkmark vert + eyebrow "Paiement remboursé" + titre "Commande non honorée" + message contextualisé selon reason + récap items + montant remboursé tabular + CTAs "Trouver un autre producteur →" et "Voir mes commandes").
- **Filtre consumer `/compte/commandes`** : `isPaymentFailedRow` renommé en `isVoidOrderRow` pour sémantique générale "engagement inexistant côté consumer". `VOID_ORDER_REASONS` Set extensible étendu à 3 reasons (`payment_failed` + `revival_blocked_stock` + `revival_blocked_slot`). Realtime postgres_changes handler met à jour le filtre.
- **Admin `/suivi-commandes`** : 2 pseudo-statuts distincts terra (vs gris payment_failed) — `revival_blocked_stock_pseudo` "Bloquée (stock)" + `revival_blocked_slot_pseudo` "Bloquée (créneau)". 2 nouveaux filtres tabs pour drill-down. Metrics `today` + `completion` étendus à `isVoidOrder` (helper agrégé qui appelle les 3 prédicats spécifiques pour éviter duplication des reasons). Filtre "Annulées" exclut désormais TOUS les void orders Stripe (les 3 reasons), affiche uniquement `consumer_cancel` / `producer_cancel` / `timeout` / `stock` rupture / `admin_refund` / `other`.
- **Wiring email consumer via `waitUntil`** (remplace les TODO commit 2) : `sendTemplate` async sur paths `revival_blocked_*`, `.catch` défensif logué (pattern producer notif existant).
- **Validation prod end-to-end** : commande TRR-KKKDL (Salade mesclun, 3 unités, séquence 3DS-fail + retentative carte 4242). Vérifications :
  - DB après résurrection : `statut='pending'`, `cancellation_reason=NULL`, `cancelled_at=NULL` ✅
  - Stock Salade mesclun : 50 → 47 (3 décrémentés correctement) ✅
  - audit_logs : `order_payment_failed` à T+0 puis `order_revival_succeeded` à T+5s, même `payment_intent_id` sur les 2 events ✅
  - Le bug stock résiduel détecté matin du 27/04 est entièrement résolu.

### Couverture vitest étendue (207 → 411+ tests, +98%)

- **State machine matrice 6×6** (commit `f57d5ad`) : 89 tests sur `lib/orders/stateMachine.ts` couvrant `canTransition` (36 cellules + 3 dégénérés), `assertTransition` (8 légaux + 15 illégaux représentatifs), `isTerminal` (6 cas), `InvalidOrderTransitionError` (6 cas). Filet de sécurité figeant la matrice — tout futur ajustement passera par une modif consciente du fichier de test. Pas de bug détecté dans la state machine elle-même, 2 asymétries flag en investigation produit (`ready → refunded` illégal, `isTerminal` sans guard `?.`).
- **Auto-bump lead onboarded** (commit `d0c87d2`) : 7 tests sur `complete-onboarding.ts` server action (transition `'contacted' → 'onboarded'` post-wizard finalisé). Pattern mock server actions Next.js capitalisé (sentinel `__REDIRECT__` + helper `runAction()` — voir `LESSONS.md` section "Tests vitest").
- **Cron order-timeout** (commit `f32d083`) : 12 tests fonctionnels + 2 `it.todo` documentaires (B1 UPDATE error silent, B2 UPDATE failure after Stripe refund retry — bugs latents à fixer dans le chantier futur "alignement routes orders"). Modif `vitest.config.ts` : pré-transform inline via `transformWithEsbuild` du package `vite` (loader: 'tsx', jsx: 'automatic') pour parser JSX dans .tsx (vitest 4 / rolldown-vite ne le fait pas par défaut, sans dep additionnelle). Débloque tous les futurs tests de routes Next `.tsx`. ⚠️ `transformWithEsbuild` deprecated, migration `transformWithOxc` à prévoir.
- **Route cancel order** (commit `280ff69`) : 27 tests sur `app/api/orders/[id]/cancel/route.tsx` (multi-acteur cron/admin/producer-owner, zod enum `cancellation_reason` 5 valeurs, Stripe refund avec fallback canTransition, badge anti-annulation, alerte admin 2e rupture stock). Patterns capitalisés : `vi.hoisted` pour env vars (bypass module-load throw de `lib/env/urls.ts`) + queues séparées par opération sur le builder Supabase (`{ select: [], update: [], insert: [] }` au lieu d'une queue unique — voir `LESSONS.md`). Investigation produit B1 documentée dans test D1 (consumer → 403, voulu ou trou ?).
- **Routes confirm + complete** (commit `81b3c1a`) : 16 tests confirm + 21 tests complete sur les 2 routes producer-side de transition d'order (`pending → confirmed` et `ready → completed`). Asymétrie `revalidateTag` documentée (confirm + cancel l'appellent, complete non — décision intentionnelle, le filtre `IN ('confirmed','ready','completed')` ne change pas). Ordre des checks transition→code dans complete verrouillé par test F4 (si renversé, F4 casse → décision consciente requise). Investigation produit : confirm route sans garde rôle explicite vs cancel.
- **Webhook handlers** : 7 tests `handle-payment-failed` (`9482e5b`) + 8 tests `handle-payment-succeeded` (`49c0f1b`) sur les fonctions pures extraites des handlers webhook. Pattern symétrique avec `syncStripeAccountFlags` (commit `8ba2e49`). Étendus en commit 2 du chantier P1 robuste à 11 + 14 cas pour couvrir Phase 2 audit logs + résurrection robuste.

### Navbar SSR-aware étendue

- **`isAdmin` SSR** (commit `404bb0d`) : élimine flash badge admin au hard refresh. Inclut helper `getInitialUserPayload()` dans `lib/auth/session.ts`.
- **`isProducer` SSR + factorisation type `InitialUserPayload`** (commit `20304e9`) : extension du pattern `404bb0d` au flag `isProducer`. Type `InitialUserPayload` factorisé dans `lib/auth/types.ts` (client-safe, rejoint la convention `lib/auth/roles.ts`). Pattern d'implémentation : `Promise.all` sur les 2 lookups (`admin_users` + `producers`) en parallèle (~5ms gain vs séquentiel), fail-safe par lookup (un throw isolé ne masque pas les autres flags). Découverte importante capturée en LESSONS : triggers `users_exclusive_with_admin` + `admin_users_exclusive_with_users` (migration `20260421100000`) garantissent qu'un user ne peut pas être à la fois admin ET producer côté DB. Néanmoins le code applicatif garde les 2 lookups indépendants par robustesse défensive — si un état corrompu apparaît un jour, l'app retourne les 2 flags à `true` plutôt que de masquer ou planter. Dette résiduelle non bloquante : pré-fetch SSR `ProducerLite` (objet allégé) pour éliminer aussi le flash placeholder `« — »` de `ProducerLayout` qui dépend de l'objet producer complet.

### Fixes mineurs

- **Refund admin cancellation_reason** (commit `799bf71`) : 1 ligne ajoutée à `app/api/stripe/refund/route.ts` (`cancellation_reason='admin_refund'`). Bug additionnel #4 du rapport TA inspection P2 clos. 3 dettes connexes flag pour le chantier futur "alignement routes orders" (`assertTransition` + `revalidateTag` + suite vitest manquantes).
- **Webhook account.updated extraction + tests + script backfill** (commits `8ba2e49` + `5592f30`) : extraction `lib/stripe/sync-account-flags.ts` du handler webhook `account.updated` (pattern fonction pure réutilisé pour P2 et P1 ensuite) + 8 tests vitest. Script `scripts/backfill-stripe-connect-flags.ts` pour réconciliation initiale des 3 flags Stripe Connect (cf migration `20260424000000`). Backfill exécuté en dry-run par Romain : 0 producer à traiter (aucun `stripe_account_id` en prod). Apply skip.

### Configurations externes Stripe Dashboard validées (mode Test)

- **Webhook URL pointe sur `https://www.terroir-local.fr/api/stripe/webhook`** ✅ (vérifié 26/04 via Stripe Dashboard).
- **Stripe Link off account-wide** ✅ (déjà désactivé dans Settings > Paiements > Moyens de paiement, vérifié 26/04).
- **Test 3DS scénarios validés** : carte `4000 0027 6000 3184` complete ✅ (TRR-DNW87) + fail ✅ (TRR-AM2UN puis TRR-5CE25) + retentative avec carte 4242 ✅ (TRR-7235E puis TRR-KKKDL).
- **Webhook mode Live** : reporté à la bascule effective Test → Live (cf TODO bloquants lancement).
- **Branding Stripe Connect** : abandonné pour cette session, item flag pour investigation dédiée future.

### Décisions méthodologiques

- **Pattern doc-only commit consolidé par session institué** : terminaux CC NE MODIFIENT PAS `/docs/*` eux-mêmes. Ils listent les "Mises à jour doc requises" structurées par fichier dans leur rapport. Le chat consolide en UN commit doc-only par session pour éviter les collisions multi-terminal sur fichiers centraux. Voir `LESSONS.md` section "Parallélisation Claude Code".
- **Pattern push back terminal CC sur brief incohérent valorisé** : commit P1 `49c0f1b` a corrigé le brief initial du chat (cible `pending` vs `confirmed` proposé). Pattern récurrent (déjà observé sur `ddb3a02` Phase C.4 SuccessConfirmation 25/04). Voir `LESSONS.md` section "Parallélisation Claude Code".

### Leçons consolidées

- **Pattern guard contre rétrogradation + résurrection sur events Stripe non-ordonnés** (`9482e5b` payment_failed + `49c0f1b` payment_succeeded) : Stripe ne garantit pas l'ordre temporel des events sur un même PaymentIntent. Côté `payment_failed` : ne PAS rétrograder une order déjà confirmed/ready/completed. Côté `succeeded` : autoriser la résurrection cancelled → pending UNIQUEMENT si `cancellation_reason='payment_failed'`. Logs préfixés grep-able pour détection prod. Voir `LESSONS.md` section "Stripe".
- **Pattern résurrection robuste avec atomicité DB-side** (chantier P1 robuste 27/04) : un UPDATE applicatif ne suffit pas pour restaurer un état avec compteurs dérivés (stock + slot). RPC SQL atomique avec lock multi-row (`FOR UPDATE` ordonné anti-deadlock) + check + décrémentation + UPDATE order, retour enum text. Le caller webhook interprète l'enum et déclenche les actions latérales (refund Stripe automatique sur paths bloqués, audit log, email consumer, UI conditionnelle). Pattern symétrique au pattern de création (`create_order_with_items`). Voir `LESSONS.md` section "Stripe".
- **Pattern UX consumer cohérent avec l'état réel** : si la résurrection est bloquée (refund Stripe auto), la page de confirmation NE DOIT PAS afficher "Merci, c'est payé." (banner trompeur sur un payment refundé). `RevivalBlockedView` détecte le statut + reason et affiche un message clair. Cohérent avec le filtre `isVoidOrderRow` côté listing (la commande disparaît du compteur). Pattern : tout `cancellation_reason` qui correspond à "engagement inexistant côté consumer" doit être exclu UI consumer ET visible drill-down admin.
- **Pattern trigger DB pour synchronisation de compteurs dérivés** (commit `4584139`) : quand une RPC métier décrémente un compteur à la création, la restauration symétrique à l'annulation est plus fiable côté DB qu'au niveau applicatif. Trigger `AFTER UPDATE OF` avec clause `WHEN` PG-level + `IS DISTINCT FROM` pour idempotence + `SECURITY DEFINER` pour bypass RLS. Voir `LESSONS.md` section "Database & migrations".
- **Architecture rôles TerrOir : exclusivité admin / consumer-producer** (capturé via chantier `20304e9`) : triggers `users_exclusive_with_admin` + `admin_users_exclusive_with_users` (migration `20260421100000`) garantissent au niveau DB qu'un même `auth.users.id` ne peut pas exister à la fois dans `public.users` et `public.admin_users`. `isAdmin && isProducer === true` impossible côté DB. Néanmoins le code applicatif garde les 2 lookups indépendants par robustesse défensive. Voir `LESSONS.md` section "Auth & sessions".
### Chantier alignement routes orders (TA, après-midi 27/04)

> Recoller les 3 dernières dettes sur les routes d'annulation/refund (flag par rapports TB `799bf71` et `f32d083` matin) pour aligner toutes les routes orders sur les patterns canoniques (assertTransition strict + revalidateTag `public-stats` + tests vitest exhaustifs).

- **Refund admin route alignée sur patterns canoniques** (commit `6bcc185`) : `app/api/stripe/refund/route.ts` bénéficie désormais de `assertTransition` strict (transition invalide `ready → refunded` retourne 409 au lieu de 500), `revalidateTag('public-stats')` post-refund pour invalidation cache, suite vitest 15 tests couvrant succeeded path + paths d'erreur (transition invalide, Stripe error, DB error, idempotence sur retry). Aligné sur le pattern `cancel/route.tsx` matin.
- **Cron order-timeout durci** (commit `1ef2d0d`) : `app/api/cron/order-timeout/route.tsx` ajoute check d'erreur UPDATE silencieuse (B1+B2 : `it.todo` `f32d083` convertis en tests réels), `revalidateTag('public-stats')` batch (1 call sortie de boucle, pas N calls dans la boucle pour respecter la limite Vercel cron de 60s), drift detection sur le compteur de orders timeout (alerte si `> 50%` des orders du batch sont en drift = configuration cron probablement décalée). 6 tests ajoutés. Aligné sur le pattern `webhook payment_failed`.
- **Auto-QA finale** : tsc clean, build OK, **432/432 tests verts**, 0 `it.todo` restant côté cron.

### Chantier pré-fetch SSR ProducerLite (TC, après-midi 27/04)

- **Élimination du flash placeholder ProducerLayout au hard refresh producer** (commit `9ed9b0d`) : le commit `20304e9` (matin 27/04) avait pré-fetché le flag boolean `isProducer` SSR pour éliminer le flash CTA navbar, mais `ProducerLayout` (sidebar producer avec nom_exploitation/slug/statut) restait en placeholder « — » tant que le profile producer n'était pas chargé côté client. Patch chirurgical : `ProducerLite { id, slug, nom_exploitation, statut }` déplacé de `user-provider.tsx` vers `lib/auth/types.ts` (client-safe partagé server/client) ; `getInitialUserPayload()` fusionne les 2 lookups producers en 1 SELECT enrichi (invariant : `isProducer === (producerLite !== null)`) ; `UserProvider` initialise `producer = initial.producerLite` dès le SSR (pas null). Re-export `ProducerLite` depuis `user-provider.tsx` conservé pour rétro-compat des imports existants. Fail-safe préservé (`[GET_INITIAL_USER_PAYLOAD_WARN] producerLite lookup failed`). Hors périmètre `app/layout.tsx` et `ProducerLayout.tsx` non touchés — le SSR initialise `producer` non-null dès le premier render, le placeholder « — » devient inatteignable au hard refresh d'un user producer. 4 fichiers, +109/-40, 8 tests adaptés (anonyme, consumer pur, admin, producer, 4 fail-safe variants).
- **Auto-QA finale** : tsc clean, build OK, **426/426 tests verts** (devenu 432 après merge TA `1ef2d0d` qui a ajouté +6 cron tests).

### Chantier auto-bump lead onboarded (TB push back, après-midi 27/04)

> Brief envoyé au terminal TB pour implémenter la transition auto `'contacted' → 'onboarded'` à finalisation wizard. **Push back du terminal** : le chantier était déjà livré.

- **Cas 2e occurrence du pattern push back terminal CC sur chantier déjà livré** : TB inspecte `complete-onboarding.ts` et détecte que la logique `UPDATE producer_interests SET statut='onboarded' WHERE email = session.email AND statut='contacted'` est **déjà implémentée** (commits `db248ac` code + `d0c87d2` tests, 7 tests existants). TB push back : "chantier déjà livré, rien à coder". Le chat valide (option a clos), `/clear TB`, item retiré du `TODO.md` en fin de session. Pattern récurrent (déjà observé sur `49c0f1b` cible pending — chantier matin 27/04). **Leçon** : la mémoire institutionnelle du chat n'est pas synchrone avec l'état réel du repo. Avant d'envoyer un brief CC, faire un `git log --oneline -20` ou `grep -r "<pattern>" app/` pour vérifier que le chantier proposé n'est pas déjà fait. Voir `LESSONS.md` section "Parallélisation Claude Code".

### Refonte design system + homepage consumer via Claude Design (après-midi 27/04)

> Première utilisation de **Claude Design** (Anthropic Labs, research preview avril 2026, powered by Opus 4.7), un outil agentique qui lit le codebase, génère un design system tokenisé, permet l'itération sur canvas, puis exporte un bundle handoff structuré vers Claude Code. Session de **~3h** sur la refonte de la homepage consumer (`/`).

- **Design system TerrOir validé sur 19 blocs** : Colors (Brand core terra primary + Scales 50→900 + Semantic ink/muted/border/post-it/danger), Type (Display headings Cormorant Garamond H1-H4 + scale responsive 64→44px H1, Body & UI Inter sans-serif eyebrow/body-lg/body/body-sm/meta, Numbers & prices Inter tabular-nums avec exception headline-price serif éditoriale), Spacing (échelle Tailwind 4px), Radii (sm/md/lg/xl/2xl/full avec lg=12px pour btn et input — ton plus chaleureux), Elevation/shadows (3 niveaux teintés green-800 #1B4332 — cohérence chromatique brand au lieu d'ombre noire générique). Identité (Logo lockups 5 variants : ICON crème/blanc/dark + WORDMARK crème/dark + Email signature gabarit Gmail/Outlook ; Iconography SVG inline stroke 2 round currentColor). Components atomiques (Buttons primary terra/secondary terra-100/ghost + variants success vert + states destructive en ghost ou outline rouge JAMAIS filled ; Badges 3 catégories tones stock state + order status cycle + status dot ; Form inputs 6 démo avec focus terra/error rouge inline). Components composés (Product card avec photo placeholder rayé + badge catégorie/stock + nom Cormorant + producteur Inter muted + prix terra-700 + commune Sarthe authentique ; Producer card avec photo + nom + Coulaines · 4,2 km + badges catégories vert + labels qualité terra Bio AB/Label Rouge + 12 produits + ⭐ 4,8 (46) ; Conseil éleveur post-it trigger icône terra + popover post-it `#FFF7D6` rotation -1.4° + signature manuscrite ; Day slots accordéon par jour + header pill terra "✓ 10:00-10:30" sélection visible ; Metric tiles 4 tiles dashboard producer ; Order status badges mapping enum DB → UI avec convention `completed=green-700 filled` succès final accompli).
- **Décisions copywriting verrouillées** : transparence radicale sur la commission ("TerrOir prélève une petite commission pour faire vivre la marketplace"), section anti-patterns explicit ("Vous payez sur place" interdit — Stripe Connect = paiement en ligne au checkout, "sans intermédiaire" autorisé au sens humain mais JAMAIS pour parler du flux d'argent), géographie sarthoise authentique (Coulaines, Allonnes, Vibraye, Saosnes — vraies communes ; Reinette du Mans — vraie variété de pomme du département). Documenté dans le bundle handoff dans 2 endroits (README §9 + DESIGN_SYSTEM Content Fundamentals) en gras pour résistance à la dérive future.
- **Homepage consumer maquettée desktop + mobile (375px breakpoint)** : 8 sections cohérentes (Hero terra avec mini producer card overlay "Ferme des Tilleuls / Coulaines · volaille fermière depuis 1987" + 3 stats / Comment ça marche en 3 étapes : Choisir / Payer en ligne avec transparence commission / Récupérer / Produits du moment 4 cards / Carte Sarthe 8 communes + Conseil éleveur post-it Marie 2 colonnes / Réassurance 4 args / CTA final dark vert sapin / Footer dark 3 colonnes alignées sur les routes existantes du repo). Footer juridique honnête : "Mentions légales · CGU · CGV · Politique de confidentialité — à venir" en italique muted plutôt que href morts. Convention des routes nav vérifiée contre l'inventaire réel `app/(public)/*` (`/producteurs`, `/carte`, `/devenir-producteur`, `/comment-ca-marche`, `/a-propos` — toutes existantes).
- **Logo officiel intégré** : Romain a fourni `Logo.svg` source refait à la main dans Inkscape (8 paths vectoriels purs : 6 lettres T-e-r-r-i-r en green-700 + 1 anneau O en green-700 + 1 rivière terra-700 dans le O). Calque référence JPEG modèle masqué (`display:none`) à nettoyer côté CC pour réduire de ~90KB → ~10KB. Pattern de découpage : extraction du path 'O' isolé (anneau + rivière) pour variant icon-only, recoloration des paths "lettres" en blanc/crème pour variant dark BG (lettres blanches + O green-400 + rivière terra-300 pour contraste sur fond sombre).
- **Bundle handoff exporté vers Claude Code** : `design_handoff_terroir.zip` (39 fichiers, ~21 KB) contenant `README.md` (15 sections : overview, fidelity, sources, tokens Tailwind config, scale responsive, copywriting anti-patterns, routes du repo, étapes Claude Code) + `00_DESIGN_SYSTEM.md` + `colors_and_type.css` + `assets/` (9 SVG logos — IGNORÉS côté CC, recréés depuis Logo.svg source) + `screens/desktop/` + `screens/mobile/` (HTML/CSS de référence visuelle) + `design_system_cards/` (19 cards de review). Phase 2 (fiches produit, panier/checkout Stripe, UI kits producer & admin) identifiée en section 14 du README pour sessions ultérieures.
- **Implémentation Next.js en cours via terminal Claude Code** : branche `feature/home-refonte`, plan validé en 7 pushes (tokens design system + logo source nettoyé + variants + composants atomic + composants composés + navbar/footer + homepage finale). Décisions architecturales pré-validées : composants UI dans `components/ui/` (convention shadcn/ui existante), tokens hybride CSS vars + Tailwind config pointant vers les vars (theming runtime futur-proof), migration Button.primary green→terra avec variant `success` (validations métier vertes) + variant `accent` deprecated transitionnel (call sites admin/producer en green pendant la transition). Pas d'install lucide-react / framer-motion / @testing-library / clsx / tailwind-merge (cohérent avec doctrine repo SVG inline + concat string). Tests Phase 1 limités à logique pure (mocks/featured-products + anti-régression copy "vous payez sur place"). PublicStats existant conservé (live Supabase + seuils crédibilité, plus mature que mock figé du DS). Drawer burger mobile implémenté en pure React useState (pas de Radix). Branche merge après preview Vercel + review Romain. Phase 2 (extension migration design system aux espaces fiche produit / checkout / producer / admin) reportée à sessions dédiées.

---

## 2026-04-26

> Session marathon 25/04 → 26/04 (soir + nuit + suite). **27 commits** au total, 5 chantiers en parallèle puis suite : auth `redirectTo`, logo SVG vectoriel + emails, vision funnel producteur Phase 1+2, audit auto-promotion + purge panier logout, et **suite post-marathon** (reset password page dédiée, rattrapage 4 dettes techniques, PKCE workaround Option B, fix navbar SSR-aware, audit logs auth events). Migrations `20260426000000` + `20260427000000` + `20260427100000` (audit_logs) apply. 5 templates Supabase Auth Email customisés via Dashboard.
>
> 🟢 **Chantiers majeurs clos cette session** : auth flow complètement clos (reset password page dédiée + magic link OTP token_hash + audit logs forensiques), navbar consumer SSR-aware (initialUser passé du root layout), Phase 3 vision funnel sous-chantier reads (lectures `prenom_affichage` migrées vers `users.prenom`).
>
> ⚠️ **Incident traçabilité** : commit `894fa5e` a un message trompeur (sujet `feat(admin): show lead source column in /producer-interests` mais diff réel = `lib/producers/get-display-name.ts` + son test). Cause : race condition multi-terminal sur `git index` pendant la session marathon. Le commit suivant `e5c4234` rejoue le bon sujet sur les vrais fichiers UI. Code en master correct, traçabilité git dégradée (`git blame` sur le helper retombera sur un message incohérent). Voir `LESSONS.md` section « Working tree partagé — race condition message/diff incohérent (26/04) ».

### Chantier auth `redirectTo` (TA)

- **`?redirectTo` honoré par le password login** (commit `53f8f6a`, 25/04 fin de journée) : `loginAction` lit désormais le param posé par le middleware sur les routes protégées plutôt que de toujours router vers `canonicalPostLoginUrl(role)`. Validation defense-in-depth via nouveau helper `isValidRedirectPath` (path local uniquement, rejette `//` et `/\` pour bloquer protocol-relative). `app/connexion/page.tsx` reste server component, le switcher form/magic est extrait dans `connexion-form.tsx` (client) avec input hidden `redirectTo`. Helpers ajoutés à `lib/auth/post-login-redirect.ts` (`isValidRedirectPath`, `resolvePostLoginPath`).
- **`?redirectTo` honoré par le magic link** (commit `d4088d5`) : le param est désormais propagé jusqu'au callback magic link. `ConnexionForm` transmet `redirectTo` au `MagicLinkForm` via input hidden. `requestMagicLinkAction` valide le path puis l'embarque en query string sur `emailRedirectTo` (Supabase le renvoie tel quel dans l'email). `/auth/callback` lit `?redirectTo`, délègue à un nouveau helper `canonicalPostLoginUrlWithRedirect` (rôle dicte le host, path validé sinon fallback canonique). Le callback supporte les 2 formats (`?code=` PKCE et `?token_hash=&type=` OTP). Validation defense-in-depth côté action ET côté callback (un email forgé `?redirectTo=//evil.com` retombe sur le path canonique). Clôt la dette flaggée par TA dans le rapport du commit `8cb6114`.

### Chantier logo SVG vectoriel + emails (TB)

- **Refactor logo SVG vectoriel** (commit `51d409b`) : `components/ui/logo.tsx` étendu avec 3 variants (`full` / `icon` / `mono`) + 4 sizes (`sm` / `md` / `lg` / `xl` ajouté plus tard via `e523357`). Ancien `Logo_TerrOir_transparent.png` retiré, remplacé par `Logo_TerrOir.svg`. `next.config.js` ajusté pour servir le SVG.
- **Itérations layout SVG (3 fixes successifs)** :
  - `0fd3f54` `fix(logo): tighten viewBox` — réduction du whitespace causant un render oversized.
  - `cb3ebab` `fix(logo): use size=md for navbar contexts` — corrige la hauteur en `h-16`.
  - `71905d2` `refactor(logo): use cropped SVG from Inkscape` — fix définitif après que les 3 itérations précédentes n'ont pas convergé. Pattern : modifier l'asset source (Inkscape resize-to-drawing) plutôt que de continuer à patcher le composant. Voir `LESSONS.md` section « Assets vectoriels ».
- **Navbar consumer agrandie** (commit `e523357`) : `Logo` size `xl` (64px) ajouté + `navbar-public.tsx` passe de `h-16` à `h-20` pour brand presence renforcée. Autres navbars (pro mini-header, sidebar producer, footer, admin) inchangées.
- **Logo dans header emails Resend** (commit `67e40fc`) : `lib/resend/templates/layout.tsx` étend le layout avec un header logo TerrOir sur fond crème (mockup visuel comparatif vert vs crème → choix crème pour cohérence brand). Asset PNG `public/email-assets/logo-email.png` généré via nouveau script `scripts/generate-email-logo.mjs` (les clients mail ne supportent pas SVG, d'où l'export PNG).

### Chantier vision funnel producteur Phase 1 + Phase 2 (TA + TC)

> Phase 1 = traçabilité origine lead. Phase 2 = friction publique réduite + wizard 2 étapes avec pré-remplissage. Phase 3 (DROP `prenom_affichage`, ~19 fichiers transversaux) reportée à une session dédiée.

#### Phase 1 — Traçabilité source des leads

- **Colonne `source` sur `producer_interests`** (commit `87bfff9` + migration `20260426000000`) : `source` ∈ (`formulaire_public`, `invitation_directe`). DEFAULT `formulaire_public` (backfill implicite — tous les leads existants viennent du formulaire public, seul point d'entrée jusqu'ici).
- **Création auto de lead sur invitation directe admin** (commit `9e78ea4`) : quand un admin invite un prospect dont l'email n'est pas en base, on insère désormais un lead `source='invitation_directe'` `statut='contacted'` après envoi email réussi. Pattern fail-open : un échec d'INSERT loggé `[LEAD_CREATE_WARN]` ne bloque pas l'invitation déjà partie. Garde anti-doublon via `maybeSingle` sur `ilike(email)` avant insert. L'onglet Leads devient le journal d'acquisition complet.

#### Phase 2 — Public form simplifié + wizard 2 étapes

- **Colonne `prenom` sur `producer_interests`** (commit `783e071` + migration `20260427000000`) : nullable (legacy leads gardent `prenom NULL`, admin UI gère gracefully). Permet de pré-remplir le wizard sans heuristique de split nom/prénom.
- **Formulaire public `/devenir-producteur` simplifié** (commit `a895ed2`) : split « Nom et prénom » en 2 inputs `prenom` + `nom`. Drop required « Espèces élevées » (signal non qualifiant à ce stade — `type_production` capturé dans le wizard). `LeadsTable` admin rend le full name graceful (`${prenom ?? ''} ${nom}`.trim()). Route invite admin accepte `prenom` optionnel et le propage au lead `invitation_directe`.
- **Wizard onboarding redesigné en 2 étapes** (commit `49b45d8`) : `StepPersonnel` fusionné dans `StepEntreprise` (renommage déféré, cf `TODO.md`). Wizard passe de 3 à 2 étapes (Compte / Profil). Nouveau helper `lib/producers/pick-initial-infos.ts` qui merge 3 sources par priorité (producer draft > user > lead). `'À compléter'` traité comme empty pour ne pas leak dans les inputs pré-remplis. `/invitation` et `/onboarding` fetch désormais le lead matching (statut `contacted` ou `onboarded`, ilike email, plus récent) et passent les infos mergées au wizard. `complete-onboarding` valide les 3 perso fields, écrit `users` AVANT `producers` (partial failure laisse le draft retryable plutôt que half-committed). 7 tests vitest sur `pick-initial-infos`.

### Chantier audit auto-promotion (TC)

- **`promoteProducerToPublicIfActive` vérifie les 3 conditions cumulatives** (commit `4911401`) : avant le fix, seule la garde `statut='active'` côté UPDATE était checkée — un producer pouvait apparaître sur `/producteurs` et la carte sans Stripe Connect prêt ou sans aucun créneau, laissant le consumer cliquer sur une fiche impossible à commander. Désormais 3 pré-checks cumulatifs avant la transition `active → public` :
  1. `producer.statut === 'active'` ET `stripe_charges_enabled === true`
  2. ≥ 1 produit avec `active = true`
  3. ≥ 1 slot avec `active = true` ET `excluded_at IS NULL` (symétrique au filter consumer dans `create_order_with_items`)
  Si une condition manque, no-op silencieux (fail-open préservé). Garde finale `.eq('statut','active')` conservée pour idempotence (race condition). Aucune dépublication automatique : `public → active` reste hors-scope (cf `suspendProducer` / `reactivateProducer`). Tests vitest étendus à 21 cas (vs 10 avant) couvrant le cas nominal, 5 chemins no-op et fail-open sur chaque étape DB.

### Chantier purge panier logout (TA)

- **Cart state cleared on logout** (commit `a08a56e`) : `lib/auth/use-logout-flow.ts` purge désormais le state panier au logout pour éviter la fuite entre sessions sur même device (un user A se déconnecte → user B se connecte → panier de A persiste en local storage). Bug observé en pré-prod par Romain.

### Configurations externes (Supabase Dashboard)

> Modifications côté Dashboard non reflétées dans le code mais critiques pour le go-live. À reproduire en cas de migration provider / nouvel environnement.

- **5 templates Auth Email customisés** : Magic Link, Confirm Signup, Reset Password, Change Email, Invite User. Header logo TerrOir, fond crème cohérent avec emails Resend. Détail des href par template à confirmer via Dashboard (cf `HANDOFF.md` section Configurations externes critiques).
- **Migrations `20260426000000` + `20260427000000`** apply prod via Supabase Studio SQL Editor.

### Bug magic link PKCE — RÉSOLU (Option B retenue)

- **🟢 Magic link bascule au flow OTP `token_hash` + cookie deep-link** (commit `09c219d`) : le bug PKCE `code+challenge+does+not+match` est désormais résolu. Diagnostic : le cookie `code_verifier` posé par `signInWithOtp` sur l'host de la Server Action n'était pas accessible au callback dans le cas critique admin loggé via `www.*` puis redirigé sur `admin.*` (cookie name distinct, isolation Chantier 4). **Décision** : abandon du flow PKCE pour le magic link au profit du flow OTP `token_hash` (`verifyOtp` côté callback, sans cookie verifier nécessaire). Le `redirectTo` deep-link, qui transitait jusqu'ici en query string sur `emailRedirectTo` (et causait le bug `Missing+code+or+token_hash` documenté), est maintenant **persisté dans un cookie HttpOnly `terroir_post_login_redirect` sur `.terroir-local.fr`** (cross-subdomain) au moment du form submit, lu et expiré par `/auth/callback` après `verifyOtp`. Helper isolé `lib/auth/redirect-cookie.ts` + 173 lignes de tests vitest. Plan d'investigation initial (`TODO.md` 🔴) devenu obsolète. ⚠️ **Action Romain** : modifier le template Supabase Magic Link en `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=magiclink` (le `RedirectTo` inclut déjà `/auth/callback`, ne pas le rajouter). Workarounds UX (commits `92bbff7` + `6c2b5ef`) conservés comme filet de sécurité pour les autres causes possibles (lien expiré, lien invalide).

### Suite de session marathon — post-MAJ doc `4a724af`

> 16 commits supplémentaires après la MAJ doc intermédiaire `4a724af`. Couverture : reset password page dédiée, Phase 3 sous-chantier reads, rattrapage 4 dettes techniques, rename `StepEntreprise → StepInfos`, doc race condition, remember email, **PKCE Option B** (résolution bug magic link), fix navbar SSR-aware, **audit logs auth events** + migration `audit_logs`, gitignore tsbuildinfo.

#### Reset password — page dédiée (TA)

- **`/reinitialiser-mot-de-passe` avec form « nouveau mot de passe »** (commit `5ff9394`) : flow étape 2 du reset password désormais explicite. Server action groupée `verifyOtp` + `updateUser` pour conserver les cookies de session (impossible depuis un Server Component). `/mot-de-passe-oublie` pointe désormais `redirectTo` vers la nouvelle page. Composant `ResetPasswordForm` côté client. ⚠️ Action Romain : mettre à jour le template Supabase « Reset Password » pour utiliser `${SITE_URL}/reinitialiser-mot-de-passe?token_hash={{ .TokenHash }}&type=recovery` au lieu de `{{ .ConfirmationURL }}`. Le retrait de la page legacy `/reset-password` est listé en dette ~1 semaine post-deploy (cf `TODO.md`).

#### Phase 3 vision funnel — sous-chantier reads (TB)

- **Helper `getProducerDisplayName` + lectures migrées vers `users.prenom`** (commits `894fa5e` helper + `1110816` lectures) : toutes les lectures publiques + pré-fill wizard passent désormais par `getProducerDisplayName(producer)` qui résout `users.prenom` (priorité haute) puis fallback `producer.prenom_affichage`. `fetch-public` joint `users(prenom)` via la FK `user_id`. 11 fichiers updated (`fetch-public.ts`, `pick-initial-infos.ts`, page produit consumer, wizard, onboarding, complete-onboarding, create-account, login-and-upgrade, invitation page, seed-producers). Tests refresh sur `fetch-public` et `pick-initial-infos`. Les **écritures** restent conservées avec TODO Phase 3 finale (DROP COLUMN prévu chantier suivant). Code mort résiduel à purger ~1-2 semaines plus tard.

#### Rattrapage dettes techniques (TA + TC)

- **Tests redirect helpers** (commit `3b29c34`) : 18 tests vitest sur `isValidRedirectPath` (10 cas : paths locaux valides, undefined, null, vide, open-redirect `//evil`, `/\evil`, URL absolue, `javascript:` XSS, sans `/` initial) + `resolvePostLoginPath` (8 cas : respect `redirectTo` valide, fallback canonique par rôle consumer/admin/producer public/draft, ignorance d'un `redirectTo` open-redirect). Vitest passe de 130 à 148 tests verts. Clôt la dette flaggée 26/04 sur la sécurité anti-open-redirect.
- **UI source col `/producer-interests`** (commit `e5c4234`) : badge vert « Public » / orange « Invité » à côté du nom de chaque lead pour distinguer `formulaire_public` vs `invitation_directe`. Composant `LeadSourceBadge` réutilise `StatusDotBadge` (Phase B1 consolidation admin). Type `Lead` enrichi avec `LeadSource`. Voir aussi note d'incident traçabilité commit `894fa5e` ci-dessus.
- **Messages erreur callback user-friendly** (commit `92bbff7`) : quand `/auth/callback` échoue (PKCE mismatch, lien expiré, lien invalide), l'user atterrissait jusqu'ici sur `/connexion?error=auth_callback&reason=…` avec une `reason` technique brute. Mapping désormais par substring lowercase (robuste aux variations exactes : URL-encoding, slice à 120 chars, libellés Supabase upstream qui bougent) → messages français digestibles dans une alerte rouge en haut du form password : `challenge / pkce → 'Ce lien a expiré ou n'est plus valide.'`, `expired → 'Ce lien a expiré.'`, `missing code / token_hash → 'Ce lien n'est pas valide.'`, fallback générique pour les reasons non-matchées.
- **Bouton « Demander un nouveau lien magique »** (commit `6c2b5ef`) : suite à l'erreur callback affichée dans une alerte (commit `92bbff7`), bouton inline qui bascule le form en mode magic link (réutilise `onSwitchToMagic` déjà câblé). L'user retape son email manuellement (pas de pré-remplissage : l'email ne transite pas dans la query string d'erreur, pas de PII exposée). Le bouton existant « Se connecter par email » en bas du form reste disponible.

#### Cosmétique + UX

- **Rename `StepEntreprise.tsx → StepInfos.tsx`** (commit `acc080b`) : depuis la fusion `StepPersonnel` + `StepEntreprise` (commit `49b45d8`), le composant gère désormais perso ET entreprise. Le nom n'était plus aligné. Renommage cosmétique trivial déféré pour ne pas mélanger refactor et delivery dans le commit `49b45d8`.
- **Remember email opt-in checkbox** (commit `71172e1`) : checkbox « Se souvenir de mon email » sur `/connexion`. Stockage local via nouveau helper `lib/storage/local-preferences.ts`. Cocher → pré-remplit l'email au prochain visit. Décocher → purge la valeur stockée. Pattern opt-in explicite (pas par défaut), aligné RGPD.

#### Doc + git hygiene

- **Doc race condition incident commit `894fa5e`** (commit `fa7cbbd`) : `LESSONS.md` étendu avec nouvelle sous-section « Working tree partagé — race condition message/diff incohérent (26/04) » qui complète la règle `11b914e`. Pattern préventif : `git diff --cached --name-only` avant chaque commit pour valider mécaniquement la liste des fichiers stagés vs le scope attendu. `CHANGELOG.md` annoté de la note d'incident traçabilité.
- **`.gitignore` `tsconfig.tsbuildinfo`** (commit `229c0ec`) : fichier `tsconfig.tsbuildinfo` (incremental build cache TypeScript) ignoré + retiré du tracking. Évite le diff parasite à chaque `tsc`.

#### PKCE Option B — résolution bug magic link

- **Bascule au flow OTP `token_hash` + cookie deep-link cross-subdomain** (commit `09c219d`) : voir section « Bug magic link PKCE — RÉSOLU » ci-dessus pour le détail.

#### Navbar SSR-aware (TA)

- **Fix flash CTA disparition au hard refresh** (commit `209ce83`) : sur hard refresh d'un visiteur anonyme, les boutons « Connexion » + « S'inscrire » disparaissaient de `NavbarPublic` pendant la fenêtre `loading=true` du `UserProvider` (le temps que `supabase.auth.getSession()` résolve). Un placeholder vide `<div h-8 w-24 />` était rendu à la place de la zone CTA → capture utilisateur tombait pendant ce flash. **Fix immédiat** : retirer le branch `loading ?` du rendu et tomber directement sur `user ? userView : ctaView`. État initial du provider = `user=null` → CTAs visibles dès le SSR. Trade-off : court flash CTA → user pour un user déjà loggé au hard refresh, acceptable vs. invisible CTA pour un visiteur anonyme (cas majoritaire bloquant pour l'acquisition).
- **Robust fix : `initialUser` passé du root layout au `UserProvider`** (commit `6a9ebd3`) : élimine totalement le flash. `app/layout.tsx` devient async, lit la session via `createSupabaseServerClient().auth.getUser()` et passe `initialUser` au `UserProvider`. Le provider initialise `user=initialUser` dès le SSR et supprime l'appel `getSession()` redondant — `onAuthStateChange` émet `INITIAL_SESSION` sur abonnement, ce qui couvre la résolution initiale + tous les changements ultérieurs. Comportement anonyme inchangé (`initialUser=null`, `loading=false` dès le mount). `loading` reflète désormais le chargement du profile (roles/admin/producer) côté client : `true` si SSR a fourni un user (`ProducerLayout` garde son placeholder « — »), `false` sinon. Dette résiduelle non bloquante : enrichir `initialUser` avec `isAdmin` SSR pour éviter le bref flash sans badge Admin (cf `TODO.md`).

#### Audit logs forensiques — Phase 1 auth (TA)

- **Helper `log-auth-event` + migration `audit_logs`** (commit `a36fcaa` + migration `20260427100000`) : trace forensique des events sensibles (RGPD art. 32, PCI DSS 10.x). Phase 1 : auth uniquement. Migration `audit_logs` append-only avec RLS admin-only en lecture, écriture exclusive `service_role`. Helper `lib/audit-logs/log-auth-event.ts` fail-safe (try/catch silencieux, jamais re-throw — un échec d'audit ne casse jamais le flow métier) avec auto-extraction IP/UA via `next/headers()`. 11 tests vitest couvrent : insert nominal, `userId` null, fallback IP/UA, error Supabase swallow, throw admin client swallow.
- **5 call sites instrumentés** (commit `acd8c03`) :
  1. `account_login_password` — `loginAction`, post-`signInWithPassword` success.
  2. `account_login_magic_link` — `requestMagicLinkAction`, après tentative envoi (loggué systématiquement pour préserver enumeration-resistance, metadata.email + isAdmin en clair côté DB).
  3. `password_reset_request` — nouvelle `requestPasswordResetAction` server (refactor depuis client : audit fiable + `redirectTo` serveur depuis `headers()`). Page `/mot-de-passe-oublie` bascule vers la nouvelle server action.
  4. `password_changed` — `updatePasswordAction`, post-`updateUser` success.
  5. `account_logout` — `logoutAction`, `userId` capturé AVANT `signOut` sinon perdu.
  - **Décision technique** : `await` (vs fire-and-forget) en server action pour ne pas perdre d'events si le process Next.js termine avant la Promise. Coût : ~10-50ms latence ajoutée, accepté comme prix de la fiabilité forensique.
  - **Pas encore couverts** : signup, email_change, account_deletion, admin_login, role_change, Stripe events. Cf `TODO.md`.
  - ⚠️ **Action Romain** : appliquer la migration `20260427100000_create_audit_logs.sql` en prod via Supabase Studio SQL Editor avant que les call sites loguent (sinon erreurs DB silencieuses).

### Leçons consolidées

- **Itérations CSS qui ne convergent pas → modifier l'asset source.** 3 fixes layout SVG (`0fd3f54`, `cb3ebab`) ont jonglé entre `viewBox`, `size` et hauteurs avant que le 4ᵉ (`71905d2`) ne reparte de l'asset Inkscape (resize-to-drawing). Pattern retenu : **après 2 itérations infructueuses sur un layout SVG, suspecter le whitespace de l'asset plutôt que continuer à patcher le composant.** Voir `LESSONS.md` section « Assets vectoriels ».
- **Découpage gros chantier en phases bornées.** Vision funnel producteur scopé à 3 phases (24/04). Phase 1 + 2 livrées en cohésion forte. Phase 3 finale (DROP `prenom_affichage`) reportée mais sous-chantier `reads` livré post-marathon (commits `894fa5e` + `1110816`) en transition douce → toutes les lectures publiques migrées vers `users.prenom`, écritures laissées en place pour éviter une fenêtre rétro-incompat. Pattern méthodologique : décomposer une migration transversale en (1) ajout du nouveau read path, (2) bascule des lectures, (3) suppression des écritures + DROP COLUMN. Phases 1 et 2 du sous-chantier livrables séparément, phase 3 attend la fenêtre de rétro-compat.
- **Mockup visuel comparatif avant décision design.** Header email vert vs crème — comparaison côte à côte avant choix → décision rapide et défendable. Pattern à répliquer pour tout choix design hors-trivial.
- **Templates Supabase `{{ .RedirectTo }}?{{ .TokenHash }}` est brittle quand `emailRedirectTo` a déjà une query string.** Cf `LESSONS.md` section « Auth & sessions ». Pattern observé en debug du bug magic link consumer (URL `?Missing+code+or+token_hash`) : la double `?` casse `URLSearchParams`. Cf décision Option B retenue (commit `09c219d`).
- **Quand le flow PKCE casse en cross-context, basculer au flow OTP `token_hash` + persister le deep-link via cookie HttpOnly cross-subdomain.** Commit `09c219d`. Le cookie `code_verifier` PKCE n'est pas portable entre hosts qui utilisent des cookie names distincts (isolation Chantier 4) — `verifyOtp` n'a pas ce besoin de matching côté server. Voir `LESSONS.md` section « Auth & sessions ».
- **`initialUser` SSR passé au `UserProvider` élimine le flash hydration.** Commit `6a9ebd3`. Pattern : root layout async lit `getUser()` côté server, passe au provider qui s'initialise dès le SSR. `onAuthStateChange` émet `INITIAL_SESSION` sur abonnement, couvre la résolution initiale ET les changements ultérieurs sans appel `getSession()` redondant. Voir `LESSONS.md` section « Auth & sessions ».
- **Audit logging server-side : `await` (pas fire-and-forget).** Commits `a36fcaa` + `acd8c03`. Coût ~10-50ms accepté comme prix de la fiabilité forensique (RGPD art. 32, PCI DSS 10.x). Helper fail-safe (try/catch silencieux, jamais re-throw) pour ne JAMAIS casser le flow métier — un échec d'audit ne doit pas casser un login. Voir `LESSONS.md` section « Audit & forensique ».
- **Templates Supabase : copier-coller HTML complet par Claude.** Pattern méthodologique : ne jamais demander à un humain de « remplacer cette ligne dans le template Supabase » — fournir le HTML complet à coller. Sinon double `href` produit un bug 500 silencieux côté Supabase au moment de l'envoi (incident debug 26/04). Voir `LESSONS.md` section « Templates Supabase ».
- **`git diff --cached --name-only` avant chaque commit en multi-terminal.** Auto-validé en live sur le commit `fa7cbbd` (post-incident `894fa5e` race condition). Voir `LESSONS.md` section « Working tree partagé — race condition message/diff incohérent ».

## 2026-04-25

### Matinée

- **Hover trigger sur popover « Conseil éleveur » desktop** (commit `5dca301`) : `matchMedia('(hover: hover) and (pointer: fine)')` détecte les devices à pointeur fin et active l'open au hover sur l'icône. Tap mobile préservé via le même Popover Headless UI (Disclosure pattern). Cross-device propre, pas de duplication de markup.
- **Centralize fallback géoloc Le Mans** (commit `22bf88e`) : nouveau module `lib/geo/fallback.ts` exposant constante `GEOLOC_FALLBACK` (`{ lat: 48.0061, lng: 0.1996, label: 'Le Mans' }`) + helper `withGeolocFallback()`. 8 hardcodes Le Mans migrés sur 6 fichiers (carte, recherche producteurs, MiniMap, etc.). Permet de régionaliser le fallback en 1 endroit le moment venu.
- **Carte Mapbox — 4 fixes layout/canvas successifs** :
  - `c3d62ee` : conteneur flex avait `height: 0` (chaîne flex cassée) → forçage `min-height: 400px` sur le wrapper page `/carte`.
  - `83b5326` : `ResizeObserver` ajouté sur le conteneur ref → `map.resize()` au moindre changement de taille (canvas Mapbox restait à 0×0 quand le parent recevait sa hauteur après le mount initial).
  - `e03734e` : retrait de `bg-green-100/40` sur le wrapper direct du canvas — l'arrière-plan masquait le canvas (qui est en `position: absolute` selon mapbox-gl.css).
  - `3ea3555` : passage définitif à `h-full w-full` (au lieu de `absolute inset-0`) sur la div ref. Le CSS `mapbox-gl.css` applique `position: relative; height: 100%` sur `.mapboxgl-map` qui override l'`absolute inset-0` Tailwind par cascade order. Pattern stable retenu.
- **Découplage notifications webhook Stripe via `@vercel/functions waitUntil`** (commits `0761bbe` deps + `db63440` fix) : Resend (email confirmation) + Twilio (SMS) basculés en background via `waitUntil()`. Ack 200 immédiat à Stripe, l'intégrité DB reste synchrone (write order avant ack). Résout les 13% de timeout webhook observés sur le Dashboard Stripe (cf TODO 24/04). Next.js 14 ne dispose pas de `next/server after()` (Next 15+) — `@vercel/functions` est l'équivalent disponible aujourd'hui.
- **MiniMap Mapbox sur fiche produit** (commit `f3fb891`) : nouveau composant partagé `components/ui/mini-map.tsx`, props `{ lat, lng, label?, height? }`, fallback gracieux si coords absentes (encart `Coordonnées non disponibles` + lien vers la commune). Intégré sur la fiche produit (`/producteurs/[slug]/produits/[id]`) avec affichage du point de retrait à la ferme. Pattern Mapbox propre réutilisable (cascade hauteurs + ResizeObserver embarqués).

### Après-midi

- **Pages landing publiques `pro` + `admin` avec rewrites middleware** (commits `dcbc747` producer + `4b9f08d` admin + `ef6bfe4` middleware) : nouvelles pages `app/(public)/pro-accueil/page.tsx` et `app/(public)/admin-accueil/page.tsx` (chrome public, hero + value prop + CTA `/connexion`). Middleware rewrite `pro.terroir-local.fr/` → `/pro-accueil` et `admin.terroir-local.fr/` → `/admin-accueil` pour les visiteurs anonymes uniquement (sessions actives = redirect dashboard comme avant). Bonus 301 cross-subdomain pour les paths `/pro-accueil` ou `/admin-accueil` accédés depuis `www` → renvoie vers le bon sous-domaine.
- **Section « Stats publiques » sur la home consumer** (commits `2e63dc5` + `0caf4c2` itération seuils + `b07e8d8` revalidation cache) : nouveau composant `components/ui/public-stats.tsx` (Server Component) + helper `lib/stats/public-stats.ts` (counts producers `public` / orders `confirmed|ready|completed` / products `active` joined via inner join, cache `unstable_cache` 5 min, fail-open par count). Skip individuel par stat sous son seuil minimum (`PRODUCERS_THRESHOLD=5`, `PRODUCTS_THRESHOLD=10`, `ORDERS_THRESHOLD=15`) pour éviter l'effet « projet vide ». Skip global si toutes sous seuil. Eyebrow `EN CHIFFRES` (sans la marque pour ne pas casser l'identité du logo). Cache invalidé via `revalidateTag('public-stats')` dans le webhook Stripe sur événements `confirmed`.
- **Phase C.4 `SuccessConfirmation` clôturée définitivement (YAGNI confirmée)** (commit `ddb3a02`) : inspection post-skip a montré que `ConfirmationClient` (`app/(consumer)/compte/confirmation/[id]/ConfirmationClient.tsx`, 97 lignes) est déjà extrait dans son fichier dédié, à 1 seul call site, sans duplication ailleurs (grep checkmark + « Merci » : 0 hit similaire). Fragmenter en sous-composants (`SuccessHero`, `OrderRecap`, `PickupInfo`) créerait du churn pour 0 réutilisation. La consolidation admin Phases A+B+C1-C3 a couvert les composants à 2-11 call sites — C.4 était la fausse piste structurelle, pas la dernière dette à éponger. Pattern à valoriser : un terminal qui sait dire « ça vaut pas le coup, voici pourquoi » est plus utile qu'un exécutant aveugle. Item retiré de `TODO.md`.
- **Refactor markers carte WebGL** (commit `6db046c`) : retrait des markers SVG DOM (1 marker par producer = N nodes) → couche WebGL `circle` Mapbox unique alimentée par un GeoJSON `FeatureCollection`. Marker user repositionné en pulsing dot custom layer (animation requestAnimationFrame). Gain perf significatif sur la carte avec N producers ; fini la duplication SVG marker.
- **Carte producteurs — 3D pin images couleur terra** (commit `23d4fa0`) : remplacement de la couche `circle` flat par une couche `symbol` avec image pin 3D générée canvas 2D côté browser (`addImage` au load Mapbox). Gradient terra-300→500 + halo, hover terra-500→700, inner dot blanc, ombre portée. Légende `/carte` mise à jour (icône pin + libellé « Producteur »). Brand cohérent avec la palette TerrOir.
- **Hotfix carte — split hover state en 2 layers** (commit `11b914e`) : Mapbox refuse `feature-state` dans la propriété `icon-image` (layout). Fix : 2 layers `symbol` superposés — couche base affiche le pin terra par défaut, couche hover (filtre `['boolean', ['feature-state', 'hover'], false]`) affiche le pin hover par-dessus. **Incident parallélisation** : ce commit a embarqué par accident 3 renames du chantier connexion TA en cours via working tree partagé (`app/(public)/connexion/*` → `app/connexion/*`). Bisect-unfriendly (build Vercel ko sur ce commit isolément à cause des imports `@/app/(public)/connexion/...` périmés ailleurs), **mais HEAD master final fonctionne** (TA a fini son chantier au commit `2652e4d` et fixé les imports). Pattern documenté dans `LESSONS.md` section Parallélisation.
- **Helper pin image partagé** (commit `78e0306`) : extraction `lib/maps/pin-image.ts` avec generator canvas 2D paramétrique (couleur, taille, hover state). `/carte` et `components/ui/mini-map.tsx` consomment désormais le même pin 3D terra → cohérence brand cross-pages, fini la duplication du code canvas.
- **Couverture invalidation `public-stats` — 1ère vague** (commit `e16459d`) : invalidation `revalidateTag('public-stats')` ajoutée sur les transitions DB qui changent les counts visibles : order cancel + product toggle active/inactive + product edit (si toggle actif) + product create. Complète l'invalidation déjà posée sur webhook order `confirmed` (`b07e8d8`).
- **Centralisation invalidation `public-stats`** (commit `af44d64`) : helper `lib/stats/revalidate.ts` (présent depuis `b07e8d8`) consommé désormais dans `promoteProducerToPublicIfActive` avec `.select('id')` pour ne déclencher l'invalidation que sur transition effective `active → public`. 3 tests vitest ajoutés couvrant les 3 chemins (no-op si pas active, no-op si déjà public, invalide sur transition).
- **Invalidation `public-stats` sur suspend/reactivate producer** (commit `90bf3e3`) : actions admin `suspendProducer` + `reactivateProducer` déclenchent l'invalidation. La carte/home consumer reflète le changement de statut sans attendre l'expiration du cache 5 min.
- **Invalidation `public-stats` sur anonymisation RGPD producer** (commit `c0357f5`) : RPC `delete_user_account` côté producer → `revalidateTag('public-stats')` dans la server action. Couvre le dernier chemin de transition de count producers.
- **Layout `/connexion` adaptatif au sous-domaine** (commit `2652e4d`) : `app/connexion/layout.tsx` détecte le hostname via `headers().get('host')` et injecte le chrome correspondant (navbar/footer www, pro ou admin). Sortie de `/connexion` du route group `(public)` (renames `app/(public)/connexion/*` → `app/connexion/*`). **Bonus dette 1** : redirect post-login devient host-aware (helper extrait dans le commit suivant). **Bonus dette 2** : double `<main>` retiré (le layout consumer en injectait un, la page aussi).
- **Helper `lib/auth/post-login-redirect.ts`** (commit `797c89f`) : 3 niveaux d'API exposés — `loadRoleSnapshot()` lit le rôle de l'user juste après auth, `canonicalPostLoginUrl()` calcule l'URL cross-domain canonique selon rôle (admin → admin., producer → pro., consumer → www.), `localPostLoginPath()` calcule le path same-host quand on n'a pas besoin de cross-domain. `loginAction` refactorisée pour consommer le helper.
- **Magic link callback rôle-aware cross-domain** (commit `2e1a3e5`) : `app/auth/callback/route.ts` utilise un pattern cookie buffer (`cookiesToWrite[]` accumulé puis attaché à la response finale) pour pouvoir choisir la cible cross-domain APRÈS la résolution du rôle. Sans ce pattern, la response était créée upfront avec une URL cible figée, impossible de rediriger sur le bon sous-domaine pour les magic links admin.
- **Redirect immédiat des users déjà loggés sur `/connexion`** (commit `8cb6114`) : check session côté server component `/connexion` → si user déjà authentifié, redirect immédiat vers `canonicalPostLoginUrl(role)`. Évite l'écran de login inutile + boucle visuelle quand un user clique « Connexion » par habitude alors qu'il est déjà connecté. Dette flaggée : la querystring `?redirectTo` n'est pas encore lue par `loginAction` (à traiter dans une session ultérieure).

## 2026-04-24

- **Lien « Voir ma fiche publique » dans catalogue + édition producer** (commit `cfbabbe`) : lien header `target=_blank` à droite du « ← Retour au catalogue » sur la page d'édition produit. Icône ↗ discrète à droite de « Modifier → » sur chaque card du catalogue. Affichage conditionnel au `statut='public'` du producer (sinon la route consumer est en 404).
- **UI consumer : empêcher auto-achat sur son propre produit** (commit `67ed377`) : producer logué sur sa propre fiche produit → bouton « Ajouter au panier » désactivé avec label « Votre produit ». Détection via `useUserContext()` côté front. La RPC `create_order_with_items` reste le filet ultime.
- **Guard DB anti self-ordering dans RPC `create_order_with_items`** (commit `0e1c640`) : un producer connecté ne peut pas commander son propre produit. Bloc 2bis (P0001) : check `user_id` de `producers` vs `p_consumer_id`, raise avant verrou slot/products. Couche DB du triptyque défense en profondeur (UI + RPC). Reste du corps miroir exact de `20260423000000`.
- **Hotfix `prenom_affichage` INSERT initial** (commit `95d0572`, daté 23/04 21:22) : ajout `prenom_affichage: 'À compléter'` sur les 3 INSERT runtime de `producers` (`create-account.ts`, `login-and-upgrade.ts`, `invitation/page.tsx` SSR) + seed aligné sur `p.prenom`. Pattern cohérent avec `nom_exploitation`. La reprise d'onboarding traite `"À compléter"` comme vide pour ne pas pré-remplir le champ prénom. Débloque l'Étape 1 du wizard après apply de la migration C NOT NULL en prod.

## 2026-04-23 (session soir)

- **Post-it conseil éleveur côté consumer** (commit `07a65d4`) : affichage du conseil manuscrit signé du prénom du producteur sur la fiche produit (tooltip desktop + post-it mobile). Défense `prenom_affichage=null` (producer `deleted`).
- **`prenom_affichage` required + conseil editor producer** (commit `ffea6b2`) : champ `prenom_affichage` (1-50 char) ajouté à l'Étape 3 Entreprise du wizard + à la page édition `/onboarding`. Éditeur `conseil` (280 char) intégré sur chaque product côté producer. Migrations `20260423100000` (add column + conseil) → `20260423110000` (backfill depuis `users.prenom`) → `20260423120000` (set NOT NULL) appliquées prod OK.
- **Rotation clé API Resend** (ops) : clé Resend Full Access rotée, 2 endroits mis à jour en parallèle (Vercel `RESEND_API_KEY` + Supabase Dashboard > Auth > SMTP custom). Vérif post-rotation via test email invitation (Mailinator) + Reset Password (Zimbra). Pattern : toute rotation de cette clé = 2 endroits, sinon Supabase continue silencieusement avec la clé révoquée.
- **Audit migrations prod — 7 migrations vertes** (ops) : vérifiées appliquées via queries SQL déterministes.
  - `20260422200000_rgpd_account_deletion.sql`
  - `20260422300000_slot_rules_and_materialized_slots.sql`
  - `20260422300000_add_stripe_customer_id_to_users.sql`
  - `20260422400000_slots_adhoc_and_exceptions.sql`
  - `20260422500000` (capacity slots)
  - `20260422700000_rename_slots_actif_to_active.sql`
  - `20260423000000_rename_products_actif_to_active.sql`
- **Clôture docs session soir 23/04** (commit `5e1a48a`) : incident git embarqué — 3 migrations SQL TC (chantier conseil éleveur) incluses par accident via working tree partagé dans ce commit docs lors d'un merge parallel TB↔TC. Code final correct, historique git confus. Flag retenu pour `LESSONS.md` → règle `git add <fichier précis>` renforcée.
- **Robustesse flow Resend + invitation producer** (commit `ef7f10b`) : 5 fixes.
  1. `console.error("[EMAIL_SEND_FAIL] ...")` sur les 3 chemins d'échec de `sendTemplate` (render_failed, error||!data, catch). Préfixe grep-able dans les logs Vercel — toute erreur était auparavant silencieuse côté logs.
  2. `renderEmail` wrappé try/catch dédié avant l'envoi Resend.
  3. Appel `sendTemplate` côté `invite/route.tsx` wrappé try/catch ceinture+bretelles.
  4. Tokens (`randomBytes` + `generateOptOutToken`) déplacés AVANT l'INSERT `producer_invitations` (pattern tokens-avant-INSERT).
  5. Fallback silencieux `RESEND_FROM_EMAIL` retiré. Throw module-load dans `lib/resend/client.ts` + export `resendFromEmail` typé `string`.
  - Impact collatéral positif : 10 callers de `sendTemplate` bénéficient du logging grep-able sans modification.
- **Pages landing Stripe Connect onboarding** (commit `e93043e`) : `app/(producer)/connect/done/page.tsx` (banner succès + auto-redirect `/parametres` 3s) + `app/(producer)/connect/refresh/page.tsx` (bouton « Reprendre l'onboarding »). Débloque le flow onboarding producer Stripe en prod — sans ces landings, `return_url`/`refresh_url` tombaient sur des 404. Dette « webhook `account.updated` manquant » identifiée à ce moment, résolue le 24/04 (commit `de4a2cd` + migration `20260424000000_producers_stripe_connect_flags.sql`).
- **Auto-bump lead `'contacted'` à l'envoi d'invitation admin** (commit `dbe6360`) : `INSERT` inconditionnel remplacé par `UPDATE` conditionnel gaté sur `emailResult.ok` dans `app/api/admin/producers/invite/route.tsx`. Match par email (case-insensitive) dans `producer_interests` en statut `'new'` → bump `'contacted'`. Silent no-op si pas de match (admin invite un prospect direct). Fix embarqué d'un bug latent pré-existant : l'INSERT créait un doublon `producer_interests` fantôme (nom=email) à chaque invitation admin si le lead existait déjà via formulaire public.

## 2026-04-23 (après-midi)

- **Edge case panier producer suspended/deleted/product/slot/stock** (commits `c6f0567` + `8d8878b`) :
  - Phase 1 endpoint `POST /api/cart/validate` : mapping per-item (`producer`/`product`/`slot`/`slot_full` fatal, `stock_insufficient` non-fatal avec `maxQuantite`, `ok`).
  - Phase 2 hook au load du panier : `removeItem` pour fatals, `updateQuantity` pour stock, banner `StaleItemsBanner` dismissable avec sessionStorage + hash re-flash.
  - Phase 3 re-validation au checkout avant `POST orders/create`, redirect vers `/compte/panier?stale=1` si stale détecté.
  - Défense en profondeur 3 couches : cart load + checkout + RPC `create_order_with_items`.
- **Fix bug logout admin** (commit `f681300`) : `AdminHeader` déclenchait uniquement la server action `logoutAction` → client Supabase browser gardait session en mémoire → `AdminHeader` affichait l'email après déconnexion jusqu'au hard reload. Fix : pattern double `signOut` (client + server) aligné sur `navbar-public.tsx`.
- **Tests vitest étendus** (commits `7904ae9` + `9c3cf0c` + `44c108b`) : +50 tests unitaires sur helpers critiques, zéro modification du code source. `opt-out-token` HMAC (14), `cookie-domain` (17), `date` + `currency` formatters (19). Total : **77 tests green** (vs 27 avant).
- **Custom SMTP Resend configuré** (ops) : `smtp.resend.com:465`, username=`resend`, password=Resend API Key Full Access, sender=`no-reply@terroir-local.fr`. Remplace le built-in Supabase SMTP (rate limit ~3-4/h, non prod).
- **Fix template Magic Link + Recovery** (ops Supabase Dashboard) : remplacer `{{ .SiteURL }}` par `{{ .RedirectTo }}` dans les 2 templates + `&type=` hardcodé. Corrige le routing admin → www reporté le matin.
- **Fix SPF pour emails Resend vers `@terroir-local.fr`** (ops OVH Zone DNS) : ajouter `include:amazonses.com` dans le SPF du domaine. Emails Resend `From:@terroir-local.fr` vers `admin@terroir-local.fr` étaient rejetés par le MX OVH (anti-usurpation interne). SPF final : `v=spf1 include:mx.ovh.com include:amazonses.com ~all`.

## 2026-04-23 (matin)

- **Rename `products.actif → products.active`** (commits `47df4e8` + `9176cc8` + migration `20260423000000_rename_products_actif_to_active.sql` apply) : rename colonne + index `products_actif_idx → products_active_idx` + recreate RLS policy + recreate 2 RPCs (`search_producers`, `create_order_with_items`). Backend + scripts seed : 2 fichiers. Frontend : 12 remplacements sur 6 fichiers. Strings UI FR préservées. **Chantier rename actif → active COMPLET** (slots la veille + products aujourd'hui) — schéma principal 100% en anglais pour les booléens techniques.
- **Phase 7 Créneaux COMPLÈTE** (commits `ffa0967` + `fca4871`) : seed enrichi `slot_rules` sur 5 producers (idempotent). Tests auto vitest : 27 tests (`generate`, `format-slot-time`, `validators`), couverture DST Europe/Paris. **Chantier Créneaux personnalisables 100% CLOS** — Phases 1→7 + Phase 2bis ponctuels/exceptions en prod.
- **Fix CB dupliquée via fingerprint Stripe** (commit `af7d1bb`) : nouvelle server action `validateAndKeepPaymentMethodAction`, dedupe fingerprint côté `AddCardModal` + `/api/stripe/ensure-default-payment-method` (couvre flow checkout). Skip si fingerprint null (défense marques exotiques).
- **Formulaire standalone opt-out V2** (commit `0851924`) : `/desabonnement` sans token affiche un formulaire email pour renvoyer le lien de désabonnement. Server action enumeration-resistant. Email Resend avec token HMAC (même logique). **Chantier RGPD opt-out COMPLET**.
- **Consolidation admin — Phases B2 + B3 + B4** (commits `eaed1a2` + `5b63283` + `2960b18`) :
  - **B2 `AdminModal`** : 3 modals unifiés (`ConfirmValidateModal`, `InviteModal`, `DeleteLeadModal`), close X + Escape hérités.
  - **B3 `FilterTabs`** : 2 pages migrées (`gestion-producteurs`, `producer-interests`).
  - **B4 `AdminPageHeader`** : 4 pages migrées avec prop `error?` en bonus.
- **Phase C.3 `TableActionButton` consolidation admin** (commit `df3840a`) : 4 variants, 2 sizes, support `href`. 11 boutons migrés sur 3 pages. Phase C.4 skippée (1 seul call site).
- **Consolidation admin 100% COMPLÈTE** (Phases A + B1-B5 + C1-C3) : 10 composants partagés (`formatDateFr`, `formatEuro`, `StatusDotBadge`, `ProducerStatusBadge`, `AdminModal`, `FilterTabs`, `AdminPageHeader`, `TableStatus`, `StatusPanel`, `MetricCard`, `TableActionButton`).
- **`METHODOLOGY.md` + `HANDOFF.md` créés** (commit `dd12386`) : doc méthodologie + snapshot reproductible pour Claude frais.

## Nuit 22 → 23/04/2026

- **Fix bug latent `'draft'` statut gestion-producteurs** (commit `e6dc1e3`) : défense en profondeur `STATUS_META`, palette slate neutre. Convention : toute valeur DB possible doit avoir une entrée, même si filtrée au fetch.
- **Page admin "Leads producteurs"** (commit `a8ef04a`) : `/producer-interests` tabs + table actions. Migration RLS DELETE admin apply prod. Lien « Inviter » pré-remplit `InviteModal`. Bonus embarqué (merge parallèle TA/TC) : toggle `showAll` `/gestion-producteurs` — logique TC livrée sous message TA, état code correct mais historique git confus (cf LESSONS parallélisation).
- **Helper centralisé `fetchPublicProducerBySlug`** (commit `7f9540a`) : `lib/producers/fetch-public.ts` — lookup par slug + filter `statut='public'` + `deleted_at IS NULL`, 21 champs typés. 2 pages publiques migrées. 11 lignes de duplication supprimées.
- **Rename `slots.actif → slots.active`** (commit `726bbe5` + migration `20260422700000`) : rename column + RPC updated. 5 fichiers backend. Frontend no-op.
- **Refactor consolidation formatters slots** (commit `de40458`) : `formatLegacyTimeRange` supprimé (structurellement dead). 6 helpers → 5, −10 lignes nettes.
- **Consolidation admin — Phase A formatters** (commit `31670a2`) : `lib/format/date.ts` (`formatDateFr`) + `lib/format/currency.ts` (`formatEuro`). 3 pages admin migrées. −43 lignes de duplication.

## 2026-04-22

### Chantier 2 — Flux invitation producteur ✅ CLÔTURÉ (6 phases en prod)

- **Phase 1** : statuts `draft` + `public` ajoutés en DB (migration `20260421300000`).
- **Phase 2** : blocages admin invitation (admin + producteur déjà inscrit) — commits `2f7b8e4` + `8a33027`.
- **Phase 3** : formulaire onboarding 3 étapes + upgrade consumer → producer — commits `b776421` + `23a2b31` + `52d8e4e` + `4268b20` + migration `20260421400000`.
- **Phase 4** : reprise d'onboarding (redirect middleware vers le bon step si `statut='draft'`) — commit `285785d`.
- **Phase 5** : bouton « Valider » admin (`pending` → `active`) + modal + `STATUS_META` final — commit `9ed234e`.
- **Phase 6** : auto-transition `active` → `public` au 1er produit publié + filtrage RPC/RLS publiques — commits `e885439` + `e13c744` + migrations `20260422000000` + `20260422100000`.

### Chantier 4 — Isolation cookies admin vs www/pro (commit `1d83f5d`)

- Helper `lib/supabase/cookie-domain.ts` avec `cookieConfigForHost()`. Admin : cookie `sb-admin-auth-token`, pas de domain → isolé. www/pro : cookie `sb-*-auth-token`, domain `.terroir-local.fr` → partagé. 3 tests prod validés.

### Chantier 5 — Middleware simplifié (commit `a050c80`)

- Retrait du redirect `/compte` → `pro.*` pour les producers. Un user `consumer+producer` accède librement à `/compte` sur www et au dashboard producteur sur pro.

### Chantier 6 — Switcher consumer/producer (commit `442840b`)

- Composant `components/ui/role-switcher.tsx` variants `light`/`dark`. Affiché si `roles` inclut `'consumer'` ET `'producer'`. Injecté dans Sidebar consumer + `ProducerLayout`.

### RGPD — Suppression de compte

- Migration `20260422200000_rgpd_account_deletion.sql` : statut `'deleted'`, colonnes audit, RPC `delete_user_account()`. Server action + UI `/compte/profil` (commits `d9ce0e8` + `fb64675` + `29fa064`). Tests prod : cas A (hard delete sans orders) + cas C (cascade consumer+producer) validés.

### Fix home admin (commit `581475e`)

- `admin.terroir-local.fr/` → redirect middleware selon session. Logique placée dans middleware (impossibilité Next.js d'avoir `(admin)/page.tsx` et `(public)/page.tsx` au même path).

### Chantier F — Mot de passe oublié (commit `c92b548`)

- Page `/mot-de-passe-oublie` enumeration-resistant + lien sur `/connexion`. Template Supabase Reset Password corrigé (`&type=recovery&` hardcodé). `redirectTo` dynamique via `window.location.origin`. Bonus : fix lien mort `/producteur/inscription`.

### Sidebar producteur — nom réel (commit `a029116`)

- Remplacement placeholder "Ferme des Chênes" par `producer.nom_exploitation` via `useUserContext`. Lien "Voir ma page publique" conditionnel sur `statut='public'`.

### Storage — RLS policies uploads photos (commit `e13c744`)

- Policies INSERT/UPDATE/DELETE sur `storage.objects` pour `product-photos` + `producer-photos`. Vérif `owns_producer(producer_id)` extrait du path.

### Chantier Créneaux personnalisables — Phases 1-6 + 2bis

- **Phase 1** (commit `abd0ec1` + migration `20260422300000_slot_rules_and_materialized_slots.sql`) : schema `slot_rules` + refonte `slots` en instances matérialisées, RLS.
- **Phase 3** (commits `2616cf3` + `21f8c68`) : générateur `lib/slots/generate.ts` tz-aware Europe/Paris (`@date-fns/tz`), UPSERT idempotent.
- **Phase 4** (commit `ba8e6be`) : UI producer `/creneaux` — CRUD slot_rules, multi-select jours, périodicité 1-4 sem, live preview.
- **Phase 5** (commit `e09755f`) : UI consumer accordéon par date.
- **Phase 6** (commit `4675e20` + migration `20260422500000`) : RPC `create_order_with_items` étendue — `capacity_per_slot` + `FOR UPDATE` sur le row slot (anti race condition overbooking).
- **Phase 2bis — Créneaux ponctuels + exceptions** (backend `f63cc19` + UI `dae474a` + migration `20260422400000`) : `slots.rule_id` nullable + `slots.excluded_at`. 5 server actions. UI /creneaux en 3 sections. Fix UX `040a209`.
- **Horizon génération : 4 semaines → 3 mois** (commit `493684e`).

### Chantier Stripe Customer MVP ✅ COMPLET (Phases 1-7)

- **Phase 1** (commit `546fc5e` + migration `20260422300000_add_stripe_customer_id_to_users.sql`) : colonne `users.stripe_customer_id`.
- **Phase 2** (commit `7992727`) : helpers `getOrCreateStripeCustomer()` / `deleteStripeCustomer()`, lazy creation.
- **Phase 3** (commit `a4b6509`) : purge RGPD Stripe Customer dans `delete-account-action.ts`.
- **Phase 4** : page `/compte/paiements` — liste cartes, ajout via SetupIntent + Payment Element, suppression, switch default (commits `2e35f14` + `d338e48` + `fe683ba`).
- **Phase 5** (commit `922de5c`) : lien Sidebar + card dashboard activée.
- **Phase 6** (commit `a7eed72` + `8dce6c1`) : attach customer + checkbox `Mémoriser cette carte` (RGPD) + `setup_future_usage` + endpoint `/api/stripe/ensure-default-payment-method` fail-open.
- **Phase 7** (commit `f2fee74`) : sélecteur CB enregistrée vs nouvelle au checkout, mode saved 1-click.

### Désactivation Stripe Link (commit `f367338`)

- `payment_method_types: ['card']` + `wallets: { applePay: 'never', googlePay: 'never' }`. Link peut persister via override Dashboard.

### Divers fix 22/04

- Fix lien mort `/inscription` → `/auth/inscription` dans NavbarPublic (commit `67f2799`).
- Fix force-dynamic pages consumer (commit `983ed8e`) : `/producteurs/[slug]` et `/produits/[id]` en `force-dynamic`.
- Icône panier navbar + badge (commit `734d20d`) : `ShoppingBagIcon`, badge rouge count, pattern `mounted` anti-hydration.
- Cleanup middleware `/inscription` orpheline (commit `8d4eb27`).
- Refonte `scripts/seed.ts` (commit `379bdbe`) : nouveau modèle `slot_rules` + colonnes récentes, `statut='public'` en dur.

### Qualité & cleanup

- Consolidation type `UserRole` (commit `87371a4`) : suppression re-export mort.
- Helper promote-to-public : `console.error` → `console.warn` + préfixe `[PROMOTE_PRODUCER_WARN]` (commit `653c756`).
- Suppression `/api/stripe/payouts` orphelin (commit `8dcfd19`).

## 2026-04-21

- **Domaine `terroir-local.fr` branché** (Vercel + OVH). Sous-domaines `www` / `pro` / `admin` en Valid Configuration. Zone DNS OVH nettoyée. Rename `terroir.fr` → `terroir-local.fr` (commit `444b2cb`).
- **Env vars Vercel à jour** : `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_PRODUCER_URL`, `RESEND_FROM_EMAIL`.
- **Resend vérifié pour `terroir-local.fr`** : DKIM + SPF + MX + DMARC.
- **Nettoyage `STRIPE_CONNECT_CLIENT_ID`** (code mort).
- **Nettoyage Redirect URLs Supabase Auth** (suppression `terroir.fr`).
- **Boîte email `admin@terroir-local.fr`** créée (Zimbra/OVH).
- **Template Supabase Magic Link fixé** (`type=magiclink` en dur, `{{ .TokenHash }}` validé).
- **Route `/auth/callback`** + page `/reset-password` (commit `49265bc`).
- **Site URL Supabase corrigée** (`www.terroir-local.fr`).
- **Chantier 1 (refactor rôles) déployé en prod** : migration `20260421100000_cumulative_roles_admin_users.sql` — table `public.admin_users`, `users.roles text[]`, triggers d'exclusion mutuelle, fonction `is_admin()`.
- **Fix GRANT `supabase_auth_admin`** : migration `20260421200000_grant_auth_admin_on_public.sql` (USAGE schema + ALL PRIVILEGES `public.*`).
- **Fix tokens auth NULL → ''** : users créés par INSERT SQL direct dans `auth.users` doivent avoir les 8 colonnes token en string vide.
- **Compte admin créé** : `admin@terroir-local.fr` (id `478d643a-9d2a-485d-aedf-438ca2eda246`).
- **Soirée auth/UX** (commits `a9792f9` → `0aa2555`) : redirect post-login simplifié, header connecté avec icône + prénom + badge Admin, page `/compte/password`, bouton Déconnexion, layout `/compte` + layout admin dédié (light/corporate).
- **Résilience client Supabase** : `createSupabaseBrowserClient` singleton, `.catch` sur `getSession()`, double `signOut` logout.
- **Reskin admin light theme** (commit `a6f2c92`) : 3 pages admin unwrappées d'`AdminLayout`.
- **Padding admin content area** (commit `ae5c8f0`).
- **Seed 5 producteurs Sarthe fictifs** (commits `f4be9ca` + `91559cb`) : photos Unsplash. Scripts `scripts/seed-producers.ts` + `scripts/cleanup-seed.ts`.
