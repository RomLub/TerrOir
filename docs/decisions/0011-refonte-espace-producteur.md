# ADR-0011 — Refonte de l'espace producteur sur l'ossature de l'admin (identité chaude conservée)

- **Statut** : Accepted
- **Date** : 2026-05-24
- **Décideurs** : Romain (arbitrages périmètre + identité visuelle) + CC (audit + proposition)

## Contexte

L'espace admin a été reconstruit récemment sur une ossature propre et
réutilisable : une coquille unique (`app/(admin)/layout.tsx` → `AdminHeader`
+ `AdminSidebar` à navigation déclarative groupée + zone de contenu), des
primitives partagées dans `components/ui/` (`AdminPageHeader`, `MetricCard`,
`FilterTabs`, `TableStatus`, `TableActionButton`, `AdminModal`,
`StatusDotBadge`), un data-fetching serveur-first et une composition de page
constante (entête → filtres → contenu).

L'espace producteur, lui, est **fonctionnellement complet** (≈13 écrans :
dashboard, commandes, catalogue, créneaux, alertes stock, ma-page, avis,
revenus, comptabilité, paramètres, Stripe Connect, onboarding) mais a été
construit **page par page sans colonne vertébrale commune**. L'audit du
2026-05-24 a relevé trois écarts structurels :

1. **Pas de squelette partagé.** Chaque page réimplémente son entête et sa
   mise en page ; `components/producer/` est vide ; la coquille est rendue par
   un composant client (`ProducerLayout`) wrappé dans chaque page (≈17 sites
   d'appel), au lieu d'être portée par le layout comme l'admin.
2. **Trois conventions d'écriture incohérentes.** Le catalogue
   (`catalogue/nouveau`, `[id]/modifier`, `CatalogueClient`) et la page
   publique (`ma-page`) écrivent **directement depuis le navigateur**
   (`createSupabaseBrowserClient`) ; le stock passe par une route API ; les
   créneaux passent par des **actions serveur**. Les écritures navigateur
   laissent le serveur aveugle : pas de point central pour l'autorisation, la
   validation, l'audit, l'invalidation du cache des pages publiques, les
   notifications.
3. **Navigation à plat de 10 entrées** sans hiérarchie, et tableau de bord
   centré sur des chiffres (vanity metrics) plutôt que sur l'action.

## Décision

### 1. Reconstruire la coquille producteur sur le squelette de l'admin, peau chaude conservée

« Même squelette, peau différente ». On reprend la **structure** de l'admin
(navigation déclarative `NavEntry` avec familles + pastilles, logique
`isActive`, mécanisme de badge serveur, composition de page) et on n'échange
que la **peau** : l'identité chaude/verte du producteur (`green-900`,
`terra-700`, `terra-300`) est conservée, distincte du look clair de l'admin.

- Primitives génériques **réutilisées telles quelles** par le producteur :
  `MetricCard`, `FilterTabs`, `TableStatus`, `TableActionButton`,
  `AdminModal`, `StatusDotBadge`, `ProducerStatusBadge`.
- `AdminPageHeader` **généralisé** en `components/ui/page-header.tsx` avec une
  prop `tone: "admin" | "producer"` (DOM/slots identiques, seule la palette
  change). `admin-page-header.tsx` devient un ré-export `tone="admin"` → zéro
  churn côté admin.
- `AdminSidebar`/`AdminHeader` **dupliqués** en `ProducerSidebar` (peau dark
  green + chrome producteur : RoleSwitcher + bloc identité + lien fiche
  publique). Pas de barre du haut côté producteur (divergence assumée vs
  l'admin : la coquille producteur reste mono-colonne).
- Navigation **groupée en 5 familles** : Accueil / Ventes / Ma boutique /
  Finances / Pilotage, avec **pastilles d'alerte** calculées côté serveur au
  niveau du layout (mirroir de `refundsBadgeCount`) : « commandes à confirmer »
  (`statut = 'pending'`) et « ruptures de stock » (réutilise
  `fetchProducerAlerts`).

### 2. Standardiser toutes les écritures en actions serveur

Le catalogue et `ma-page` basculent de l'écriture navigateur aux **actions
serveur** (`app/(producer)/catalogue/actions.ts`,
`app/(producer)/ma-page/actions.ts`), sur le modèle déjà éprouvé de
`creneaux/actions.ts` : `getSessionUser` → résolution + vérif ownership via
service_role → validation zod → mutation → invalidation cache typée
(`lib/stats/revalidate.ts`) → audit. Les photos remontent côté serveur (les
`File` voyagent dans un `FormData`, upload via le client admin).

**Conséquence sécurité majeure** : en service_role, le trigger
`producers_block_owner_admin_columns` et les policies RLS owner sont
**bypassés**. La frontière d'écriture devient donc le **schéma zod en
liste blanche** (colonnes producer-writable uniquement) + la vérif ownership.
C'est le point de revue n°1 de ce chantier. La RLS reste en défense en
profondeur pour tout résidu de chemin navigateur (qu'on supprime).

### 3. Ajouter trois couches de valeur (inspirées Amazon Seller Central / Shopify)

- **Accueil orienté action** : un bloc « À traiter aujourd'hui » en tête
  (commandes à confirmer, retraits du jour, ruptures, blocages de
  publication), chiffres en dessous. Données ajoutées de façon **additive** au
  RPC `get_producer_dashboard` (compteurs + retraits du jour + ruptures).
- **« Santé de ma boutique »** : un écran consolidant les badges existants
  (`badge_stock_score`, `badge_confirmation_score`, `badge_annulation_score`)
  + la note d'avis, avec seuils (vert/ambre/rouge) et conseils concrets. C'est
  de la **pure présentation** sur des valeurs déjà calculées par le cron
  (`lib/producers/recompute-badges.ts`) — aucun recalcul à la lecture. Seuils
  + conseils centralisés dans `lib/producers/health.ts` (réutilisés par le
  dashboard).
- **Checklist de mise en ligne guidée** : les 6 critères de publication
  rendus en barre de progression, affichée tant que le producteur n'est pas
  `public`. Nécessite un **RPC lecture seule** `get_publication_status`
  (mirroir sans effet de bord de `request_publication` ; pour éviter la
  dérive, extraire un helper SQL `_publication_criteria` partagé par les deux).

## Alternatives écartées

- **Aligner l'identité visuelle du producteur sur le look clair de l'admin** :
  écarté. L'outil vendeur a sa propre ambiance, plus chaleureuse que le
  back-office (pattern Amazon/Shopify) ; c'est sa « boutique ».
- **Ne refaire que l'organisation (nav + accueil) sans toucher à la plomberie
  des écritures** : écarté. Garde la dette du point 2 et laisse le serveur
  aveugle sur la moitié des mutations.
- **Dupliquer les primitives au lieu de généraliser+thémer** : écarté. Le DOM
  des primitives est identique entre admin et producteur ; une prop `tone`
  garde une seule source de vérité pour la structure/spacing.

## Conséquences

- **Séquencement en chantiers** (un chantier = une branche = une PR) :
  (1) socle (coquille + nav + `PageHeader` thémé + helper badges, changement
  purement structurel, zéro régression de feature) → (2) refonte créneaux
  (cf. [ADR-0012](0012-refonte-creneaux-retrait.md), prioritaire) →
  (3) plomberie (écritures serveur catalogue + ma-page) → (4) accueil + santé
  + checklist.
- **Point de vigilance socle** : ne jamais livrer un état où le layout rend la
  coquille ET les pages wrappent encore `ProducerLayout` (double sidebar) —
  bascule layout + retrait des wrappers dans la même PR.
- **Migrations** des couches de valeur **additives** (clés JSONB en plus sur
  `get_producer_dashboard`, nouveau RPC `get_publication_status`) → appliquables
  avant merge (dormantes) ; ne pas changer la signature/forme de retour
  existante (cf. incident chantier 2).
- **Dette assumée** : suppression d'objets Storage orphelins à la suppression
  de photo non traitée (comportement actuel préservé : on retire l'URL du
  tableau, l'objet reste). À traiter au besoin.
- Limite Next 16 à vérifier : `serverActions.bodySizeLimit` pour l'upload
  multi-photos (5×5 Mo) dans les actions serveur.

## Liens

- [ADR-0012 — Refonte UX des créneaux de retrait](0012-refonte-creneaux-retrait.md)
- [ADR-0005 — Pattern admin data access](0005-pattern-admin-data-access.md)
- Modèle à répliquer : `app/(producer)/creneaux/actions.ts` (actions serveur),
  `app/(admin)/_components/AdminSidebar.tsx` (nav déclarative + badges),
  `lib/admin/refunds/fetch.ts` (badge serveur), `lib/stats/revalidate.ts`
  (invalidation cache).
