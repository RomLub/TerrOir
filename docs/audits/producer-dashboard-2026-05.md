# Audit dashboard producteur — TerrOir

**Date** : 2026-05-14
**Périmètre** : tout le dossier `app/(producer)/` + composants, lib,
schéma DB, Stripe Connect et emails côté producteur.
**Méthode** : lecture seule du repo sur `master` + queries SELECT via
MCP Supabase. Aucune modification de code.

> **Glose** : « RLS » = Row-Level Security, les règles SQL Supabase qui
> décident qui peut lire/écrire quelle ligne d'une table. « RPC » =
> Remote Procedure Call, ici une fonction SQL appelée depuis Next.js
> via `supabase.rpc('nom', params)`. « SECDEF » = `SECURITY DEFINER`,
> une fonction SQL qui s'exécute avec les droits de son créateur
> (souvent `service_role`, bypass RLS contrôlé). « SSR » = Server-Side
> Rendering, le HTML est calculé côté serveur Next.js avant envoi au
> navigateur.

---

# Phase 1 — Inventaire exhaustif

## 1.1 Arbo routes producteur

Route group : `app/(producer)/` (les parenthèses signalent un *route
group* Next : pas de segment URL ajouté). Toutes les pages sont servies
sur le sous-domaine `pro.terroir-local.fr` (le `layout.tsx` force la
redirection si on les atteint sur un autre host en prod).

```
app/(producer)/
├── layout.tsx              # garde session + host pro.*, defense-in-depth
├── loading.tsx             # skeleton générique entre layout et page
├── error.tsx               # error boundary route-level (reset, ref digest)
├── _components/
│   └── ProducerLayout.tsx  # sidebar nav + footer producer
├── dashboard/
│   ├── page.tsx            # SSR via RPC get_producer_dashboard (1 query)
│   └── DashboardClient.tsx # client, realtime INSERT orders
├── commandes/
│   ├── page.tsx            # liste commandes paginée cursor + count
│   ├── ProducerCommandesClient.tsx
│   ├── _components/
│   │   └── PickupValidationCard.tsx   # input TRR-XXXXX + modal preview
│   └── [id]/
│       ├── page.tsx        # détail commande, fetch order+items
│       └── OrderDetailClient.tsx
├── catalogue/
│   ├── page.tsx            # liste produits (toggle active, modal stock)
│   ├── CatalogueClient.tsx
│   ├── nouveau/
│   │   └── page.tsx        # création produit (cascade catégorie→animal→cut)
│   └── [id]/modifier/
│       └── page.tsx        # édition produit
├── creneaux/
│   ├── page.tsx            # règles récurrentes + ad-hoc + exceptions
│   ├── actions.ts          # 9 server actions (CRUD slot_rules + slots)
│   └── _components/        # SlotRuleModal, AdHocSlotModal, BulkExclude, etc.
├── alertes-stock/
│   └── page.tsx            # liste produits attendus par consumers
├── ma-page/
│   ├── page.tsx            # éditeur profil public producteur
│   └── _components/
│       └── IndicateursSection.tsx     # T-232 score-carbone + DGCCRF
├── mes-avis/
│   ├── page.tsx            # liste avis publiés (server)
│   └── AvisClient.tsx      # cards + édition réponse 24h
├── revenus/
│   ├── page.tsx            # hero prochain virement + 8 semaines + table
│   └── _lib/badge-mapping.ts
├── comptabilite/
│   └── page.tsx            # sélecteur dates + download CSV
├── parametres/
│   └── page.tsx            # exploitation + Stripe Connect + SMS opt-in
├── connect/
│   ├── done/page.tsx       # landing return_url Stripe Connect
│   └── refresh/page.tsx    # landing refresh_url Stripe Connect
└── onboarding/
    └── page.tsx            # reprise OnboardingWizard pour producer draft
```

### Mapping URLs côté producteur

Toutes les URLs ci-dessous résolvent sur `https://pro.terroir-local.fr`
en prod.

| URL | Fichier source |
|-----|----------------|
| `/dashboard` | `app/(producer)/dashboard/page.tsx` |
| `/commandes` | `app/(producer)/commandes/page.tsx` |
| `/commandes/[id]` | `app/(producer)/commandes/[id]/page.tsx` |
| `/catalogue` | `app/(producer)/catalogue/page.tsx` |
| `/catalogue/nouveau` | `app/(producer)/catalogue/nouveau/page.tsx` |
| `/catalogue/[id]/modifier` | `app/(producer)/catalogue/[id]/modifier/page.tsx` |
| `/creneaux` | `app/(producer)/creneaux/page.tsx` |
| `/alertes-stock` | `app/(producer)/alertes-stock/page.tsx` |
| `/ma-page` | `app/(producer)/ma-page/page.tsx` |
| `/mes-avis` | `app/(producer)/mes-avis/page.tsx` |
| `/revenus` | `app/(producer)/revenus/page.tsx` |
| `/comptabilite` | `app/(producer)/comptabilite/page.tsx` |
| `/parametres` | `app/(producer)/parametres/page.tsx` |
| `/connect/done` | `app/(producer)/connect/done/page.tsx` |
| `/connect/refresh` | `app/(producer)/connect/refresh/page.tsx` |
| `/onboarding` | `app/(producer)/onboarding/page.tsx` |

### Routes API consommées par le front producteur

| URL API | Fichier route | Consommée par |
|---------|--------------|---------------|
| `POST /api/orders/[id]/confirm` | `app/api/orders/[id]/confirm/route.tsx` | `OrderDetailClient`, `ProducerCommandesClient` |
| `POST /api/orders/[id]/cancel` | `app/api/orders/[id]/cancel/route.tsx` | idem |
| `POST /api/orders/[id]/complete` | `app/api/orders/[id]/complete/route.tsx` | `OrderDetailClient` (form code) |
| `GET/POST /api/producer/orders/validate-pickup` | `app/api/producer/orders/validate-pickup/route.ts` | `PickupValidationCard` |
| `PATCH /api/producer/products/[id]` | `app/api/producer/products/[id]/route.ts` | `CatalogueClient` (modal stock) |
| `POST/DELETE /api/producer/reviews/[id]/respond` | `app/api/producer/reviews/[id]/respond/route.ts` | `AvisClient` |
| `POST /api/stripe/connect/onboard` | `app/api/stripe/connect/onboard/route.ts` | `parametres`, `connect/refresh` |
| `GET /api/exports/producer/comptabilite.csv` | `app/api/exports/producer/comptabilite.csv` (route à vérifier) | `comptabilite/page.tsx` |

> Note : `comptabilite/page.tsx` appelle `/api/exports/producer/comptabilite.csv`.
> Le dossier `app/api/exports/producer/` existe mais l'inventaire
> directory doit confirmer le fichier route exact — non vérifié dans
> cette session pour préserver le scope.

---

## 1.2 Arbo composants producteur

```
components/
├── producer/
│   ├── .gitkeep
│   ├── ScoreCarbonIndicators.tsx     # 3 pills mode_elevage/alim/densite (a11y T-215)
│   └── ScoreCarbonPreview.tsx        # aperçu temps réel onboarding + /ma-page
├── consumer/                          # composants côté consumer (hors scope)
├── admin/                             # composants côté admin (hors scope)
├── ui/                                # design system partagé
├── listings/                          # ListingHeader, etc. partagé
├── providers/                         # user-provider, etc.
└── beef/                              # composants viande boeuf (hors scope direct)
```

**Constat** : le dossier `components/producer/` est quasiment vide
(2 composants techniques sur score-carbone). Tout le reste vit en
`_components/` colocalisé sous `app/(producer)/...`. Voir 2.3.

Composants producteur dispersés :

| Chemin | Rôle (1 ligne) |
|--------|----------------|
| `app/(producer)/_components/ProducerLayout.tsx` | Sidebar verte + nav 10 items + RoleSwitcher + lien page publique |
| `app/(producer)/commandes/_components/PickupValidationCard.tsx` | Validation rapide retrait via code TRR-XXXXX (3 vues idle/preview/success) |
| `app/(producer)/creneaux/_components/SlotRulesList.tsx` | Liste règles récurrentes |
| `app/(producer)/creneaux/_components/SlotRuleModal.tsx` (+ Lazy) | Création/édition règle |
| `app/(producer)/creneaux/_components/AdHocSlotsList.tsx` | Liste créneaux ponctuels |
| `app/(producer)/creneaux/_components/AdHocSlotModal.tsx` (+ Lazy) | Ajout créneau ponctuel |
| `app/(producer)/creneaux/_components/ExceptionsList.tsx` | Liste créneaux exclus + actions ré-inclure |
| `app/(producer)/creneaux/_components/ExcludeSlotModal.tsx` (+ Lazy) | Exclure un créneau spécifique |
| `app/(producer)/creneaux/_components/BulkExcludeRangeModal.tsx` (+ Lazy) | Exclure une plage (vacances) |
| `app/(producer)/ma-page/_components/IndicateursSection.tsx` | Éditeur 3 enums DGCCRF + déclaration véracité |
| `components/producer/ScoreCarbonIndicators.tsx` | Source unique des 3 indicator cards (consommée publique + perso) |
| `components/producer/ScoreCarbonPreview.tsx` | Aperçu temps réel pour onboarding et `/ma-page` |

---

## 1.3 Layout & navigation

### `app/(producer)/layout.tsx` (RSC)

```tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";

export default async function ProducerLayout({ children }) {
  const session = await getSessionUser();
  if (!session) redirect("/connexion");

  const host = (await headers()).get("host") ?? "";
  if (process.env.NODE_ENV === "production" && !host.startsWith("pro.")) {
    redirect("https://pro.terroir-local.fr/dashboard");
  }
  return <div className="producer-layout">{children}</div>;
}
```

Rôle : defense-in-depth — le middleware est la première barrière, ce
layout sert de filet. Pas de check de rôle producer ici (le
middleware §3b s'en occupe et redirige draft → `/onboarding`).

### `app/(producer)/_components/ProducerLayout.tsx` (client)

Sidebar verte fixe (`bg-green-900`, w-64, sticky). Contenu :
- Logo + tag « Espace Producteur »
- Nav 10 items (icônes texte ASCII)
- `RoleSwitcher` (variant dark)
- Bloc bas : `producer.nom_exploitation` + lien « ↗ Voir ma page
  publique » (visible uniquement si `statut === 'public'`)

### Liens présents dans la nav (sidebar)

| Label | href | Page existe ? |
|-------|------|---------------|
| Dashboard | `/dashboard` | ✅ |
| Commandes | `/commandes` | ✅ |
| Catalogue | `/catalogue` | ✅ |
| Alertes stock | `/alertes-stock` | ✅ |
| Créneaux | `/creneaux` | ✅ |
| Ma page | `/ma-page` | ✅ |
| Avis | `/mes-avis` | ✅ |
| Revenus | `/revenus` | ✅ |
| Comptabilité | `/comptabilite` | ✅ |
| Paramètres | `/parametres` | ✅ |

**Absents de la nav** :
- Aucun lien direct « Se déconnecter » dans la sidebar (seul le
  `RoleSwitcher` permet de basculer ; la déconnexion réelle est gérée
  ailleurs, probablement via la page consumer).
- Aucun lien « Mon profil personnel » (changer mot de passe, email,
  téléphone, supprimer compte) — voir 2.1.
- Aucun lien « Documents / factures / attestations DGCCRF ».
- Aucun lien « Support / Contact ».

### Liens internes mentionnés mais sans page cible

Findings cartographie :
- **`/revenus/[id]` n'existe pas**. La page `revenus/page.tsx` ligne
  195 génère un lien « Détail → » vers `/revenus/{p.id}` pour chaque
  ligne du tableau historique des virements. Aucun fichier
  `revenus/[id]/page.tsx` n'existe → 404 dès qu'un producteur clique.
- **`/connect/done` ligne 10-11 dit en commentaire** : « la source de
  vérité du statut Connect remontera via webhook account.updated
  (non implémenté à ce jour — dette) ». Faux : `account.updated` est
  bien implémenté dans `lib/stripe/sync-account-flags.tsx` et câblé
  dans `app/api/stripe/webhook/route.tsx` ligne 194. Le commentaire
  est obsolète, à corriger.

---

## 1.4 Pages du dashboard — résumés et appels DB

> Cette section liste, pour chaque page, son rôle, ses appels DB et
> ses appels HTTP. Les contenus complets des `page.tsx` ont été
> intégralement lus pendant l'audit ; ils ne sont pas re-collés ici
> pour ne pas faire exploser le fichier d'audit (chaque page fait 60 à
> 567 lignes). Les chemins permettent de re-lire au besoin.

### 1.4.1 `/dashboard` (`app/(producer)/dashboard/page.tsx`, 279 lignes)

Pattern coquille SSR : récupère session + producer puis appelle **une
seule** RPC `get_producer_dashboard` qui retourne en un coup :
- user (prenom/nom)
- orders_today, orders_yesterday
- week_orders (CA cette semaine, agrégé côté client en `revenueWeek`)
- last_week_orders (idem semaine passée → delta %)
- producer_row (note moyenne, nb avis, 3 badges score 0-100)
- pending_orders (jusqu'à n commandes à confirmer)
- upcoming_orders (prochain retrait)
- slots semaine + week_pickups (planning visuel 7 jours)
- low_stock_products (alertes stock < 5)

Le `DashboardClient.tsx` ajoute un realtime subscribe sur
`postgres_changes` table `orders` filter `producer_id=eq.{id}` pour
incrémenter `ordersToday` en live.

**Optimisation** : 1 RPC SECDEF au lieu de 11 queries Promise.all
(audit F-045 2026-05-11). Très propre.

### 1.4.2 `/commandes` (`app/(producer)/commandes/page.tsx`, 145 lignes)

Pattern coquille SSR. Pagination cursor `created_at DESC + id DESC`,
limit 100, en parallèle d'un `count(*) exact` pour la bannière
`ListingHeader`.

**Query principale** :
```ts
admin.from('orders')
  .select(`id, code_commande, created_at, statut, montant_total,
    date_retrait, heure_retrait,
    consumer:consumer_id ( prenom, nom ),
    slots:slot_id ( starts_at, ends_at ),
    order_items ( quantite, products:product_id ( nom, unite ) )`)
  .eq('producer_id', producer.id)
  .order('created_at', { ascending: false })
  .order('id', { ascending: false })
  .limit(100);
```

Le client `ProducerCommandesClient` :
- 4 tabs (À confirmer / Confirmées / Terminées / Annulées) — les
  counts sont **dérivés des 100 lignes déjà chargées**, pas du total.
- `PickupValidationCard` en haut (saisie code TRR-XXXXX → preview
  modale → confirmation).
- Boutons inline « Confirmer » / « Annuler » sur cards pending →
  appellent `/api/orders/[id]/confirm` ou `/cancel`.

### 1.4.3 `/commandes/[id]` (`page.tsx`, 105 lignes + `OrderDetailClient.tsx`, 249 lignes)

SSR fetch + ownership check explicite :
```ts
if (order.producer_id !== producer.id) redirect('/commandes');
```

Affiche : détail retrait (date/créneau), articles avec prix unitaire +
sous-total, sous-total + commission 6% + net producteur, infos client
(nom/email cliquable mailto / téléphone cliquable tel:), actions
contextuelles (confirmer, annuler, valider retrait avec code).

Note : utilise des chaînes mojibake (« â€” », « Ã  ») hardcodées dans
`page.tsx` lignes 18, 23, 56, 85-86 — probablement une corruption
d'encodage lors d'un copier-coller passé. Non bloquant mais sale.

### 1.4.4 `/catalogue` (`page.tsx`, 51 lignes + `CatalogueClient.tsx`, 328 lignes)

SSR liste tous les produits du producer, ordonné `created_at DESC`.
Client : grille de cards, toggle actif (UPDATE direct via supabase JS
browser), modal stock (PATCH `/api/producer/products/[id]`).

Effets de bord après toggle actif :
- `promoteProducerToPublicIfActive()` (auto-promotion pending → public)
- `revalidatePublicStats()` + `revalidatePublicProducts()` +
  `revalidateProducersSearch()`

### 1.4.5 `/catalogue/nouveau` et `/catalogue/[id]/modifier`

Formulaire complet : nom, description, cascade catégorie → animal →
morceau (T-220 PR-B), prix, unité, poids estimé, conseil éleveur
(280 char max), photos (drag-drop, 5 max), stock (limité/illimité),
délai préparation, toggle actif. Preview `ProductCard` en sidebar.

INSERT/UPDATE direct via `supabase.from('products')` côté browser
(RLS owner all).

### 1.4.6 `/creneaux` (`page.tsx`, 168 lignes + `actions.ts`, 635 lignes)

Trois sections :
1. **Règles récurrentes** (`slot_rules`) : jours de la semaine,
   périodicité (semaines), heure début/fin, durée slot, capacité.
2. **Créneaux ponctuels** (`slots` avec `rule_id IS NULL`) : ouverture
   exceptionnelle date+heure précise.
3. **Exceptions** (`slots.excluded_at IS NOT NULL`) : créneaux fermés
   (vacances, indispo).

9 server actions exportées dans `actions.ts` (toutes en SECDEF via
admin client + guard ownership) :
- `createSlotRuleAction`, `updateSlotRuleAction`,
  `toggleSlotRuleActiveAction`, `deleteSlotRuleAction`
- `createAdHocSlotAction`, `deleteAdHocSlotAction`
- `excludeSlotAction`, `unexcludeSlotAction`,
  `bulkExcludeRangeAction`

Guards : refus de suppression si commandes actives sur le slot, refus
d'exclusion si commandes actives sur le slot, conversion TZ Europe/Paris
→ UTC pour les bornes ad-hoc.

Après chaque mutation : `generateSlotsForProducer(admin, producerId, 90)`
matérialise les slots 90 jours en avance + `revalidatePath('/creneaux')`.

### 1.4.7 `/alertes-stock` (97 lignes)

Affichage stato post-fetch : liste des produits attendus par des
consumers (alertes confirmed, non notifiées, non unsubscribed),
groupées par produit + count. Lien « Réapprovisionner → » vers
`/catalogue`. Pas d'interaction (refresh = navigation).

### 1.4.8 `/ma-page` (497 lignes)

Page client, éditeur profil public producteur :
- Onglet **Aperçu** (rendu `ProducerCard` tel qu'affiché publiquement)
- Onglet **Éditer** : nom exploitation, description, histoire,
  générations, année création, espèces, labels, commune, code postal,
  photos (hero + galerie max 6), section indicateurs DGCCRF (cf.
  `IndicateursSection`).

Save : `supabase.from('producers').update(...)` direct via client
browser (RLS owner update) + `revalidateProducerCard()` +
`revalidateProducersSearch()`.

### 1.4.9 `/mes-avis` (67 lignes + `AvisClient.tsx`, 295 lignes)

SSR fetch reviews `statut='published'` ordonnés `published_at DESC`.
Client : cards avec note, commentaire, prénom auteur, et formulaire
réponse producteur (500 char max, édition pendant 24h après
publication, fenêtre lockée ensuite par
`producer_response_locked_at`).

Endpoints : `POST/DELETE /api/producer/reviews/[id]/respond`.

### 1.4.10 `/revenus` (206 lignes)

SSR + 2 queries + 1 count :
- `payouts` toutes périodes DESC
- `orders` 8 dernières semaines pour agrégation graphique
- `orders` count complétées pour la période du prochain payout

Affichage : hero prochain virement (montant + date virage = `periode_fin + 2j`),
graphe 8 semaines (barres CSS), tableau historique. **Lien
`/revenus/[id]` → 404** (page n'existe pas, cf. 1.3).

### 1.4.11 `/comptabilite` (122 lignes)

Page client minimaliste : 2 inputs date + bouton « Télécharger CSV »
qui appelle `GET /api/exports/producer/comptabilite.csv?from=...&to=...`,
récupère le blob et trigger download.

### 1.4.12 `/parametres` (271 lignes)

Page client. 3 sections :
1. **Exploitation** : nom, adresse, commune, code postal, SIRET
   (UPDATE direct via supabase JS browser).
2. **Paiements Stripe Connect** : 3 états (ready / pending /
   not-started) avec bouton « Démarrer » / « Reprendre l'onboarding »
   / « Mettre à jour » qui POST `/api/stripe/connect/onboard` et
   redirige `window.location.href = body.url`.
3. **Notifications** : toggle email (disabled, hardcodé true,
   « activé par défaut »), toggle SMS (`users.sms_optin` UPDATE).

**Absences notables** :
- Pas de changement mot de passe / email / 2FA
- Pas de gestion sessions actives
- Pas de suppression de compte
- Pas de profil perso (prénom/nom/téléphone affichés mais non
  modifiables ici)
- Pas de granularité fine sur les notifications email (nouvelle
  commande, retrait du jour, payout, avis, etc. — un seul toggle
  désactivé)

### 1.4.13 `/connect/done` et `/connect/refresh`

`done` : landing post-onboarding Stripe Connect, message vert,
auto-redirect `/parametres` 3s + bouton manuel. Pas de vérif
server-side du statut (le webhook `account.updated` met à jour la DB
en asynchrone).

`refresh` : landing si l'Account Link a expiré, POST
`/api/stripe/connect/onboard` pour générer un nouveau lien et
redirige.

### 1.4.14 `/onboarding` (89 lignes)

Reprise pour un producer `statut='draft'` qui retourne dans son
espace. Réutilise `OnboardingWizard` (composant partagé avec le
flow `/invitation` côté public) en mode `caseKind="consumer-loggedin"`
+ `startStep={2}`. La légitimité vient de la session + du producer
draft existant (pas du token email).

---

## 1.5 Schéma DB côté producteur

Tables consommées par le producteur (lecture ou écriture, directe ou
via RPC) :

### `producers` (10 lignes prod actuellement)

Colonnes (43 au total) :
- Identité publique : `id`, `slug`, `nom_exploitation`, `siret`,
  `adresse`, `commune`, `code_postal`, `description`, `histoire`,
  `photo_principale`, `photos[]`, `annee_creation`, `generations`,
  `especes[]`, `labels[]`
- Coordonnées GPS (sensibles) : `latitude`, `longitude` —
  **REVOKE SELECT** anon+authenticated (audit 2026-05-07). Accès via
  RPC `search_producers` (roundCoord 2 décimales) ou
  `lib/producers/fetch-public.ts` (admin + arrondi serveur).
- Statut + abonnement : `statut` (pending/draft/public),
  `abonnement_niveau`, `abonnement_expire_at`
- Stripe Connect : `stripe_account_id`, `stripe_charges_enabled`,
  `stripe_payouts_enabled`, `stripe_details_submitted`,
  `stripe_cleanup_pending`
- Badges : `note_moyenne`, `nb_avis`, `badge_stock_score`,
  `badge_confirmation_score`, `badge_annulation_score`
- Forme : `forme_juridique`, `type_production`,
  `type_production_precision`
- Score-carbone (DGCCRF) : `mode_elevage`, `alimentation`,
  `densite_animale`, `declaration_indicateurs_veracite_at`,
  `declaration_indicateurs_snapshot` (jsonb),
  `declaration_indicateurs_wording_version`,
  `declaration_indicateurs_enums_version`
- `deleted_at`

**Trigger BEFORE UPDATE** `producers_block_owner_admin_columns` bloque
25 colonnes admin-only sur self-update (cf. `CLAUDE.md` §8).

**RLS policies** :
- `producers owner read` : `auth.uid() = user_id`
- `producers owner update` : idem (USING + WITH CHECK)
- `producers owner insert` : idem WITH CHECK
- `producers admin all` : `is_admin()`
- `producers public read when public` : `statut = 'public'` (rôle `public`)

### `products` (16 lignes)

Colonnes : `id`, `producer_id`, `nom`, `description`, `photos[]`,
`prix`, `unite`, `poids_estime_kg`, `stock_disponible`,
`stock_illimite`, `delai_preparation_jours`, `active`, `conseil_active`,
`conseil_texte`, `category_id` (→ `product_categories`), `animal_id`
(→ `animals`), `cut_id` (→ `cuts`).

**RLS** :
- `products owner all` : `owns_producer(products.producer_id)` (USING + WITH CHECK)
- `products public read when producer public` : `active=true AND is_producer_public(producer_id)`

### `slot_rules` (7 lignes)

Colonnes : `id`, `producer_id`, `days_of_week int[]` (0-6 ISO),
`periodicity_weeks` (1=hebdo, 2=quinzaine, ...), `start_time`,
`end_time`, `slot_duration_minutes`, `capacity_per_slot`, `active`.

**RLS** :
- `slot_rules owner all` : `owns_producer(slot_rules.producer_id)`
- `slot_rules public read when producer public` :
  `is_producer_public(producer_id)`
- `slot_rules admin all` : `is_admin()`

### `slots` (1005 lignes — matérialisation 90 jours rolling)

Colonnes : `id`, `producer_id`, `rule_id` (nullable = ad-hoc),
`starts_at timestamptz`, `ends_at timestamptz`, `capacity_per_slot`,
`active`, `excluded_at` (nullable = ouvert).

**RLS** :
- `slots owner all` : `owns_producer(slots.producer_id)`
- `slots public read when producer public` :
  `is_producer_public(producer_id)`

### `orders` (20 lignes)

Colonnes : `id`, `consumer_id`, `producer_id`, `statut`,
`code_commande`, `slot_id`, `date_retrait`, `heure_retrait` (legacy),
`montant_total`, `commission_terroir`, `montant_net_producteur`,
`stripe_payment_intent_id`, `notes_client`, `created_at`,
`confirmed_at`, `completed_at`, `cancelled_at`, `closure_reason`,
`cgv_accepted_at`, `cgv_version`, `review_followup_d2_sent_at`,
`review_followup_d7_sent_at`, `transfer_id`.

**RLS** :
- `orders parties read` : `auth.uid() = consumer_id OR owns_producer(producer_id)`
- `orders consumer insert` : `auth.uid() = consumer_id`
- `orders service_role update only` : USING `false`, WITH CHECK `false`
  → toute mise à jour passe obligatoirement par une RPC SECDEF ou par
  le service_role (très bonne hygiène).

### `order_items` (20 lignes)

Colonnes : `id`, `order_id`, `product_id`, `quantite`, `prix_unitaire`,
`sous_total`.

**RLS** :
- `order_items via order` : `can_access_order(order_items.order_id)`
  (USING + WITH CHECK) — délègue à la RPC SECDEF qui check
  consumer_id ou owns_producer.

### `reviews` (0 ligne)

Colonnes : `id`, `order_id`, `consumer_id`, `producer_id`, `note`,
`commentaire`, `statut`, `created_at`, `published_at`,
`producer_response`, `producer_response_at`,
`producer_response_updated_at`, `producer_response_locked_at`,
`producer_response_status`.

**RLS** :
- `reviews public read when published` : `statut='published'` (public)
- `reviews author read/update` : `auth.uid()=consumer_id`
- `reviews consumer insert after completed order` :
  `is_completed_order_of_caller(order_id)` (RPC SECDEF)
- `reviews producer response update` : `owns_producer(producer_id)`

### `payouts` (0 ligne — production pas encore live)

Colonnes : `id`, `producer_id`, `periode_debut`, `periode_fin`,
`montant_brut`, `commission`, `montant_net`, `stripe_transfer_id`,
`stripe_payout_id`, `statut` (pending/processing/paid/failed),
`error_msg`, `created_at`, `updated_at`.

**RLS** :
- `payouts producer read` : `owns_producer(payouts.producer_id)`

### `product_stock_alerts` (0 ligne)

Inscriptions consumers pour notification retour en stock. Le
producteur en lit via le helper `fetchProducerAlerts` (admin
client) — pas de RLS publique côté producer.

### `disputes` (0 ligne)

Chargebacks Stripe. **RLS** : `disputes admin read` UNIQUEMENT
(`is_admin()`). Aucun accès producteur, même en lecture, alors que la
table tracke des litiges qui concernent ses commandes.

### `pending_refunds` (0 ligne)

Workflow approval admin pour refund producer au-delà du cap
`PRODUCER_REFUND_CAP_EUR` (F-014 v2). Le producer initie via
`/api/stripe/refund` (UI à confirmer — voir 2.1).

**RLS** :
- `pending_refunds producer read own` : `producer_id IN (SELECT id FROM producers WHERE user_id = auth.uid())`
- `pending_refunds admin all` : `is_admin()`

### `user_notification_preferences` (0 ligne)

Préférences fines email. Default toutes activées (opt-out).

**RLS** : self CRUD (`user_id = auth.uid()`).

### `notifications` (111 lignes)

Log d'envois email/SMS. **RLS** : `notifications owner read`
(`user_id = auth.uid()`). Pas d'UI producteur pour les consulter.

### `producer_invitations` (22 lignes)

Tokens invitations onboarding. **RLS** admin only. Le producer
consomme indirectement via `/invitation/<token>` côté public, pas
depuis le dashboard.

### `refund_incidents`

Source-of-truth des refunds Stripe ratés (cron retry). **RLS** :
`refund_incidents admin read` UNIQUEMENT. Pas d'accès producer.

### RPCs `SECURITY DEFINER` consommables par un producteur connecté

Liste extraite de `information_schema.routines` filtrée
`security_type='DEFINER'` :

| RPC | Rôle |
|-----|------|
| `get_producer_dashboard` | RPC consolidée dashboard (F-045) |
| `confirm_order_by_producer` | Bascule `pending → confirmed` + side-effects |
| `cancel_order_by_producer` (via `cancel_order`) | Annule + restore stock + déclenche refund |
| `complete_pickup_by_producer` | Valide retrait via code TRR-XXXXX |
| `update_producer_onboarding` | Mutation atomique des champs onboarding |
| `update_producer_indicateurs` | Indicateurs DGCCRF (re-date snapshot véracité) |
| `search_producers` | Listing public (roundCoord) — pas pour producer mais idem schéma |
| `owns_producer(uuid)` | Helper RLS |
| `is_admin()` | Helper RLS |
| `is_producer_public(uuid)` | Helper RLS |
| `can_access_order(uuid)` | Helper RLS |
| `is_completed_order_of_caller(uuid)` | Helper RLS (reviews insert) |
| `restore_product_stock_on_order_cancel` | Trigger fonction (interne) |
| `delete_user_account` | RGPD (interne, appelée depuis lib/rgpd) |

Auxiliaires (autres SECDEF dans le schéma) : `bump_geocode_cache`,
`upsert_geocode_cache`, `check_producer_interests_rate_limit`,
`create_order_with_items`, `get_admin_dashboard`,
`get_role_snapshot_revocation`, `get_user_deletion_status`,
`increment_otp_attempts_if_below_cap`,
`invalidate_active_invitations_for_email`,
`log_auth_user_deletion`, `on_admin_users_changed_revoke_snapshot`,
`on_users_roles_changed_revoke_snapshot`,
`producers_block_owner_admin_columns` (trigger),
`record_refund_attempt`, `revive_order_with_stock_check`,
`touch_role_snapshot_revocation`, `users_block_owner_protected_columns` (trigger).

---

## 1.6 État Stripe Connect côté producteur

### Pages/composants UI

| Surface | Rôle |
|---------|------|
| `app/(producer)/parametres/page.tsx` | Section « Paiements Stripe Connect » : 3 états ready/pending/not-started + bouton onboard. |
| `app/(producer)/connect/done/page.tsx` | Landing `return_url` Stripe Connect. Auto-redirect /parametres. |
| `app/(producer)/connect/refresh/page.tsx` | Landing `refresh_url` Stripe Connect (Account Link expiré). |

### Routes API Stripe consommées

| Endpoint | Rôle |
|----------|------|
| `POST /api/stripe/connect/onboard` (`app/api/stripe/connect/onboard/route.ts`) | Crée un compte Connect Express (`controller.fees.payer=application`, `losses.payments=application`, `requirement_collection=stripe`, `stripe_dashboard.type=express`), persiste `stripe_account_id`, génère un Account Link `account_onboarding`. Rate-limited 3/60s par user (audit W-2). Compensation orpheline si UPDATE producers échoue (`stripe.accounts.del` best-effort). |
| `POST /api/stripe/refund` | Refund initié par producer ou admin (route `tsx`, hors scope inventaire fine — confirmer côté consumer/admin). |
| `POST /api/stripe/webhook` | Webhook signature `STRIPE_WEBHOOK_SECRET`. Handlers : `payment_intent.succeeded`, `payment_intent.payment_failed`, **`account.updated`**, `payout.paid`, `payout.failed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `radar.early_fraud_warning.created`, `charge.refunded`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`, `account.application.deauthorized`. |

### Handler `account.updated` (lib/stripe/sync-account-flags.tsx)

- Lit `charges_enabled`, `payouts_enabled`, `details_submitted` de
  `Stripe.Account`.
- Lit la row producteur précédente (état avant UPDATE) pour détecter
  la transition `charges_enabled true → false` (F-042).
- UPDATE producers SET les 3 flags WHERE `stripe_account_id = account.id`.
- Sur transition critique :
  - `sendOpsAlert("[STRIPE_CHARGES_DISABLED]", ...)` (Sentry +
    email admin)
  - Email producer template `producer_kyc_blocked` (sujet généré
    dynamiquement par template, props :
    `{ exploitation, producerId, stripeAccountId, disabledReason,
    currentlyDue, dashboardUrl }`).
- Cas orphelin (account.id Stripe sans row producer en DB) : log
  warn `[STRIPE_ACCOUNT_NOT_FOUND]`, retour `{updated:false}`,
  ack 200 webhook.

### Webhooks impactant le producer (synthèse)

| Event | Fichier handler | Side-effect producer |
|-------|-----------------|---------------------|
| `account.updated` | `lib/stripe/sync-account-flags.tsx` | UPDATE flags + email KYC bloqué |
| `account.application.deauthorized` | `lib/stripe/handle-account-deauthorized.tsx` | Marque `stripe_cleanup_pending=true` + email admin |
| `payout.paid` | `lib/stripe/handle-payout-paid.ts` | UPDATE `payouts.statut=paid` |
| `payout.failed` | `lib/stripe/handle-payout-failed.tsx` | UPDATE `payouts.statut=failed` + email admin |
| `charge.refunded` | `lib/stripe/handle-charge-refunded.ts` | (impacte order producer indirectement) |
| `charge.dispute.created/updated/closed` | `lib/stripe/handle-dispute-*` | INSERT/UPDATE disputes (admin only RLS, producer non averti) |
| `radar.early_fraud_warning.created` | `lib/stripe/handle-early-fraud-warning.tsx` | Email admin |

**Constat majeur** : aucun email producer n'est envoyé sur
**`charge.dispute.created`** alors qu'un litige le concerne
directement. Cf. 2.1 / 3.1.

### Endroits où le producer reçoit des emails Stripe-related

| Template | Trigger |
|----------|---------|
| `producer-kyc-blocked.tsx` | `account.updated` transition charges_enabled true→false |
| `payout-summary.tsx` | Cron `/api/cron/weekly-payout` — résumé hebdo |
| `order-confirmed-producer.tsx` | `payment_intent.succeeded` (notify producer d'une commande payée) |

---

## 1.7 État emails / notifications côté producteur

### Templates Resend producer-facing

| Fichier | Destinataire | Trigger |
|---------|--------------|---------|
| `lib/resend/templates/producer-invitation.tsx` | prospect | API admin invite (out of scope dashboard) |
| `lib/resend/templates/producer-kyc-blocked.tsx` | producer | Webhook `account.updated` (charges désactivées) |
| `lib/resend/templates/producer-refund-pending-decision.tsx` | producer | Workflow F-014 v2 (refund > cap, attente admin) |
| `lib/resend/templates/order-confirmed-producer.tsx` | producer | `payment_intent.succeeded` (nouvelle commande payée) |
| `lib/resend/templates/payout-summary.tsx` | producer | Cron weekly-payout (résumé virement) |
| `lib/resend/templates/review-response-notification.tsx` | consumer | Réponse producer postée (cf. `lib/notifications/send-review-response-email.ts`) |

### Triggers d'envoi côté producer (inventaire)

- **Webhook Stripe `account.updated`** → `producer_kyc_blocked` (cas
  transition charges true→false uniquement)
- **Webhook Stripe `payment_intent.succeeded`** →
  `order_confirmed_producer` (via `handle-payment-succeeded-notify.tsx`)
- **Cron `/api/cron/weekly-payout`** → `payout_summary`
- **Cron `/api/cron/reminder-sms`** → SMS producer
  (`sms_new_order_producer`) via Twilio
- **Server action `/admin/refunds/pending`** approve/deny →
  `producer_refund_pending_decision`

### Surface UI producer pour gérer ses notifications

`/parametres` → section Notifications :
- Toggle email : **disabled, hardcodé true** (pas de granularité)
- Toggle SMS : `users.sms_optin` (booléen unique)

La table `user_notification_preferences` existe et a des colonnes
plus fines (ex: `email_review_response`) mais aucune UI producer ne
les expose.

---

# Phase 2 — Audit interprétation

## 2.1 Audit complétude fonctionnelle

> Statuts : ✅ implémenté · 🟡 partiel · ❌ manquant · ❓ pas
> vérifiable depuis cet inventaire.

### Onboarding & profil

| Capacité métier | Statut | Localisation / ce qui manque |
|-----------------|--------|------------------------------|
| Accepter une invitation par email | ✅ | `app/(public)/invitation/page.tsx` + token signed |
| Reprendre l'onboarding (producer draft) | ✅ | `app/(producer)/onboarding/page.tsx` réutilise `OnboardingWizard` |
| Compléter / éditer le profil public | ✅ | `app/(producer)/ma-page/page.tsx` |
| Gérer photos hero + galerie | ✅ | `ma-page/page.tsx` (max 6 + 1 hero) |
| Coordonnées GPS (lat/lng) | 🟡 | Champs en DB, set par geocoding côté admin/onboarding, jamais éditables producer (volontaire — voir RLS lat/lng REVOKE) |
| Déclaration véracité DGCCRF | ✅ | `IndicateursSection.tsx` re-date `declaration_indicateurs_veracite_at` à chaque update |
| Modifier prénom / nom / téléphone perso | ❌ | Pas d'UI producer. Le wizard set ces champs à l'onboarding, après c'est figé côté producer. À confirmer si accessible via `(consumer)/compte/profil` en cross-domain. |

### Produits

| Capacité métier | Statut | Localisation / ce qui manque |
|-----------------|--------|------------------------------|
| Créer un produit | ✅ | `/catalogue/nouveau` |
| Éditer un produit | ✅ | `/catalogue/[id]/modifier` |
| Activer/désactiver un produit | ✅ | `/catalogue` toggle inline |
| Gérer stock (qté + illimité) | ✅ | Modal sur `/catalogue` (PATCH dédié) |
| Photos produit | ✅ | Drag-drop max 5 photos |
| Cascade catégorie → animal → morceau | ✅ | T-220 PR-B |
| Variantes (différentes tailles d'un même produit) | ❌ | Pas de table `product_variants` — chaque variante = produit séparé |
| TVA / régime fiscal | ❌ | Pas de colonne TVA, pas d'UI |
| Bulk operations (activer/désactiver/dépublier en masse) | ❌ | Toggle un par un uniquement |
| Filtres / recherche dans le catalogue | ❌ | Liste brute ordonnée par date, pas de search/filter |
| Duplication d'un produit (template) | ❌ | Pas d'action |

### Créneaux & disponibilité

| Capacité métier | Statut | Localisation / ce qui manque |
|-----------------|--------|------------------------------|
| Définir créneaux récurrents | ✅ | `slot_rules` + `SlotRuleModal` |
| Périodicité (hebdo, quinzaine, mensuel) | ✅ | `periodicity_weeks` |
| Créneau ponctuel ad-hoc | ✅ | `AdHocSlotModal` |
| Exclure un créneau (vacances ponctuelles) | ✅ | `ExcludeSlotModal` |
| Bulk exclude (plage de vacances) | ✅ | `BulkExcludeRangeModal` |
| Capacité par créneau | ✅ | `capacity_per_slot` |
| Voir capacité restante / réservations live par créneau | 🟡 | `/dashboard` planning agrège commandes ; `/creneaux` n'affiche pas combien il reste |
| Bloquer un créneau dont une commande active existe | ✅ | Refus côté server action |
| Notification client si créneau exclu après réservation | ❓ | Non vérifié dans ce scope |

### Commandes

| Capacité métier | Statut | Localisation / ce qui manque |
|-----------------|--------|------------------------------|
| Voir commandes en cours / passées | ✅ | `/commandes` |
| Filtres par statut (tabs) | ✅ | 4 tabs (À confirmer, Confirmées, Terminées, Annulées) |
| Filtre par date / client / créneau | ❌ | Aucun filtre actif, juste les tabs |
| Pagination | 🟡 | Cursor `created_at DESC + id DESC`, mais les counts par tab sont calculés sur les 100 premières rows seulement → trompeur si > 100 commandes |
| Recherche par code commande | ❌ | Absent |
| Confirmer une commande | ✅ | `/api/orders/[id]/confirm` (RPC `confirm_order_by_producer`) |
| Annuler une commande | ✅ | `/api/orders/[id]/cancel` (RPC `cancel_order`) |
| Valider un retrait (pickup code) | ✅ | `/api/producer/orders/validate-pickup` + RPC `complete_pickup_by_producer`, deux UIs (`PickupValidationCard` + form `OrderDetailClient`) |
| Marquer en préparation (état intermédiaire) | ❌ | Pas d'état `preparing` dans la state machine — seulement `pending → confirmed → completed` |
| Gérer un litige client | ❌ | Aucun accès `disputes` côté producer. RLS table = admin only |
| Refund partiel | 🟡 | Endpoint `/api/stripe/refund` existe + workflow F-014 v2 (pending_refunds), mais **pas d'UI dans `(producer)/`** pour initier un refund |
| Notes internes par commande | ❌ | Seul `notes_client` est lisible côté producer (note du consumer) |
| Imprimer un bon de retrait / récap pour le client | ❌ | Pas d'action print/PDF |
| Realtime live new orders | 🟡 | Realtime channel sur `/dashboard` (incrémente `ordersToday`), absent sur `/commandes` |

### Paiements

| Capacité métier | Statut | Localisation / ce qui manque |
|-----------------|--------|------------------------------|
| Onboarding Stripe Connect Express | ✅ | `/parametres` + `/api/stripe/connect/onboard` |
| Reprise onboarding (refresh) | ✅ | `/connect/refresh` |
| Voir statut KYC / charges_enabled | ✅ | `/parametres` (3 états ready/pending/not-started) |
| Notification email KYC bloqué | ✅ | `producer_kyc_blocked` (F-042) |
| Voir solde Stripe (cash balance) | ❌ | Aucune query `stripe.balance.retrieve`, pas d'UI |
| Voir prochain virement (montant prévisionnel) | ✅ | `/revenus` hero |
| Historique payouts | ✅ | `/revenus` tableau |
| Détail d'un payout (lignes incluses, commission) | ❌ | Lien `/revenus/[id]` existe mais **page 404** |
| Accès Stripe Express Dashboard | ❌ | Aucun bouton « Ouvrir mon Dashboard Stripe Express » côté UI. L'onboarding link fait office mais pas en mode lecture pure. |
| Email résumé hebdo payout | ✅ | `payout_summary` via cron `weekly-payout` |
| Voir les commissions TerrOir prélevées (cumul / période) | 🟡 | Visible par commande sur `/commandes/[id]` ; pas de vue cumul dédiée |
| Notification dispute / chargeback | ❌ | Email admin uniquement (`admin_dispute_action_required`), pas d'email producer ni d'UI |

### Statistiques

| Capacité métier | Statut | Localisation / ce qui manque |
|-----------------|--------|------------------------------|
| CA jour / semaine / mois | 🟡 | Jour (ordersToday/yesterday) + semaine (revenueWeek/lastWeek) sur `/dashboard`. Pas de vue mois ni année. |
| Évolution sur 8 semaines | ✅ | Graphe `/revenus` |
| Volume commandes | 🟡 | Compte par tab sur `/commandes` (limité 100), compte global sur `ListingHeader`. Pas de stats agrégées. |
| Top produits | ❌ | Aucune query, aucune UI |
| Clients récurrents | ❌ | Aucune UI (et RGPD-délicat selon agrégation) |
| Taux de confirmation / annulation | 🟡 | Le score « réactivité » (`badge_confirmation_score`) et « fiabilité » (`badge_annulation_score`) sont affichés sur `/dashboard` sans détail derrière |
| Cohorte / saisonnalité produits | ❌ | Absent |
| Export stats CSV / Excel | 🟡 | Export comptable existe sur `/comptabilite`, pas d'export stats |

### Compte & sécurité

| Capacité métier | Statut | Localisation / ce qui manque |
|-----------------|--------|------------------------------|
| Changer mot de passe | ❌ | Pas d'UI dans `(producer)/`. Page `app/(consumer)/compte/password/page.tsx` existe — accessible en cross-domain seulement |
| Changer email (avec OTP) | ❌ | Idem, vit dans `(consumer)/compte/profil/` |
| 2FA / TOTP | ❌ | Pas implémenté côté projet (à confirmer côté Supabase Auth) |
| Voir sessions actives | ❌ | Pas d'UI |
| Supprimer mon compte (RGPD) | ❌ | Pas d'UI producer. `delete-account-action.ts` côté consumer |
| Se déconnecter (link explicite) | 🟡 | Pas de lien « Se déconnecter » dans la sidebar producer. RoleSwitcher permet de basculer. |
| Voir mes logs d'accès / audit perso | ❌ | `audit_logs` existe (310 rows) mais aucune surface producer |

### RGPD

| Capacité métier | Statut | Localisation / ce qui manque |
|-----------------|--------|------------------------------|
| Export mes données | ❌ | Page `/compte/exporter-mes-donnees` côté consumer uniquement |
| Voir opt-ins / opt-outs liés | ❌ | Pas d'UI dédiée producer |
| Lister consumers ayant alerté un produit (alertes stock) | ✅ | `/alertes-stock` (count agrégé, pas de PII) |

### Support

| Capacité métier | Statut | Localisation / ce qui manque |
|-----------------|--------|------------------------------|
| Contacter TerrOir / formulaire | ❌ | Pas de page support, pas de form |
| Voir les communications reçues (annonces, CGU updates) | ❌ | Pas d'inbox in-app, `notifications` table non exposée UI producer |
| FAQ / aide en ligne contextuelle | ❌ | Pas de tooltips d'aide étendus, pas de page `/aide` |

### Documents & légal

| Capacité métier | Statut | Localisation / ce qui manque |
|-----------------|--------|------------------------------|
| Voir / télécharger ses factures TerrOir | ❌ | Pas d'UI |
| Télécharger l'attestation DGCCRF signée (snapshot véracité) | 🟡 | Le snapshot est stocké en jsonb dans `producers.declaration_indicateurs_snapshot` mais pas exposé en téléchargement |
| Voir l'historique des versions de CGV signées | ❌ | `orders.cgv_version` enregistrée, pas affichée |
| Voir les conditions actuelles (CGV producer + contrat distribution) | ❓ | Existe probablement sous `app/(public)/*`, pas linké dans la sidebar |
| Export comptable CSV | ✅ | `/comptabilite` |

---

## 2.2 Audit UX / parcours

### Page `/dashboard`

- **Ce qui devrait sauter aux yeux** : combien j'ai de commandes à
  confirmer maintenant (urgence), et est-ce que j'ai un retrait
  imminent à préparer.
- **Ce qui saute effectivement aux yeux** : le titre « Bonjour
  {prenom} 👋 » très gros (40px serif), puis des alert bars
  (« X commandes en attente de confirmation »), puis 4 KPI tiles
  uniformes, puis la liste « À confirmer », puis le planning semaine,
  puis les badges. Hiérarchie OK : les pending_orders + stockAlerts
  sont bien remontés en haut sous le titre. Le « Prochain retrait »
  est noyé dans la grille de 4 KPIs au lieu d'avoir un traitement
  distinct.
- **Densité** : raisonnable. Le planning semaine en grille 7 colonnes
  est dense mais lisible. Les badges en bas de page sont décoratifs
  (score affiché sans drill-down). Trois actions critiques (confirmer
  commande, valider retrait, planning) sont bien visibles.
- **Cachés / mis trop en avant** : les badges fiabilité prennent
  l'espace en bas de page sans CTA pour comprendre comment les
  améliorer (cliquer sur le score ne fait rien). Le « delta hier »
  (`+N depuis hier`) sur le KPI commandes-jour est sympa mais peu
  actionable.

### Page `/commandes`

- **Ce qui devrait sauter aux yeux** : les commandes à confirmer
  (urgence + risque pénalité), et le code de retrait facile à saisir.
- **Ce qui saute effectivement aux yeux** : le titre « Vos
  commandes », un `ListingHeader` (count total), puis
  `PickupValidationCard` (excellent — gros input TRR-XXXXX en haut),
  puis tabs avec counts, puis la liste. C'est cohérent.
- **Densité** : bonne. Chaque card commande a code/date reçue/nom
  client/items en colonne + montant/badge statut en aside + actions
  inline.
- **Problèmes** :
  - Les counts par tab sont calculés sur les 100 commandes chargées,
    pas sur la totalité — trompeur si le producer en a plus.
  - La pagination est unidirectionnelle (charger les 100 plus
    anciennes) sans retour au top.
  - Pas de recherche par code commande / nom client, pas de filtre
    par date.

### Page `/commandes/[id]`

- **Ce qui devrait sauter aux yeux** : l'action à faire (confirmer /
  préparer / valider retrait) + l'identité du client et son créneau.
- **Ce qui saute effectivement aux yeux** : titre « Commande de
  {prenom} », badge statut en haut à droite, puis 2 colonnes (détail
  retrait + articles + bloc validation code à gauche, client + actions
  à droite sticky). Hiérarchie OK.
- **Densité** : bien. Le bloc « Validation du retrait » avec input
  géant (40px text + tracking) est designé pour saisie rapide.
- **Problèmes** :
  - L'aside « Actions » à droite avec un seul bouton « Annuler » sur
    statut `confirmed` est un peu vide (alors qu'on attend l'action
    « Valider retrait » qui est à gauche).
  - Mojibake (`â€”`, `Ã`) dans la fonction `formatReceived` —
    affiché brut au user. Sale.
  - Email et téléphone client sont cliquables (`mailto:` / `tel:`)
    mais aucune option « voir l'historique de commandes de ce
    client » (récurrence).

### Page `/catalogue`

- **Ce qui devrait sauter aux yeux** : combien j'ai de produits
  actifs vs inactifs, lesquels sont en rupture, et comment en ajouter.
- **Ce qui saute effectivement aux yeux** : titre + sous-titre
  « N produits actifs · M au total » + CTA primary « + Ajouter un
  produit » bien visible, puis grille de cards. Bonnes affordances
  visuelles (badge « Stock faible » / « Épuisé » sur photo, opacity 60%
  sur produits inactifs).
- **Problèmes** :
  - Pas de tri / filtre / search (catégorie, animal, prix, stock).
  - Pas de bulk select.
  - Pas de drag-drop pour l'ordre d'affichage public.
  - Modal stock fait directement un PATCH sans confirmation visuelle
    explicite sur le before/after (juste re-render).

### Page `/catalogue/nouveau` et `/modifier`

- **Ce qui devrait sauter aux yeux** : preview du résultat + champs
  essentiels (nom, prix, stock, photos).
- **Hiérarchie** : preview `ProductCard` en sidebar (très bien),
  formulaire en main avec cascade catégorie → animal → morceau
  (potentiellement bloquant si le producer ne sait pas quoi
  sélectionner). Le bandeau warning « catégorie manquante » sur
  `/modifier` est utile.
- **Problèmes** :
  - Cascade T-220 PR-B peut être confuse pour le producer si la
    catégorie sélectionnée ne nécessite pas d'animal/cut (selects
    cachés vs disabled inconsistant).
  - Pas de validation côté client sur les photos (taille max, ratio).
  - Pas de mode brouillon (le toggle `active` joue ce rôle mais
    flush en DB).

### Page `/creneaux`

- **Ce qui devrait sauter aux yeux** : mes règles actives (quels
  jours, quelles heures), où ajouter une exception (vacances).
- **Ce qui saute effectivement aux yeux** : 3 sections empilées
  (règles récurrentes / créneaux ponctuels / exceptions). Sans
  visualisation calendrier, c'est conceptuellement lourd pour un
  producer non-tech.
- **Problèmes majeurs** :
  - **Pas de calendrier visuel** : tout est en listes/cards. Un
    producer ne voit pas d'un coup d'œil les semaines à venir.
  - Pas de récapitulatif « voici ce que les clients verront
    sur les 14 prochains jours ».
  - Bulk exclude utile mais caché derrière un modal pas
    contextualisé (pas de prévisualisation).

### Page `/alertes-stock`

- **Ce qui devrait sauter aux yeux** : combien de personnes attendent
  quoi, et où ré-approvisionner.
- **Hiérarchie** : titre + paragraphe explicatif + cards (nom produit
  + count gros à droite + lien « Réapprovisionner → »). Très lisible,
  fonctionnel.
- **Manque** : aucun moyen de message direct aux consumers en
  attente (ex: « Je rouvre la semaine prochaine, merci de patienter »).

### Page `/ma-page`

- **Ce qui devrait sauter aux yeux** : à quoi ressemble ma fiche
  publique (preview), et où la modifier.
- **Hiérarchie** : deux onglets Preview / Edit. Bien pensé. Preview
  utilise le composant `ProducerCard` réel.
- **Problèmes** :
  - Composant fait 497 lignes — devrait être splitté.
  - `IndicateursSection` (DGCCRF) est greffée en bas du formulaire,
    pas mis en avant comme un acte légal distinct.
  - Pas de validation que la photo principale n'est pas vide avant
    la promotion en `public`.

### Page `/mes-avis`

- **Ce qui devrait sauter aux yeux** : note moyenne, derniers avis,
  avis sans réponse (à traiter).
- **Hiérarchie** : stats (total / responded / average) en haut, puis
  liste DESC `published_at`. OK.
- **Problèmes** :
  - Pas de filtre note (1-5 étoiles) ni avis sans réponse.
  - Pas de tri (chronologique uniquement).
  - Pas de notification email producer quand un avis arrive (à
    vérifier — ne semble pas exister vu l'inventaire emails).

### Page `/revenus`

- **Ce qui devrait sauter aux yeux** : combien je vais toucher, quand.
- **Hiérarchie excellente** : hero vert très grand avec montant +
  date virement + count commandes. Graphe 8 semaines en dessous.
  Tableau historique.
- **Problèmes** :
  - **`/revenus/[id]` lien mort** → 404 dès qu'on clique
    « Détail → ».
  - Le hero n'inclut que les payouts `pending` (legacy). Avec la
    nouvelle séquence (INSERT direct en `processing`), le hero
    affichera souvent « 0,00 € » alors qu'il y a un `processing` en
    cours. Inconsistance entre architecture data et affichage.

### Page `/comptabilite`

- **Ce qui devrait sauter aux yeux** : où sélectionner la période, où
  cliquer pour télécharger.
- **Hiérarchie** : minimaliste, OK. Le hint sur le format CSV est
  utile.
- **Manque** : pas de prévisualisation des lignes incluses, pas
  d'historique des exports faits, pas d'export à des formats
  comptables standard (FEC, EBP).

### Page `/parametres`

- **Ce qui devrait sauter aux yeux** : mon état Stripe Connect
  (puis-je recevoir des paiements oui/non), où changer les infos
  exploitation.
- **Hiérarchie** : Exploitation en haut (form large), Stripe Connect
  (alerte colorée verte/ambre selon état + CTA), Notifications.
- **Problèmes majeurs** :
  - Une seule toggle SMS dans les notifications, l'email est
    hardcodé `true` sans granularité. Anti-pattern UX (l'illusion de
    contrôle alors qu'il n'y en a aucun).
  - Pas de section sécurité du tout (mot de passe, email, sessions,
    suppression compte). Le producer doit aller dans
    `(consumer)/compte/*` (différent sous-domaine).
  - Pas d'accès direct au Stripe Express Dashboard (utile pour
    consulter ses payouts en détail côté Stripe).

### Parcours producteur multi-pages

| Parcours | Guidage |
|----------|---------|
| Accepter invitation → compléter onboarding → publier | ✅ OnboardingWizard puis auto-redirect, bandeau « OnboardedBanner » sur `/ma-page` |
| Onboarding interrompu → reprise | ✅ Middleware redirige `draft` vers `/onboarding` qui réutilise le wizard step 2+ |
| Onboarding terminé → connecter Stripe | 🟡 L'utilisateur doit penser à aller dans `/parametres` (pas de CTA « Connectez Stripe maintenant » sur le dashboard après onboarding) |
| Créer premier produit | 🟡 Aucun empty state guidé sur `/dashboard` ; l'utilisateur doit aller dans `/catalogue` et voir « Aucun produit » |
| Définir premiers créneaux | ❌ Aucune indication qu'il faut créer des slot_rules pour que les consumers puissent réserver. Pas d'onboarding produit-to-creneaux. |
| Recevoir première commande → confirmer → préparer → valider retrait | 🟡 Email `order_confirmed_producer` reçu, dashboard alert bar visible, validation code TRR-XXXXX accessible. Mais pas d'état intermédiaire « en préparation » (le statut reste `confirmed` du moment où le producer confirme jusqu'au retrait) |
| Recevoir un avis → y répondre | 🟡 Pas d'email producer quand un avis est posté (à vérifier) ; bandeau ou alert bar absent sur `/dashboard` |
| Recevoir une dispute → réagir | ❌ Aucune visibilité côté producer (RLS admin only, pas de notification) |
| Refund partiel client | ❌ Pas d'UI producer pour initier un refund < cap ou demander > cap |

---

## 2.3 Audit cohérence architecture

### Duplications composants

- `PickupValidationCard.tsx` (carte + modal) coexiste avec un form
  intégré dans `OrderDetailClient.tsx` (input TRR-XXXXX + bouton
  « Valider le retrait »). Deux UI, deux UX, même endpoint
  (`/api/producer/orders/validate-pickup` côté card, `/api/orders/[id]/complete`
  côté detail). À réconcilier : ou bien le detail n'a plus de form
  (juste un lien vers la card en haut), ou bien la card est un wrapper
  qui appelle la même API.
- `app/(producer)/dashboard/DashboardClient.tsx` redéfinit ses propres
  formatters `euros()` et utilitaires de date — `lib/format/`,
  `lib/slots/format-slot-time.ts` existent et sont utilisés ailleurs.
- Composants `_components/` colocalisés sous chaque route alors que
  certains sont génériques (ex: `AdHocSlotModal` pourrait vivre en
  `components/producer/`). Le dossier `components/producer/` ne
  contient quasi rien et n'est pas exploité comme convention.

### Fetch DB direct dans les `page.tsx`

- `/dashboard` : appel RPC SECDEF — **propre** (1 query, 1 fichier).
- `/commandes` : SELECT direct via admin client — pourrait être
  remonté dans `lib/orders/list-for-producer.ts`.
- `/commandes/[id]` : SELECT direct via admin client + ownership
  check inline (`order.producer_id !== producer.id`) — devrait
  remonter dans `lib/orders/fetch-for-producer.ts` avec helper
  ownership.
- `/catalogue` : SELECT direct via admin client — idem, à remonter
  dans `lib/products/list-for-producer.ts`.
- `/revenus` : SELECT direct via admin client (3 queries) — à
  remonter dans `lib/payouts/list-for-producer.ts` avec agrégation.
- `/mes-avis` : SELECT direct via admin client — à remonter.
- `/alertes-stock` : passe par `fetchProducerAlerts()` helper —
  **propre**.
- `/ma-page` : SELECT et UPDATE depuis le **client browser**
  (Supabase JS direct), confiance RLS — pattern différent du reste.
- `/catalogue/nouveau` et `/modifier` : idem `ma-page` (SELECT/INSERT/UPDATE
  depuis client browser).
- `/parametres` : SELECT/UPDATE depuis client browser.

**Constat** : deux écoles cohabitent dans le code.
- Pages **server-rendered** qui utilisent `createSupabaseAdminClient()`
  (bypass RLS volontaire) + ownership check explicite.
- Pages **client-rendered** qui utilisent
  `createSupabaseBrowserClient()` (RLS appliquée).

Les pages **client** (`/ma-page`, `/parametres`, `/catalogue/nouveau`,
`/modifier`) sont les plus risquées du point de vue cohérence sécu :
elles reposent uniquement sur la RLS pour empêcher des fuites. Un test
de régression a bien été mis en place (`tests/meta/no-raw-coords-leak.test.ts`
mentionné dans le doctrine `producers`) pour les coords GPS, mais pas
de garantie systémique pour les autres colonnes admin-only.

### Couche d'autorisation des server actions

`creneaux/actions.ts` est exemplaire :
- `getSessionUser()` puis `resolveProducerId()` (helper local) ;
- guard ownership systématique (`SELECT ... WHERE id=X` puis
  `if (existing.producer_id !== producerRes.id) return error`).

Les routes API producer sont mixed :
- `/api/producer/products/[id]` : à confirmer (pas lu en détail).
- `/api/producer/orders/validate-pickup` : RPC SECDEF
  (`complete_pickup_by_producer`) qui fait le check côté SQL.
- `/api/producer/reviews/[id]/respond` : à confirmer.
- `/api/orders/[id]/{confirm,cancel,complete}` : RPCs SECDEF.

**Constat** : la conjugaison RLS + RPC SECDEF + ownership checks
applicatifs est solide globalement, mais l'hétérogénéité (client
direct vs server actions vs RPC vs admin client + check JS) rend la
revue future plus coûteuse.

### Types DB

Les types DB sont générés via `npm run codegen:enums` (cf. CLAUDE.md
§6) mais l'usage est inégal :
- `OrderStatus` (enum) importé depuis `@/components/ui` (pas depuis
  `@/types/database`) dans `/commandes/page.tsx` — couplage UI/types
  louche.
- Plusieurs pages redéclarent à la main des shapes de rows
  (`{ id, code_commande, ... }`) en `type` local plutôt que dériver
  du codegen.

### Tests

Couverture identifiée :

**Tests unitaires Vitest sous `tests/`** :
- `tests/app/(producer)/commandes/[id]/OrderDetailClient.test.tsx`
- `tests/app/(producer)/commandes/_components/PickupValidationCard.test.tsx`
- `tests/app/(producer)/revenus/_lib/badge-mapping.test.ts`
- `tests/app/api/producer/orders/validate-pickup/route.test.ts`
- `tests/app/api/producer/orders/validate-pickup/integration.test.ts`
- `tests/app/api/producer/products/[id]/route.test.ts`
- `tests/app/api/producer/reviews/respond.test.ts`
- `tests/app/api/exports/producer/route.test.ts`
- `tests/components/producer/score-carbon-preview.test.tsx` (+ snapshot)

**Tests E2E Playwright sous `tests/e2e/producer/`** :
- `onboarding-flow.spec.ts`
- `onboarding-multistep.spec.ts`
- `orders-received.spec.ts`
- `payouts-history.spec.ts`
- `pickup-validation.spec.ts`
- `products-crud.spec.ts`
- `profil-public.spec.ts`
- `slots-management.spec.ts`
- `comptabilite-export.spec.ts`

**Trous identifiés** :
- Aucun test unitaire sur les server actions de
  `creneaux/actions.ts` (~635 lignes, 9 actions ; seul l'E2E
  `slots-management.spec.ts` les exerce).
- Aucun test sur `DashboardClient.tsx` (realtime channel, rendu KPI).
- Aucun test sur le RPC `get_producer_dashboard` côté SQL
  intégration (vitest.sql.config.ts).
- Aucun test sur `IndicateursSection.tsx` ni sur
  `update_producer_indicateurs` (snapshot DGCCRF qui a valeur
  probatoire).
- Aucun test sur la page `/revenus/page.tsx` ni son agrégation
  hebdomadaire.

### TODO / FIXME visibles dans le périmètre producer

Pas de TODO/FIXME formels. Plusieurs commentaires « dette » :
- `connect/done/page.tsx:10-11` : commentaire obsolète disant
  `account.updated` non implémenté alors qu'il l'est. À supprimer.
- `revenus/page.tsx:62-66` : commentaire T-414 décrivant l'évolution
  du cron weekly-payout — la nouvelle séquence n'insère plus en
  `pending`, donc le hero (`nextPending`) devrait remonter
  `processing`, pas seulement `pending`.
- `parametres/page.tsx:165-169` : commentaire 3 états Stripe — bonne
  doc inline.

### Commentaire « webhook account.updated non implémenté » faux

Voir 1.3 + 1.6. Le commentaire ligne 10-11 de
`app/(producer)/connect/done/page.tsx` doit être supprimé : le
handler vit dans `lib/stripe/sync-account-flags.tsx` et est appelé
dans `app/api/stripe/webhook/route.tsx:194`. C'est un faux signal de
dette pour la prochaine session.

---

# Phase 3 — Synthèse

## 3.1 Top 10 manques bloquants pour un launch producer-side

Classement par criticité décroissante :

1. **Aucune visibilité producer sur les disputes / chargebacks.**
   Table `disputes` admin-only, aucun email producer, aucune UI.
   Le producer apprend qu'il a perdu de l'argent uniquement via le
   payout réduit. Risque : escalade support + sentiment d'opacité.

2. **Pas de page « Sécurité / Compte perso »** (mot de passe, email,
   suppression compte, sessions). Le producer doit aller dans
   `(consumer)/compte/*` sur un autre sous-domaine — non documenté
   dans la sidebar. Risque RGPD si le « droit à l'effacement » n'est
   pas accessible depuis le bon espace.

3. **Lien `/revenus/[id]` mort (404)** sur le tableau historique des
   virements. Le producer clique « Détail → » sur sa page revenus et
   atterrit en 404. Cassant pour la confiance financière.

4. **Hero `/revenus` n'affiche que `pending`** alors que la nouvelle
   séquence cron insère en `processing` direct. Beaucoup de
   producers verront « Prochain virement : 0,00 € » alors qu'un
   virement est en cours.

5. **Pas de granularité sur les notifications email.** Toggle email
   hardcodé true et disabled, alors que la table
   `user_notification_preferences` existe. Anti-pattern (illusion de
   contrôle) + risque RGPD si le producer ne peut pas opt-out
   d'envois précis.

6. **Pas d'UI refund producer.** L'endpoint `/api/stripe/refund` et
   le workflow `pending_refunds` existent côté backend, mais aucune
   action « Rembourser cette commande » dans `OrderDetailClient`.
   Donc impossible pour un producer d'arbitrer un litige client en
   autonomie.

7. **Pas de calendrier visuel sur `/creneaux`.** Liste textuelle de
   règles + ad-hoc + exceptions, sans vue calendrier 14j. Pour des
   producers non-tech, c'est un cliff cognitif important — risque de
   créer des règles incohérentes ou de laisser des slots fantômes.

8. **Aucun onboarding « après le wizard ».** Une fois le producer
   passé `pending`, rien ne lui dit qu'il doit (a) connecter Stripe,
   (b) créer des produits, (c) définir des créneaux pour être
   réservable. Pas de checklist progressive sur `/dashboard`.

9. **Counts des tabs `/commandes` basés sur les 100 premières
   commandes.** Pour un producer avec > 100 commandes archivées,
   les onglets affichent des nombres faux. Risque de manquer une
   commande pending qui serait sortie de la première page.

10. **Mojibake (caractères corrompus) dans `commandes/[id]/page.tsx`**
    (lignes 18, 23, 56, 85-86). Affiché en clair au producer en cas
    de date legacy ou champ vide. Salissure visible mais facile à
    corriger.

## 3.2 Top 5 dettes architecturales à payer

1. **Deux écoles de fetch DB** (server admin client + ownership check
   manuel vs client browser + RLS). Choix non documenté et
   inconsistant entre pages. À trancher en convention (probablement :
   client RLS sauf si on a besoin de bypass précis).

2. **Composants colocalisés `_components/` vs `components/producer/`
   quasi vide.** Le dossier `components/producer/` n'est pas exploité
   comme convention, alors que plusieurs `_components/` colocalisés
   pourraient être promus (modals créneaux, par exemple, sont
   spécifiques producer mais réutilisables si l'admin doit éditer
   les créneaux d'un producer).

3. **Deux UIs de pickup validation** (`PickupValidationCard` sur
   `/commandes` + form inline dans `OrderDetailClient`). Endpoints
   différents (`/api/producer/orders/validate-pickup` vs
   `/api/orders/[id]/complete`). À réconcilier sur une seule UI +
   un seul endpoint.

4. **Pages volumineuses non splittées.** `ma-page/page.tsx` 497
   lignes, `catalogue/[id]/modifier/page.tsx` 567 lignes,
   `creneaux/actions.ts` 635 lignes. Faciles à splitter, gain de
   testabilité et lisibilité.

5. **Types DB redéclarés à la main au lieu d'importer le codegen.**
   Cassure de la source unique de vérité — toute modif de schéma
   force une chasse manuelle des shapes. Et `OrderStatus` importé
   depuis `@/components/ui` (couplage UI ← types DB inversé).

## 3.3 Quick wins (< 1h chacun)

1. **Supprimer le commentaire obsolète** dans
   `app/(producer)/connect/done/page.tsx:10-11` (dit que
   `account.updated` n'est pas implémenté alors qu'il l'est).

2. **Créer `app/(producer)/revenus/[id]/page.tsx`** ou supprimer le
   lien « Détail → » sur `/revenus`. Au minimum, retirer le lien
   tant que la page n'existe pas.

3. **Corriger le mojibake** dans
   `app/(producer)/commandes/[id]/page.tsx` lignes 18, 23, 56,
   85-86. Remplacer `â€”` par `—` et `Ã ` par `à`.

4. **Ajouter un lien « Se déconnecter »** explicite dans le footer
   de la sidebar `ProducerLayout.tsx`. Aujourd'hui il faut passer
   par le RoleSwitcher.

5. **Étendre le `nextPending` de `/revenus`** pour inclure
   `processing` (et pas seulement `pending`) afin que le hero
   reflète la réalité depuis le nouveau cycle cron.

6. **Activer le toggle email** dans `/parametres` ou afficher
   explicitement « Notifications email gérées dans /compte/notifications »
   pour ne pas mentir au producer.

7. **Compter par tab via une query agrégée** sur `/commandes`
   (`SELECT statut, count(*) FROM orders WHERE producer_id=X GROUP BY statut`)
   au lieu de dériver des 100 premières rows.

8. **Ajouter un test unitaire** sur `mapStatusToBadge` couvrant les
   4 statuts payout (déjà fait pour 3 ?) — confirmer à la lecture.

9. **Ajouter un empty state guidé** sur `/dashboard` quand
   `pending_orders.length === 0 && week_orders.length === 0` :
   « Vous n'avez pas encore reçu de commande. Vérifiez que (a) votre
   Stripe est connecté, (b) vous avez au moins un produit actif,
   (c) vos créneaux sont définis. »

10. **Renommer le bouton SMS** dans `/parametres` qui dit
    « Alertes urgentes (nouvelle commande, retrait du jour) » pour
    refléter exactement les triggers SMS (cf. `lib/twilio/sms.ts`
    templates `sms_reminder_consumer`, `sms_new_order_producer`).

---

## Annexes

### Audit hors scope mais utile pour le tech lead

- `lib/orders/stateMachine.ts` (canProducerCancel utilisé dans
  `OrderDetailClient`) : non lu intégralement. Probablement vérifier
  cohérence avec les RPCs `confirm_order_by_producer` /
  `complete_pickup_by_producer`.
- `/api/exports/producer/comptabilite.csv` : non vérifié si le
  fichier route existe au chemin exact. Lien depuis
  `comptabilite/page.tsx` est `/api/exports/producer/comptabilite.csv`,
  à confirmer.
- `lib/notifications/preferences.ts` et
  `user_notification_preferences` : la table existe avec 0 row, les
  defaults virtuels sont gérés côté lib. UI producer absente.
- `lib/stripe/payouts.tsx` : cron weekly-payout, source du
  `payout_summary` email — non lu intégralement.
- `app/(producer)/onboarding/page.tsx` réutilise `OnboardingWizard`
  de `(public)/invitation/_components/` — bonne réutilisation,
  vérifier si l'expérience de reprise (startStep=2) est cohérente
  pour un producer qui revient des semaines après son invitation
  initiale.

### Fichiers lus intégralement pour cet audit

- `app/(producer)/layout.tsx`, `loading.tsx`, `error.tsx`,
  `_components/ProducerLayout.tsx`
- `dashboard/page.tsx`, `dashboard/DashboardClient.tsx`
- `commandes/page.tsx`, `commandes/ProducerCommandesClient.tsx`,
  `commandes/_components/PickupValidationCard.tsx`,
  `commandes/[id]/page.tsx`, `commandes/[id]/OrderDetailClient.tsx`
- `catalogue/page.tsx`, `catalogue/CatalogueClient.tsx`,
  `catalogue/nouveau/page.tsx`, `catalogue/[id]/modifier/page.tsx`
- `creneaux/page.tsx`, `creneaux/actions.ts`
- `ma-page/page.tsx`, `ma-page/_components/IndicateursSection.tsx`
- `mes-avis/page.tsx`, `mes-avis/AvisClient.tsx`
- `revenus/page.tsx`, `revenus/_lib/badge-mapping.ts`
- `comptabilite/page.tsx`
- `parametres/page.tsx`
- `connect/done/page.tsx`, `connect/refresh/page.tsx`
- `onboarding/page.tsx`
- `alertes-stock/page.tsx`
- `app/api/stripe/connect/onboard/route.ts`
- `lib/stripe/sync-account-flags.tsx`
- `components/producer/ScoreCarbonIndicators.tsx`,
  `ScoreCarbonPreview.tsx`

### Fichiers non lus mais inventoriés

- Tous les sous-composants `_components/` de `creneaux/` (8
  fichiers : `SlotRulesList`, `AdHocSlotsList`, `ExceptionsList`,
  `SlotRuleModal`, `AdHocSlotModal`, `ExcludeSlotModal`,
  `BulkExcludeRangeModal`, et leurs `*Lazy.tsx`).
- Routes API détail : `/api/orders/[id]/{confirm,cancel,complete}`,
  `/api/producer/products/[id]`, `/api/producer/reviews/[id]/respond`,
  `/api/exports/producer/comptabilite.csv`.
- Tous les templates Resend producer-facing.
- Cron `/api/cron/weekly-payout/route.tsx`.

Si tu veux qu'on plonge spécifiquement dans un de ces fichiers, dis-le
et je l'audite en suite.
