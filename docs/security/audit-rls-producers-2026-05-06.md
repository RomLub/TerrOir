# Audit RLS table `public.producers` — 2026-05-06 (T-218 + T-218-bis)

**Source live** : MCP Supabase `read-write` sur prod (Postgres 17.6).
**Périmètre** : `public.producers` uniquement (5 policies + 43 colonnes).
**Contexte** : audit complémentaire de l'audit RLS global du 2026-05-05
(`docs/audits/audit-rls-2026-05-05.md`), focalisé sur la **projection de
colonnes** par policy après cumul des migrations T-200 (3 enums score
carbone), T-241 (3 colonnes déclaration véracité), T-292 (3 flags Stripe
Connect), T-417 (3 scores badges) et T-413 (cleanup_pending).

**Trigger T-218 / T-218-bis applied** : 25 colonnes admin-only / immuables
/ onboarding-only / privacy bloquées en self-update authenticated owner.
Voir sections [Trigger T-218](#b-policy-owner-update-autorise-self-update-sur-colonnes-admin-only)
et [T-218-bis](#t-218-bis-2026-05-06--ajout-latitudelongitude) ci-dessous.

---

## Snapshot policies (au 2026-05-06)

```
producers admin all                   FOR ALL    TO authenticated
  using ((select is_admin()))
  with check ((select is_admin()))

producers owner insert                FOR INSERT TO authenticated
  with check ((select auth.uid()) = user_id)

producers owner read                  FOR SELECT TO authenticated
  using ((select auth.uid()) = user_id)

producers owner update                FOR UPDATE TO authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id)

producers public read when public     FOR SELECT TO public
  using (statut = 'public')
```

`rowsecurity = true`, `forcerowsecurity = false` (cohérent avec la doctrine
de l'audit 2026-05-05 — producers contient des données catalogue, pas de
secrets).

---

## Snapshot colonnes (42 colonnes au 2026-05-06)

| # | Colonne | Type | Sensibilité | Write attendu |
|---|---------|------|-------------|---------------|
| 1 | id | uuid | — | auto |
| 2 | user_id | uuid | immuable | service_role (création) |
| 3 | slug | text | quasi-immuable | service_role |
| 4 | nom_exploitation | text | public | owner (parametres, ma-page) |
| 5 | siret | text | public | owner (parametres) |
| 6 | adresse | text | privacy | owner (parametres) |
| 7 | commune | text | public | owner |
| 8 | code_postal | text | public | owner |
| 9 | latitude | double | **admin-only (T-218-bis, privacy T-217)** | service_role (geocode) |
| 10 | longitude | double | **admin-only (T-218-bis, privacy T-217)** | service_role (geocode) |
| 11 | description | text | public | owner |
| 12 | histoire | text | public | owner |
| 13 | photo_principale | text | public | owner |
| 14 | photos | text[] | public | owner |
| 15 | annee_creation | int | public | owner |
| 16 | generations | int | public | owner |
| 17 | especes | text[] | public | owner |
| 18 | labels | text[] | public | owner |
| 19 | statut | text | **admin-only** | admin / promote-to-public |
| 20 | abonnement_niveau | text | **admin-only** | webhook Stripe |
| 21 | abonnement_expire_at | timestamptz | **admin-only** | webhook Stripe |
| 22 | stripe_account_id | text | **admin-only** | onboard route |
| 23 | badge_stock_score | double | **admin-only** | recompute-badges |
| 24 | badge_confirmation_score | double | **admin-only** | recompute-badges |
| 25 | badge_annulation_score | double | **admin-only** | recompute-badges |
| 26 | created_at | timestamptz | auto | default `now()` |
| 27 | note_moyenne | double | **admin-only** | trigger reviews |
| 28 | nb_avis | int | **admin-only** | trigger reviews |
| 29 | forme_juridique | text | onboarding-only | service_role |
| 30 | type_production | text | onboarding-only | service_role |
| 31 | type_production_precision | text | onboarding-only | service_role |
| 32 | deleted_at | timestamptz | **admin-only** | RPC delete_user_account |
| 33 | stripe_cleanup_pending | bool | **admin-only** | webhook Stripe |
| 34 | prenom_affichage | text | onboarding-only | service_role |
| 35 | stripe_charges_enabled | bool | **admin-only** | webhook Stripe |
| 36 | stripe_payouts_enabled | bool | **admin-only** | webhook Stripe |
| 37 | stripe_details_submitted | bool | **admin-only** | webhook Stripe |
| 38 | mode_elevage | text | public (T-200) | owner (ma-page) |
| 39 | alimentation | text | public (T-200) | owner (ma-page) |
| 40 | densite_animale | text | public (T-200) | owner (ma-page) |
| 41 | declaration_indicateurs_veracite_at | timestamptz | **probatoire DGCCRF** | RPC service_role |
| 42 | declaration_indicateurs_snapshot | jsonb | **probatoire DGCCRF** | RPC service_role |
| 43 | declaration_indicateurs_wording_version | text | **probatoire DGCCRF** | RPC service_role |

---

## Findings

### A — Policy `public read when public` projette **toutes** les colonnes

`FOR SELECT TO public USING (statut = 'public')` retourne `SELECT *` sans
restriction de colonnes. Conséquence : un visiteur anonyme peut lister via
PostgREST `/rest/v1/producers?select=*&statut=eq.public` et exfiltrer :

- `stripe_account_id` — identifiant Stripe Connect du producteur (sensible :
  permet à un attaquant de croiser avec son propre Stripe Dashboard si compte
  partagé, ou de cibler des attaques Stripe).
- `stripe_charges_enabled` / `stripe_payouts_enabled` / `stripe_details_submitted`
  / `stripe_cleanup_pending` — état interne Stripe Connect.
- `abonnement_niveau` / `abonnement_expire_at` — état d'abonnement business.
- `badge_stock_score` / `badge_confirmation_score` / `badge_annulation_score`
  — scores ops internes (potentiellement publiables une fois mûrs, mais à
  arbitrer produit).
- `declaration_indicateurs_veracite_at` / `_snapshot` / `_wording_version` —
  données probatoires DGCCRF, pas destinées à un affichage public direct.
- `latitude` / `longitude` — coordonnées précises (cf. policy privacy
  T-217 — coordonnées tronquées côté UI publique, mais la table expose la
  précision).
- `adresse` — adresse complète (privacy à arbitrer).
- `deleted_at` / `user_id` / `created_at` — métadonnées internes.

**Verdict** : exposition trop large. Pas exploitable comme « fuite de
données privées strictes » (ces colonnes ne contiennent pas de PII sensibles
type RIB, mot de passe, OTP), mais c'est un finding **MEDIUM** au sens de
defense-in-depth + minimisation données.

**Décision** : NON corrigé dans T-218. Renvoyé au backlog **T-235** (vue
`producers_public` projetée + REVOKE SELECT sur la table directe pour role
`anon`/`authenticated` non-owner). T-235 est un chantier dédié plus
substantiel — ne pas le mélanger ici.

---

### B — Policy `owner update` autorise self-update sur colonnes admin-only

`FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK
(auth.uid() = user_id)` : seule contrainte = être l'owner de la row. Aucune
restriction sur les colonnes modifiables. Un producteur authentifié peut
forger une requête PostgREST :

```
PATCH /rest/v1/producers?id=eq.<son_id>
{
  "statut": "public",
  "abonnement_niveau": "premium",
  "abonnement_expire_at": "2099-12-31",
  "badge_stock_score": 100,
  "badge_confirmation_score": 100,
  "badge_annulation_score": 100,
  "declaration_indicateurs_veracite_at": null,
  "user_id": "<other_user>",
  "slug": "<concurrent_slug>"
}
```

Et passer en `public` sans validation admin, manipuler son score badge, son
abonnement, ou pire — **réécrire son `declaration_indicateurs_*`**
(probatoire DGCCRF, doit rester immuable post-onboarding).

**Verdict** : trou réel. Sévérité **HIGH** (compromise probatoire DGCCRF +
contournement validation admin pour `statut`). Non exploité à ce jour
(audit logs vierges, à confirmer), mais l'absence de garde-fou est
problématique.

**Audit applicatif des call sites `from('producers').update`** :

| Call site | Client | Colonnes write | Verdict |
|-----------|--------|----------------|---------|
| `app/(producer)/parametres/page.tsx:117` | browser owner | nom_exploitation, adresse, commune, code_postal, siret | safe |
| `app/(producer)/ma-page/page.tsx:240` | browser owner | nom_exploitation, description, histoire, generations, annee_creation, especes, labels, commune, code_postal, photo_principale, photos, mode_elevage, alimentation, densite_animale | safe |
| `app/(admin)/gestion-producteurs/page.tsx:262` | browser admin (`is_admin()` policy) | statut | OK admin |
| `lib/producers/promote-to-public.ts:62` | service_role (caller `/api/stripe/create-payment-intent`) | statut | OK service_role |
| `lib/producers/recompute-badges.ts` | service_role | badge_*_score | OK service_role |
| `lib/stripe/sync-account-flags.ts` | service_role (webhook) | stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted | OK service_role |
| `lib/stripe/handle-account-deauthorized.tsx` | service_role (webhook) | stripe_account_id, stripe_*_enabled, stripe_cleanup_pending | OK service_role |
| `app/api/stripe/connect/onboard/route.ts` | service_role | stripe_account_id | OK service_role |
| `app/api/orders/[id]/cancel/route.tsx` | service_role | (badge recompute via helper) | OK service_role |
| `app/api/orders/[id]/confirm/route.tsx` | service_role | idem | OK service_role |
| `app/api/admin/reviews/[id]/moderate/route.ts` | service_role (admin route) | trigger note_moyenne / nb_avis | OK service_role |
| `app/(consumer)/compte/profil/delete-account-action.ts` | RPC `delete_user_account` (service_role) | deleted_at | OK service_role |
| `scripts/seed-producers.ts`, `scripts/seed.ts` | admin client (CLI) | * | OK service_role |
| `app/(producer)/invitation/_actions/complete-onboarding.ts` | service_role + RPC `update_producer_onboarding` | prenom_affichage, forme_juridique, type_production*, declaration_*, mode_elevage, alimentation, densite_animale | OK service_role |

**Conclusion audit applicatif** : tous les writes sur les colonnes
admin-only passent par service_role ou un client browser admin (is_admin()
policy). Aucun flow légitime ne write ces colonnes via l'API authenticated
owner. → bloquer les colonnes admin-only côté authenticated owner n'a
**aucun impact runtime** sur les flows actuels.

**Décision** : migration livrée
`supabase/migrations/20260506200000_t218_producers_owner_update_block_admin_columns.sql`
qui pose un trigger `BEFORE UPDATE` :
- bypass `service_role` (`auth.role() = 'service_role'`) — webhooks, RPC, scripts
- bypass admins authenticated (`is_admin()`) — gestion-producteurs page
- sinon `RAISE EXCEPTION ERRCODE 42501` (insufficient_privilege) si une des
  **25** colonnes admin-only / immuables / onboarding-only / privacy est
  modifiée (23 initiales T-218 + 2 ajoutées T-218-bis pour lat/lng).

**Pourquoi un trigger plutôt qu'une policy WITH CHECK** : Postgres ne donne
pas accès à OLD dans une policy WITH CHECK (qui évalue NEW seulement). Le
pattern column-level GRANT (REVOKE puis GRANT UPDATE (col1, …)) marcherait
mais devrait être maintenu en parallèle de chaque ajout de colonne au schema
(forte dette). Le trigger centralise la liste des colonnes admin-only dans
**un fichier unique**, lisible en revue.

**Statut apply** : appliquée en prod via MCP Supabase le 2026-05-06
(timestamp DB `20260506165934`). Tests de fumée OK : 5 colonnes admin-only
testées (statut, declaration_indicateurs_snapshot, abonnement_niveau,
badge_stock_score, slug) → ERROR 42501 levée. 2 colonnes owner-allowed
testées (description, photos) → UPDATE OK. Bypass service_role + is_admin()
testés → OK.

---

## T-218-bis (2026-05-06) — ajout latitude/longitude

### Contexte risque privacy

Post-apply T-218, latitude / longitude restaient owner-writable côté policy
RLS. Un producteur malveillant pouvait PATCH direct via PostgREST
`/rest/v1/producers?id=eq.<id>` avec body `{"latitude": 99.999, "longitude":
-99.999}` pour fausser sa position géographique. Conséquences :

- **Biaiser le `DistanceWidget` consumer** — le widget calcule la distance
  client → ferme à partir de `producers.{latitude,longitude}` (cf. T-219
  cache `/api/geocode`). Une coord trafiquée fausse le tri "près de chez
  moi" et la carte interactive `/carte`.
- **Concurrence déloyale** — apparaître dans une zone qui n'est pas la
  sienne (Sarthe Sud alors qu'on est en Mayenne par exemple).
- **Manipulation des résultats** `/producteurs?proche=...` (rayon de
  recherche).
- **Incohérence avec adresse / commune / code_postal** (qui restent
  owner-writable mais publics, donc plus difficile à fausser sans
  incohérence visible côté UI).

### Décision

**Protection trigger admin-only** : étendre la liste protégée du trigger
`producers_block_owner_admin_columns()` pour inclure `latitude` et
`longitude`. Les coords doivent être définies UNIQUEMENT par :

1. Géocodage de l'adresse à l'onboarding (write `service-role` via
   `/api/geocode` cache + persist sur `producers.latitude/longitude`).
2. RPC dédiée admin si correction manuelle nécessaire (déménagement
   producteur, géocodage initial faux). Pas de RPC à ce jour.

### Implémentation

`CREATE OR REPLACE FUNCTION` du trigger existant (pattern doctrine T-297
idempotence migrations — pas de DROP + CREATE qui invaliderait
temporairement le garde-fou). Le trigger lui-même reste tel quel (binding
pg_trigger → pg_proc préservé après OR REPLACE).

Total liste protégée : **23 → 25 colonnes**.

Migration : `supabase/migrations/<timestamp>_t218_bis_lat_lng_admin_only.sql`.

### Point d'attention futur

Si une feature future doit laisser un owner ou un admin **corriger
manuellement** lat/lng (via UI gestion-producteurs ou wizard), prévoir :

- Soit une RPC `update_producer_coords(p_producer_id, p_latitude,
  p_longitude)` `SECURITY DEFINER` avec garde `is_admin()` interne, appelée
  via `service_role`. Pattern aligné avec `update_producer_onboarding`
  (T-241).
- Soit un re-déclenchement du géocodage côté `/api/geocode` qui invalide le
  cache et recalcule depuis l'adresse mise à jour. Plus propre car
  préserve la cohérence adresse ↔ coords.

Pas urgent — ouvrir un T-XXX backlog si le besoin émerge en prod.

---

## Defense-in-depth FORCE RLS observée (post-apply T-218)

**Constat** : pendant les tests de fumée T-218 via MCP Supabase, un UPDATE
sur colonne admin-only depuis le contexte par défaut (superuser `postgres`,
pas de `set role`, pas de JWT claim) **est bloqué par le trigger** —
exactement comme un authenticated owner non-admin.

```sql
-- MCP par défaut : current_user = postgres, auth.role() = NULL
update public.producers set statut = 'public' where id = '...';
-- ERROR: 42501: producers.statut is admin-only (T-218)
```

### Pourquoi

Le code de la fonction trigger filtre le bypass via :

```sql
if (select auth.role()) = 'service_role' then return new; end if;
if (select public.is_admin()) then return new; end if;
```

- `auth.role()` lit `request.jwt.claims->>role`. Sans JWT context (cas
  SQL Editor / MCP brut), retourne `NULL` ≠ `'service_role'`. Pas de bypass.
- `public.is_admin()` interroge `EXISTS (SELECT 1 FROM admin_users WHERE id
  = auth.uid())`. `auth.uid()` retourne NULL → `EXISTS` est false. Pas
  de bypass.

Conséquence : le superuser `postgres` direct doit **explicitement** :

```sql
begin;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.producers set statut = 'public' where id = '...';
commit;
```

### Conséquence pratique pour Romain

Tout UPDATE admin manuel via Supabase Studio SQL Editor (ou MCP en
contexte par défaut) sur une des 25 colonnes admin-only **nécessite
explicitement** :
- `set local role service_role;` (donne le rôle Postgres)
- `select set_config('request.jwt.claims', '{"role":"service_role"}', true);`
  (donne le contexte JWT lu par `auth.role()`)

Sinon le trigger bloque (cohérent avec la doctrine FORCE RLS de la
migration `audit_rls_lot_7` du 2026-05-05). Documenté dans
`METHODOLOGY.md` section "Apply migrations Supabase Studio" si besoin.

### Bénéfice

Un admin humain qui oublie le `SET ROLE` ne casse pas accidentellement les
invariants admin-only. Ceinture + bretelles vs erreurs humaines au SQL
Editor.

⚠️ Pour les flows applicatifs réels (Next.js → PostgREST → Postgres), le
bypass fonctionne nativement : le client `createSupabaseAdminClient()`
s'authentifie via le service_role JWT, PostgREST set `role = service_role`
+ `request.jwt.claims->>role = 'service_role'`, le trigger bypass. Vérifié
en tests de fumée T-218.

---

## Backlog

- **T-235** : vue `public.producers_public` projetée (colonnes publiques
  uniquement) + REVOKE SELECT sur table directe pour `anon`/`authenticated`
  non-owner. Ferme le finding A. Hors-scope T-218.
- **Doctrine** : à chaque ajout de colonne sur `producers`, **arbitrer son
  niveau de sensibilité** (public read OK ? owner write OK ?) puis ajuster
  le trigger `producers_block_owner_admin_columns()` si admin-only. Lister
  cette doctrine dans `docs/METHODOLOGY.md` (chantier suivant).
- **`adresse`** reste owner-writable (privacy à arbitrer plus tard si
  l'adresse complète apparaît en public read — cf. finding A backlog
  T-235). lat/lng désormais protégées via T-218-bis.

---

## Conformité auditeurs

L'audit RLS du 2026-05-05 listait `producers` comme « public+owner+admin /
owner / owner+admin / admin (via for all) » sans creuser la projection.
T-218 complète :

- Findings A et B identifiés ci-dessus.
- A → backlog T-235.
- B → migration T-218 appliquée en prod (timestamp DB `20260506165934`).
- B-bis → migration T-218-bis appliquée en prod (lat/lng).

L'audit reste cohérent : pas de FORCE RLS sur producers (pas de secrets,
align doctrine 2026-05-05). Defense-in-depth FORCE RLS effective via le
trigger T-218 / T-218-bis qui bloque les UPDATE depuis le contexte
superuser `postgres` brut (cf. section dédiée ci-dessus).
