# Audit RLS `declaration_indicateurs_*` — 2026-05-06 (T-287)

**Source live** : MCP Supabase `read-write` sur prod (Postgres 17.6).
**Périmètre** : permissions de lecture/écriture sur les 3 colonnes
DGCCRF `public.producers.declaration_indicateurs_*` :
- `declaration_indicateurs_veracite_at` (timestamp coche/re-coche)
- `declaration_indicateurs_snapshot` (JSON snapshot des 3 enums)
- `declaration_indicateurs_wording_version` (version libellé certifié)

**Pourquoi cet audit** : ces 3 colonnes archivent l'engagement
probatoire DGCCRF du producteur. Si un producteur authentifié peut
écrire directement (PostgREST/Supabase JS) sur ces colonnes, il peut
forger son `_veracite_at` (antidater la déclaration), modifier le
`_snapshot` (mentir sur ce qui a été coché) ou bumper le
`_wording_version` (faire croire qu'il a vu le wording v1.1 alors
qu'il a vu v1.0). La trace perd toute valeur probante.

---

## Constatations

### Trigger `producers_block_owner_admin_columns` (T-218)

Le trigger BEFORE UPDATE (`producers_block_owner_admin_columns`,
SECURITY DEFINER, `search_path = public, pg_temp`) bypass autorisé
uniquement si :
- `auth.role() = 'service_role'`, OU
- `public.is_admin()` retourne `true`.

Pour tout autre caller, il lève `42501` dès qu'une des colonnes admin-only
est modifiée. La fonction trigger inclut explicitement les 3 colonnes
DGCCRF :

```sql
if new.declaration_indicateurs_veracite_at is distinct from old.declaration_indicateurs_veracite_at then
  raise exception 'producers.declaration_indicateurs_veracite_at is admin-only (T-218)' using errcode = '42501';
end if;
if new.declaration_indicateurs_snapshot is distinct from old.declaration_indicateurs_snapshot then
  raise exception 'producers.declaration_indicateurs_snapshot is admin-only (T-218)' using errcode = '42501';
end if;
if new.declaration_indicateurs_wording_version is distinct from old.declaration_indicateurs_wording_version then
  raise exception 'producers.declaration_indicateurs_wording_version is admin-only (T-218)' using errcode = '42501';
end if;
```

✅ **Pas de gap** — les 3 colonnes sont bien dans la liste bloquée.

### RPC `update_producer_onboarding` (T-241)

C'est le seul chemin légitime d'écriture. RPC `SECURITY DEFINER`
appelée côté serveur par `complete-onboarding.ts` via
`createSupabaseAdminClient()` (service_role). ACL conforme (T-295) :
service_role only + supabase internals. Le bypass trigger se fait
naturellement par la condition `auth.role() = 'service_role'`.

Cf. `docs/security/audit-rpc-update-producer-onboarding-pre-live-2026-05-06.md`.

### Lecture (SELECT)

Les 3 colonnes ne portent pas de policy de masquage particulière. La
table `producers` a RLS active depuis T-218 ; la lecture publique
passe par la vue/fetcher `fetchPublicProducerBySlug` qui ne sélectionne
PAS les 3 colonnes DGCCRF (cf. liste de colonnes du fetcher public).
Lecture admin via `is_admin()` policy.

Aucune policy SELECT sur `producers` ne renvoie ces 3 colonnes à un
authenticated non-admin. ✅

---

## Smoke tests

| Test | Caller | Action | Attendu | Résultat |
|------|--------|--------|---------|----------|
| 1 | MCP postgres (rôle non-`service_role`, `auth.role() = NULL`) | `UPDATE producers SET declaration_indicateurs_wording_version = 'v1.0'` | bloqué par trigger T-218 | ✅ ERROR 42501 `producers.declaration_indicateurs_wording_version is admin-only (T-218)` |
| 2 | idem | `UPDATE producers SET declaration_indicateurs_wording_version = 'v0.9'` | bloqué par trigger T-218 (avant CHECK) | ✅ ERROR 42501 (le trigger fire avant CHECK) |
| 3 | idem | `UPDATE producers SET declaration_indicateurs_wording_version = 'v2.0'` | bloqué par trigger T-218 (avant CHECK) | ✅ ERROR 42501 (idem) |
| 4 | `service_role` legit via RPC `update_producer_onboarding` | flow nominal complete-onboarding | accepté | ✅ couvert par tests vitest existants `complete-onboarding.test.ts` |

3/4 testés ce cycle (test 4 hérité, déjà vert dans la suite vitest).

**Note méthodologique** : impossible de tester via MCP un UPDATE
direct en bypass trigger même avec `SET LOCAL ROLE service_role` car
`auth.role()` reste à `NULL` (la session MCP n'injecte pas de claims
JWT). Cohérent avec doctrine CLAUDE.md « Le superuser SQL Studio sans
SET ROLE service_role ne bypass pas le trigger T-218 ». Le bypass légit
n'est observable que via un appel API server side avec
`createSupabaseAdminClient()` — couvert par les tests vitest.

---

## Verdict T-287

**Clôturé sans migration corrective**. Les 3 colonnes DGCCRF sont :
- ✅ protégées en write par le trigger T-218 (gap zero).
- ✅ écrites uniquement via RPC `update_producer_onboarding` (T-241/T-295).
- ✅ non exposées en lecture publique (fetcher `fetchPublicProducerBySlug`
  ne les inclut pas).

**Articulation T-218 + T-218-bis + T-241 + T-292** : couverture
défense-en-profondeur complète :
- Trigger T-218 = ACL write côté Postgres (priorité 1).
- RPC SECURITY DEFINER + ACL = chemin write légitime unique (priorité 2).
- CHECK constraint T-292 = invariant valeur (priorité 3, défensif).
- Map TS `DECLARATION_VERACITE_WORDINGS` immuable = traçabilité texte
  archivé (priorité 4, application).

Item P0 checklist pré-Live → ✅. À reconfirmer dans l'audit T-003 externe.

---

## Références

- Trigger source : migration `supabase/migrations/<...>_t218_producers_
  block_owner_admin_columns.sql` + ajout T-218-bis lat/lng.
- Map wording : `lib/producers/declaration-veracite.ts`.
- RPC : `supabase/migrations/20260504100000_t241_declaration_veracite_
  persistance.sql`.
- Audit RPC : `docs/security/audit-rpc-update-producer-onboarding-pre-live-2026-05-06.md`.
- Vérif CHECK constraint T-292 : `docs/security/verification-check-constraint-wording-version-t292-2026-05-06.md`.
- Threat model amont : `docs/security/threat-model-reidentification-producer-2026-05-06.md`.
