# Audit RLS table `public.producers` — 2026-05-06 (T-218)

**Source live** : MCP Supabase `read-write` sur prod (Postgres 17.6).
**Périmètre** : `public.producers` uniquement (5 policies + 42 colonnes).
**Contexte** : audit complémentaire de l'audit RLS global du 2026-05-05
(`docs/audits/audit-rls-2026-05-05.md`), focalisé sur la **projection de
colonnes** par policy après cumul des migrations T-200 (3 enums score
carbone), T-241 (3 colonnes déclaration véracité), T-292 (3 flags Stripe
Connect), T-417 (3 scores badges) et T-413 (cleanup_pending).

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
| 9 | latitude | double | privacy | service_role (geocode) |
| 10 | longitude | double | privacy | service_role (geocode) |
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
  21 colonnes admin-only / immuables / onboarding-only est modifiée.

**Pourquoi un trigger plutôt qu'une policy WITH CHECK** : Postgres ne donne
pas accès à OLD dans une policy WITH CHECK (qui évalue NEW seulement). Le
pattern column-level GRANT (REVOKE puis GRANT UPDATE (col1, …)) marcherait
mais devrait être maintenu en parallèle de chaque ajout de colonne au schema
(forte dette). Le trigger centralise la liste des colonnes admin-only dans
**un fichier unique**, lisible en revue.

⚠️ **Migration NON appliquée par CC** — Romain l'applique manuellement via
Supabase Studio (cf. `docs/METHODOLOGY.md`). Le code applicatif fonctionne
identique avant/après l'apply (defense-in-depth pure, pas de changement de
contrat fonctionnel).

---

## Backlog

- **T-235** : vue `public.producers_public` projetée (colonnes publiques
  uniquement) + REVOKE SELECT sur table directe pour `anon`/`authenticated`
  non-owner. Ferme le finding A. Hors-scope T-218.
- **Doctrine** : à chaque ajout de colonne sur `producers`, **arbitrer son
  niveau de sensibilité** (public read OK ? owner write OK ?) puis ajuster
  le trigger `producers_block_owner_admin_columns()` si admin-only. Lister
  cette doctrine dans `docs/METHODOLOGY.md` (chantier suivant).
- **À confirmer** : si T-218 est appliqué et qu'une feature future doit
  laisser un owner write `latitude`/`longitude` (édition manuelle des coords
  par exemple), ces colonnes ne sont **pas** dans le trigger T-218. Idem
  `adresse` qui reste owner-writable. Attention aux ajouts.

---

## Conformité auditeurs

L'audit RLS du 2026-05-05 listait `producers` comme « public+owner+admin /
owner / owner+admin / admin (via for all) » sans creuser la projection.
T-218 complète :

- Findings A et B identifiés ci-dessus.
- A → backlog T-235.
- B → migration livrée 20260506200000_t218_*.

L'audit reste cohérent : pas de FORCE RLS sur producers (pas de secrets,
align doctrine 2026-05-05).
