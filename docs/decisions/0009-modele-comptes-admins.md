# ADR-0009 — Modèle des comptes administrateurs : niveaux de privilège, suspension, et move atomique entre admin_users et users

- **Statut** : Accepted
- **Date** : 2026-05-23
- **Décideurs** : Romain (validation du plan + review code avant merge)

## Contexte

Avant le chantier 6, un admin = une simple ligne dans la liste blanche
`admin_users`, sans nuance : pas de niveaux de privilège, pas de suspension,
pas d'outillage de gestion (création/retrait depuis l'UI). La doctrine
d'isolation (trigger `enforce_user_exclusive`) impose qu'un même
`auth.users.id` soit présent **soit** dans `public.users` (client/producteur),
**soit** dans `public.admin_users` (admin), **jamais les deux** — séparation
de l'identité admin et de l'identité client (cookies isolés, snapshot de rôle).

Le chantier 6 ajoute la gestion du cycle de vie des comptes admins. Trois
décisions structurantes en découlent.

## Décision

### 1. Deux niveaux de privilège (`admin_privilege` enum)

- `super_admin` : peut gérer les autres admins (créer, suspendre, réactiver,
  changer le niveau, retirer).
- `standard` : accès opérationnel complet (producteurs, remboursements,
  commandes, etc.) mais **aucune action sur les comptes admins** (lecture
  seule de la page Administrateurs).

Bootstrap : tous les admins existants (fondateurs) → `super_admin`.

### 2. Suspension via `suspended_at` (pas seulement retrait)

`isAdmin` devient « présent dans admin_users **ET** `suspended_at IS NULL` ».
Dérivé en live aux 4 points (`getSessionUser`, `isAdmin()`,
`getInitialUserPayload`, middleware). La suspension étant un UPDATE, le trigger
de révocation du snapshot de rôle est étendu à `UPDATE OF suspended_at` —
sinon un admin suspendu garderait l'accès via le snapshot caché jusqu'à
expiration. `isSuperAdmin` est **toujours** lu en live (jamais caché), donc un
changement de niveau prend effet immédiatement.

### 3. Promotion / retrait = MOVE atomique entre tables (RPC SECURITY DEFINER)

Du fait de l'exclusivité mutuelle :

- **Promouvoir** un client en admin = `DELETE public.users` + `INSERT
  admin_users` (même `auth.users.id`, identité de connexion préservée).
- **Retirer** un admin = `DELETE admin_users` + `INSERT public.users`
  (`roles = ['consumer']`), le compte client reste actif.

Ces deux opérations doivent être **atomiques** (une seule transaction) car
l'exclusivité interdit la coexistence transitoire — d'où des **RPC
SECURITY DEFINER** (`admin_promote_user`, `admin_revoke`, `admin_suspend`,
`admin_reactivate`, `admin_set_privilege`) plutôt qu'une orchestration côté
route (chaque appel PostgREST = sa propre transaction). Les RPC re-vérifient
l'acteur (défense en profondeur) et embarquent les gardes métier.

### Gardes (sécurité)

- Un admin ne peut pas s'appliquer suspend / retrait / rétrogradation à
  lui-même (anti-auto-exclusion) — garde RPC **et** boutons désactivés côté UI.
- Le **dernier super_admin actif** ne peut jamais être suspendu, retiré, ni
  rétrogradé (anti-blocage total).
- Toutes les actions admins (promote/suspend/reactivate/revoke/privilege) sont
  tracées dans `audit_logs` (cluster `admin_accounts`).

### Mur FK à la promotion (conséquence assumée)

Les FK `orders/reviews/producers → users(id)` sont `NO ACTION` : un compte
client **ayant déjà une activité** (commandes, avis, fiche producteur) ne peut
pas être déplacé (le `DELETE users` est bloqué). La RPC le détecte et refuse
avec `has_client_activity`. **Conséquence** : la promotion ne fonctionne que
pour un compte client « propre » (fraîchement inscrit). Pour le MVP c'est
acceptable : les comptes admins sont des adresses dédiées à l'administration.
Vérifié en prod au moment de la décision : 10/12 comptes sont double-rôle
producteur+client, donc avec activité — la grande majorité ne serait pas
promouvable, ce qui confirme la doctrine « adresse admin dédiée ».

## Alternatives écartées

- **Abandonner l'exclusivité** (admin = client + flag admin) : éviterait le
  move atomique et le mur FK, mais casserait l'isolation identité admin/client
  (cookies, snapshot) — changement d'architecture lourd, hors périmètre, et
  affaiblissement de la séparation de sécurité. Écarté.
- **Bandeau « mettez à jour votre mot de passe » à la première connexion d'un
  promu** : nécessite un flag + détection first-login + UI dans /compte. Trop
  coûteux pour le MVP → remplacé par une **mention dans l'email de promotion**
  (décision validée avec Romain, point 4 de la spec chantier 6).

## Conséquences

- Le `/users` LIST est supprimé (consumers → « Comptes consommateurs » du
  chantier 5, admins → « Administrateurs »). Le **détail partagé `/users/[id]`**
  subsiste (réutilisé par Comptes consommateurs).
- 5 emails de notification (template paramétré `admin-lifecycle`) informent la
  personne concernée à chaque opération.
- Migration `20260523140000_admin_privilege_suspension.sql` appliquée +
  smoke-testée en prod (gardes + move promote/revoke validés en transaction
  rollback).
